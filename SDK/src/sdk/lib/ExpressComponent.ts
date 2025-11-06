import { applePayEventHandler } from '../core/apple/applePayEventHandler';
import { ensureApplePayReady, canMakeApplePayments } from '../core/apple/applePayReady';
import { createSession } from '../core/init/createSession';

import { buildFrameUrl, createSandboxedIframe } from '../core/iframe/createIframe';
import { FrameMessenger } from '../core/iframe/FrameMessenger';
import { Logger, makeLogger, type LogLevel } from '../core/utils/Logger';

type PublicKey = string;

export interface ExpressInitOptions
{
  applePayEnabled?: boolean;
  frameUrl?: string;
  debug?: boolean;
  logLevel?: string;
  [key: string]: unknown;
}

const DEFAULT_FRAME_URL = 'https://checkout-js.monek.com/src/expressCheckout/express-checkout.html';
const DEFAULT_IFRAME_HEIGHT = '65px';
const DEFAULT_TIMEOUT_MS = 20_000;

export class ExpressComponent
{
  private readonly publicKey: PublicKey;
  private readonly options: ExpressInitOptions;

  private frameUrl: string;
  private readonly targetOrigin: string;
  private readonly parentOrigin: string;

  private iframe?: HTMLIFrameElement;
  private messenger?: FrameMessenger;
  private boundWindowMessageHandler?: (event: MessageEvent) => void;

  private readonly logger: Logger;

  constructor(publicKey: PublicKey, options: ExpressInitOptions)
  {
    this.publicKey = this.ensurePublicKey(publicKey);
    this.options = options ?? {};

    this.frameUrl = (this.options.frameUrl as string) || DEFAULT_FRAME_URL;
    this.targetOrigin = new URL(this.frameUrl).origin;
    this.parentOrigin = window.location.origin;

    this.logger = makeLogger('ExpressComponent', Boolean(this.options.debug), (this.options.logLevel ?? 'debug') as LogLevel);
    this.debug('constructed', { frameUrl: this.frameUrl, targetOrigin: this.targetOrigin });
  }

    public async mount(selector: string): Promise<void> {
        this.debug('mount: start', { selector });

        if (this.iframe) {
            this.destroy();
        }

        const mountRoot = document.querySelector(selector);
        if (!mountRoot) {
            throw new Error(`Mount target '${selector}' not found`);
        }

        mountRoot.innerHTML = '';

        const sessionId = await createSession(this.publicKey);
        this.debug('created session', { sessionId });

        const iframeSrc = buildFrameUrl(this.frameUrl, {
            parentOrigin: this.parentOrigin,
            sessionId,
            publicKey: this.publicKey,
        });

        if (this.options.applePayEnabled == true) // || Gpay ect...
        {
            const iframe = createSandboxedIframe(iframeSrc, DEFAULT_IFRAME_HEIGHT);
            iframe.setAttribute('allow', 'payment *');

            mountRoot.appendChild(iframe);
            this.iframe = iframe;

            this.messenger = new FrameMessenger(
                () => this.iframe?.contentWindow ?? null,
                this.targetOrigin,
                DEFAULT_TIMEOUT_MS
            );

            iframe.addEventListener('load', () => {
                this.debug('iframe load');

                this.messenger!.post({ type: 'PING_FROM_PARENT' });

                this.messenger!.post({
                    type: 'configureLogger',
                    enabled: Boolean(this.options.debug),
                    level: (this.options.logLevel ?? 'debug') as LogLevel,
                    namespaceBase: 'Express-Iframe',
                    sessionId,
                });
            });

            const onWindowMessage = async (event: MessageEvent) => {
                if (event.origin !== this.targetOrigin) {
                    return;
                }

                const data = event.data || {};

                if (data.type === 'ready') {
                    this.debug('iframe ready');

                    this.messenger?.post({ type: 'configure', applePayEnabled: this.options.applePayEnabled! });

                    this.messenger?.post({
                        type: 'configureLogger',
                        enabled: Boolean(this.options.debug),
                        level: (this.options.logLevel ?? 'debug') as LogLevel,
                        namespaceBase: 'Express-Iframe',
                        sessionId,
                    });
                    return;
                }

                if (data.type === 'ap-click') {
                    this.debug('Apple Pay click received');

                    const isApplePayReady = await ensureApplePayReady();
                    if (!isApplePayReady || !canMakeApplePayments()) {
                        this.logger.warn('Apple Pay is not available');
                        return;
                    }

                    await applePayEventHandler(
                        this.publicKey,
                        this.options as Record<string, unknown>,
                        sessionId,
                        this.logger.child('ApplePayEventHandler')
                    );
                    return;
                }

                this.debug('unhandled message from express iframe', { data });

            };

            this.boundWindowMessageHandler = onWindowMessage;
            window.addEventListener('message', this.boundWindowMessageHandler);

            this.debug('mount: complete', { sessionId });
        }
        else {
            this.logger.warn('No express checkout options are available - Iframe not mounted');
        }
  }

  public destroy(): void
  {
    if (this.boundWindowMessageHandler)
    {
      window.removeEventListener('message', this.boundWindowMessageHandler);
      this.boundWindowMessageHandler = undefined;
    }

    this.iframe?.remove();
    this.iframe = undefined;
    this.messenger = undefined;

    this.debug('destroyed');
  }

  // ---------- Internal ----------

  private ensurePublicKey(key: PublicKey): PublicKey
  {
    if (!key)
    {
      throw new Error('Missing public key');
    }
    return key;
  }

  private debug(message: string, data?: unknown): void
  {
    this.logger.debug(message, data ?? '');
  }
}
