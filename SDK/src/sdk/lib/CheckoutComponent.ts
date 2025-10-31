import type { InitCallbacks } from '../types/callbacks';
import type { CompletionOptions } from '../types/completion';
import type { Intent, CardEntry, Order, SettlementType } from '../types/transaction-details';
import type { ChallengeOptions } from '../types/challenge-window';
import type { FrameToParentMessage } from '../core/iframe/messages';
import type { CheckoutPort } from '../types/checkout-port';

import { setupSubmissionController } from '../core/form/submissionController';
import { validateCallbacks } from '../core/init/validateOptions';
import { normaliseStyling, toCssVars, type StylingOptions } from '../types/styling';
import { createSession } from '../core/init/createSession';
import { getClientIpViaIpify } from '../core/utils/getClientIp';
import { normaliseCountryFull } from '../core/utils/normaliseCountry';

import { FrameMessenger } from '../core/iframe/FrameMessenger';
import { buildFrameUrl, createSandboxedIframe } from '../core/iframe/createIframe';
import { resolveForm } from '../core/form/resolveForm';

import { Logger, makeLogger, type LogLevel } from '../core/utils/Logger';

type PublicKey = string;
type CSSVars = Record<string, string>;

type TokenInfo = {
    sessionId: string;
    cardTokenId: string;
};

let latestTokenInfo: TokenInfo | null = null;

export function getLatestTokenInfo(): TokenInfo | null {
    return latestTokenInfo;
}

export interface CheckoutInitOptions
{
  frameUrl?: string;
  styling?: StylingOptions;
  completion?: CompletionOptions;
  callbacks?: InitCallbacks;
  settlementType?: SettlementType;
  storeCardDetails?: boolean;
  intent?: Intent;
  cardEntry?: CardEntry;
  challenge?: ChallengeOptions;
  order?: Order;
  countryCode?: number | string;
  validityId?: string;
  channel?: string;
  debug?: boolean;
  logLevel?: string;
  paymentReference?: string;
  [key: string]: unknown;
}

const DEFAULT_FRAME_URL = 'https://checkout-js.monek.com/src/hostedFields/hosted-fields.html';
const DEFAULT_IFRAME_HEIGHT = '120px';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_COUNTRY = 826;
const DEFAULT_CHANNEL = 'Web';

function normalizeOptions(optionsInput: CheckoutInitOptions = {}): CheckoutInitOptions
{
  return {
    ...optionsInput,
    settlementType: (optionsInput.settlementType ?? 'Auto') as SettlementType,
    storeCardDetails: (optionsInput.storeCardDetails ?? false) as boolean,
    intent: (optionsInput.intent ?? 'Purchase') as Intent,
    cardEntry: (optionsInput.cardEntry ?? 'ECommerce') as CardEntry,
    challenge: (optionsInput.challenge ?? { display: 'popup', size: 'medium' }) as ChallengeOptions,
    order: (optionsInput.order ?? 'Checkout') as Order,
    countryCode: optionsInput.countryCode ?? DEFAULT_COUNTRY,
    channel: (optionsInput.channel as string | undefined) ?? DEFAULT_CHANNEL,
  };
}

export class CheckoutComponent implements CheckoutPort
{
  private readonly options: CheckoutInitOptions;
  private readonly publicKey: PublicKey;
  private readonly callbacks?: InitCallbacks;
  private cardTokenId?: string;
  private cardExpiry?: string;

  private frameUrl: string;
  private readonly targetOrigin: string; // iframe origin
  private readonly parentOrigin: string; // current window origin

  private iframe?: HTMLIFrameElement;
  private messenger?: FrameMessenger;
  private containerEl?: Element;
  private themeVars?: CSSVars;

  private submitController?: ReturnType<typeof setupSubmissionController>;
  private boundHandleMessage?: (event: MessageEvent) => void;
  private sessionId?: string;

  private sourceIp: Promise<string | undefined>;
  
  private readonly logger: Logger;

  constructor(publicKey: PublicKey, options: CheckoutInitOptions)
  {
    this.publicKey = this.ensurePublicKey(publicKey);
    this.options = normalizeOptions(options);

    this.frameUrl = (this.options.frameUrl as string) || DEFAULT_FRAME_URL;
    this.targetOrigin = new URL(this.frameUrl).origin;
    this.parentOrigin = window.location.origin;

    validateCallbacks(this.options);
    this.callbacks = this.options.callbacks as InitCallbacks | undefined;

    //TODO Move to Validate
    if (this.options?.completion?.mode === 'client' && !this.options?.completion?.onSuccess)
    {
      throw new Error('Client-side completion requires an onSuccess callback.');
    }

    this.themeVars = toCssVars(normaliseStyling(this.options.styling as StylingOptions));
    this.sourceIp = getClientIpViaIpify();
    
    this.logger = makeLogger('CheckoutComponent', Boolean(this.options.debug), (this.options.logLevel ?? "debug") as LogLevel);
    this.debug('CheckoutComponent: constructed', { frameUrl: this.frameUrl, targetOrigin: this.targetOrigin });
  }

  // ---------- Public getters ----------
  public getCardEntry(): CardEntry { return this.options.cardEntry as CardEntry; }
  public getCallbacks(): InitCallbacks
  {
    if (!this.callbacks)
    {
      throw new Error('Callbacks not set. Provide them during instantiation.');
    }
    return this.callbacks;
  }
  public getChallengeOptions(): ChallengeOptions { return this.options.challenge as ChallengeOptions; }
  public getChannel(): string { return this.options.channel as string; }
  public getCountryCode(): { alpha2: string; alpha3: string; numeric: string }
  {
    return normaliseCountryFull(this.options.countryCode as number | string);
  }
  public getIntent(): Intent { return this.options.intent as Intent; }
  public getOrder(): Order { return this.options.order as Order; }
  public getSettlementType(): SettlementType { return this.options.settlementType as SettlementType; }
  public getStoreCardDetails(): boolean { return this.options.storeCardDetails as boolean; }
  public getCompletionOptions(): CompletionOptions | undefined { return this.options.completion as CompletionOptions | undefined; }
  public getSessionId(): string
  {
    if (!this.sessionId)
    {
      throw new Error('Session ID not set. Call mount() first.');
    }
    return this.sessionId;
  }
  public getPublicKey(): string { return this.publicKey; }
  public getValidityId(): string | undefined { return this.options.validityId as string | undefined; }
  public getSourceIp(): Promise<string | undefined> { return this.sourceIp; }
  public getCardTokenId(): string | undefined {
        return this.cardTokenId;
  }
  public getCardExpiry(): string | undefined { return this.cardExpiry; }
  public getPaymentReference(): string { return this.options?.paymentReference ?? ""; }

  // ---------- Lifecycle ----------
  async mount(selector: string): Promise<void>
  {
    this.debug('mount: start', { selector });

    if (this.iframe)
    {
      this.destroy();
    }

    const mountRoot = document.querySelector(selector);
    if (!mountRoot)
    {
      throw new Error(`[Checkout] Mount target '${selector}' not found`);
    }

    const hostingForm = mountRoot.closest('form');
    if (!hostingForm)
    {
      throw new Error('[Checkout] Mount target must be inside a <form>');
    }

    this.containerEl = mountRoot;
    mountRoot.innerHTML = '';

    this.sessionId = await createSession(this.publicKey);

    const iframeSrc = buildFrameUrl(this.frameUrl, {
      parentOrigin: this.parentOrigin,
      sessionId: this.sessionId,
      publicKey: this.publicKey,
    });

    const iframe = createSandboxedIframe(iframeSrc, DEFAULT_IFRAME_HEIGHT);
    mountRoot.appendChild(iframe);
    this.iframe = iframe;

    this.messenger = new FrameMessenger(
      () => this.iframe?.contentWindow ?? null,
      this.targetOrigin,
      DEFAULT_TIMEOUT_MS
    );

    iframe.addEventListener('load', () =>
    {
      this.debug('iframe load');
      if (this.themeVars)
      {
        this.messenger!.post({ type: 'configure', themeVars: this.themeVars! });
      }
    });

    this.messenger.post({ type: 'PING_FROM_PARENT' });
    this.enableAutoIntercept(hostingForm);

    this.boundHandleMessage = this.handleMessage.bind(this);
    window.addEventListener('message', this.boundHandleMessage);

    this.debug('mount: complete', { sessionId: this.sessionId });
  }

    public enableAutoIntercept(formOrSelector?: string | HTMLFormElement) {
        this.disableIntercept();
        const hostingForm = resolveForm(this.containerEl, formOrSelector);
        if (!hostingForm) throw new Error('[Checkout] intercept: form not found');
        this.submitController = setupSubmissionController(hostingForm, this, this.logger.child('SubmitInterceptor'));
        this.submitController.attach();
        this.debug('auto-intercept enabled');
    }

    public disableIntercept() {
        try { this.submitController?.unbind(); } catch { }
        this.submitController = undefined;
        this.debug('auto-intercept disabled');
    }

    public async triggerSubmission() {
        if (!this.submitController) {
            const hostingForm = resolveForm(this.containerEl, undefined);
            if (!hostingForm) throw new Error('[Checkout] triggerSubmission: hosting form not found');
            this.submitController = setupSubmissionController(hostingForm, this, this.logger.child('SubmitInterceptor'));
        }
        this.debug('manual triggerSubmission');
        return this.submitController.trigger();
    }

    public cancelSubmission() {
        this.submitController?.cancel?.();
}


  public destroy()
  {
    if (this.boundHandleMessage)
    {
      window.removeEventListener('message', this.boundHandleMessage);
      this.boundHandleMessage = undefined;
    }
    this.disableIntercept();
    this.iframe?.remove();
    this.iframe = undefined;
    this.messenger = undefined;
    this.containerEl = undefined;
    this.debug('destroyed');
  }

  // ---------- Iframe RPC ----------
  public async requestExpiry(): Promise<string>
  {
    this.ensureIframeReady();
    if (!this.messenger)
    {
      throw new Error('Iframe messenger not ready');
    }

    this.debug('requestExpiry: start');
    this.messenger.post({ type: 'getExpiry' });

    const cardExpiry = await this.messenger.waitFor(
      (message: FrameToParentMessage) => message.type === 'expiry',
      (message: FrameToParentMessage) => (message as Extract<FrameToParentMessage, { type: 'expiry' }>).expiry,
      'Expiry retrieval timed out'
      );

    this.cardExpiry = cardExpiry;

    return cardExpiry;
  }

  public async requestToken(): Promise<string>
  {
    this.ensureIframeReady();
    if (!this.messenger)
    {
      throw new Error('Iframe messenger not ready');
    }

    this.debug('requestToken: start');
    this.messenger.post({ type: 'tokenise' });

      const cardTokenId = await this.messenger.waitFor(
          (message: FrameToParentMessage) => message.type === 'tokenised',
          (message: FrameToParentMessage) =>
              (message as Extract<FrameToParentMessage, { type: 'tokenised' }>).cardToken,
          'Tokenisation timed out'
      );

      this.cardTokenId = cardTokenId;

      if (this.sessionId) {
          latestTokenInfo = {
              sessionId: this.sessionId,
              cardTokenId,
          };
      }

      this.debug('requestToken: stored token', {
          sessionId: this.sessionId,
          cardTokenId,
      });

      return cardTokenId;
  }

  // ---------- Internal helpers ----------
  private ensurePublicKey(key: PublicKey): PublicKey
  {
    if (!key)
    {
      throw new Error('Missing public key');
    }
    return key;
  }

  private ensureIframeReady(): void
  {
    if (!this.iframe?.contentWindow)
    {
      throw new Error('Iframe not ready');
    }
  }

  private handleMessage(event: MessageEvent)
  {
    if (event.origin !== this.targetOrigin)
    {
      return;
    }

    const data = (event.data || {}) as FrameToParentMessage;

    switch (data.type)
    {
      case 'ready':
      {
        this.debug('iframe ready');
        if (this.themeVars)
        {
          this.messenger?.post({ type: 'configure', themeVars: this.themeVars! });
        }

        this.messenger?.post({
          type: 'configureLogger',
          enabled: Boolean(this.options.debug),
          level: (this.options.level ?? 'debug') as LogLevel,
          namespaceBase: 'Checkout-Iframe',
          sessionId: this.sessionId,
        });

        return;
      }
      case 'error':
      {
        const code = data.code ?? 'IFRAME_ERROR';
        const message = data.message ?? 'Unknown error';
        this.debug('iframe error', { code, message });
        return;
      }
      default:
        return;
    }
  }

  private debug(message: string, data?: unknown)
  {
    this.logger.debug(message, data ?? '');
  }
}
