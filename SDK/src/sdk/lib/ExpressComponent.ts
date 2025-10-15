import { applePayEventHandler } from '../core/apple/applePayEventHandler';
import { ensureApplePayReady, canMakeApplePayments } from '../core/apple/applePayReady';
import { createSession } from '../core/init/createSession';

import { buildFrameUrl, createSandboxedIframe } from '../core/iframe/createIframe';

type PublicKey = string;

export interface ExpressInitOptions
{
  frameUrl?: string;
  debug?: boolean;
  [key: string]: unknown;
}

const DEFAULT_FRAME_URL = 'https://checkout-js.monek.com/src/expressCheckout/express-checkout.html';
const DEFAULT_IFRAME_HEIGHT = '65px';

export class ExpressComponent
{
  private readonly publicKey: PublicKey;
  private readonly options: ExpressInitOptions;

  private frameUrl: string;
  private readonly targetOrigin: string;
  private readonly parentOrigin: string;

  private iframe?: HTMLIFrameElement;
  private boundWindowMessageHandler?: (event: MessageEvent) => void;

  constructor(publicKey: PublicKey, options: ExpressInitOptions)
  {
    this.publicKey = this.ensurePublicKey(publicKey);
    this.options = options ?? {};

    this.frameUrl = (this.options.frameUrl as string) || DEFAULT_FRAME_URL;
    this.targetOrigin = new URL(this.frameUrl).origin;
    this.parentOrigin = window.location.origin;

    this.debug('ExpressComponent: constructed', { frameUrl: this.frameUrl, targetOrigin: this.targetOrigin });
  }

  public async mount(selector: string): Promise<void>
  {
    this.debug('mount: start', { selector });

    if (this.iframe)
    {
      this.destroy();
    }

    const mountRoot = document.querySelector(selector);
    if (!mountRoot)
    {
      throw new Error(`[Express] Mount target '${selector}' not found`);
    }

    const hostingForm = mountRoot.closest('form') as HTMLFormElement | null;
    if (!hostingForm)
    {
      throw new Error('[Express] Mount target must be inside a <form>');
    }

    mountRoot.innerHTML = '';

    const sessionId = await createSession(this.publicKey);

    const iframeSrc = buildFrameUrl(this.frameUrl, {
      parentOrigin: this.parentOrigin,
      sessionId,
      publicKey: this.publicKey,
    });

    const iframe = createSandboxedIframe(iframeSrc, DEFAULT_IFRAME_HEIGHT);
    iframe.setAttribute('payment', '*');

    mountRoot.appendChild(iframe);
    this.iframe = iframe;

    const onWindowMessage = async (event: MessageEvent) =>
    {
      if (event.origin !== this.targetOrigin)
      {
        return;
      }

      const messageData = event.data || {};
      if (messageData.type === 'ap-click')
      {
        this.debug('Apple Pay click received');

        const isApplePayReady = await ensureApplePayReady();
        if (!isApplePayReady || !canMakeApplePayments())
        {
          // eslint-disable-next-line no-console
          console.warn('[ApplePay] Apple Pay is not available.');
          return;
        }

        applePayEventHandler(this.publicKey, this.options as Record<string, unknown>, sessionId);
      }
    };

    this.boundWindowMessageHandler = onWindowMessage;
    window.addEventListener('message', this.boundWindowMessageHandler);

    this.debug('mount: complete', { sessionId });
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
    if (!this.options.debug)
    {
      return;
    }

    // eslint-disable-next-line no-console
    console.log(`[Express] ${message}`, data ?? '');
  }
}
