import { interceptFormSubmit } from '../core/submitInterceptor';
import { validateCallbacks } from '../core/init/validate';
import type { InitCallbacks } from '../types/callbacks';
import type { CompletionOptions } from '../types/completion';
import type { Intent, CardEntry, Order, SettlementType } from '../types/transaction-details';
import type { ChallengeOptions } from '../types/challenge-window';

export class CheckoutComponent {
    private options: Record<string, any>;
    private frameUrl: string;
    private iframe?: HTMLIFrameElement;
    private targetOrigin: string;
    private publicKey: string;
    private parentOrigin: string;
    private onReady?: () => void;
    private sessionId?: string; 
    private onError?: (e: { code: string; message: string }) => void;
    private unbindSubmit?: () => void; 
    private containerEl?: Element; 

    constructor(publicKey: string, options: Record<string, any>, onReady?: () => void, onError?: (e: { code: string; message: string }) => void) {
        this.publicKey = publicKey;
        this.options = options;
        this.onReady = onReady;
        this.onError = onError;
        this.frameUrl =
            this.options.frameUrl ||
            'https://checkout-js.monek.com/src/hostedFields/hosted-fields.html';

        this.targetOrigin = new URL(this.frameUrl).origin; // the iframe's origin (strict check)
        this.parentOrigin = window.location.origin;   // who we are (sent to the iframe)

        validateCallbacks(this.options);

        if (this.options?.completion?.mode === 'client' && !this.options?.completion?.onSuccess) {
            throw new Error('Client-side completion requires an onSuccess callback.');
        }
    }

    public getSettlementType(): SettlementType {
        return this.options.settlementType ?? 'Auto' as SettlementType;
    }

    public getStoreCardDetails(): boolean {
        return this.options.storeCardDetails ?? false as boolean;
    }

    public getIntent(): Intent {
        return this.options.intent ?? 'Purchase' as Intent;
    }

    public getCardEntry(): CardEntry {
        return this.options.cardEntry ?? 'ECommerce' as CardEntry;
    }

    public getChallengeOptions(): ChallengeOptions {
        return this.options.challenge ?? { display: 'popup', size: 'medium' } as ChallengeOptions;
    }

    public getOrder(): Order {
        return this.options.order ?? 'Checkout' as Order;
    }

    public getCallbacks(): InitCallbacks | undefined {
        validateCallbacks(this.options);
        let callbacks = this.options.callbacks as InitCallbacks | undefined;

        if(!callbacks) {
            throw new Error('Callbacks not set. Provide them during instantiation.');
        }
        return callbacks;
    }

    public getCompletionOptions(): CompletionOptions | undefined {
        return this.options.completion as CompletionOptions | undefined;
    }

    public getSessionId(): string {
        if (!this.sessionId) {
            throw new Error('Session ID not set. Call mount() first.');
        }
        return this.sessionId;
    }

    public getPublicKey(): string {
        if (!this.publicKey) {
            throw new Error('Public key not set. Provide it during instantiation.');
        }
        return this.publicKey;
    }

    private handleMessage = (evt: MessageEvent) => {
        if (evt.origin !== this.targetOrigin) {
            return;
        }

        const data = evt.data || {};

        if (data?.type === 'ready') {
            this.onReady?.();
        }

        if (data?.type === 'error') {
            this.onError?.({ code: data.code ?? 'IFRAME_ERROR', message: data.message ?? 'Unknown error' });
        }
    };

    async mount(selector: string) {

        console.log('DEBUG - New Mount');

        const root = document.querySelector(selector);
        if (!root) throw new Error(`[Checkout] Mount target '\${selector}' not found`);

        const form = root.closest('form');
        if (!form) throw new Error('[Checkout] Mount target must be inside a <form>');

        this.containerEl = root;

        root.innerHTML = '';

        this.sessionId = await (await import('../core/init/createSession')).createSession(this.publicKey);

        const url = new URL(this.frameUrl);
        url.searchParams.set('parentOrigin', this.parentOrigin);
        url.searchParams.set('sessionId', this.sessionId);
        url.searchParams.set('publicKey', this.publicKey);

        const iframe = document.createElement('iframe');
        iframe.src = url.toString();
        iframe.style.width = '100%';
        iframe.style.height = '120px';
        iframe.style.border = '0';
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');

        root.appendChild(iframe);
        this.iframe = iframe;

        iframe!.contentWindow!.postMessage({ type: 'PING_FROM_PARENT' }, '*');

        this.intercept(form);

        window.addEventListener('message', this.handleMessage);
    }

    intercept(formOrSelector?: string | HTMLFormElement) {

        if (this.unbindSubmit) { this.unbindSubmit(); this.unbindSubmit = undefined; }

        let form: HTMLFormElement | null = null;
        if (typeof formOrSelector === 'string') {
            form = document.querySelector<HTMLFormElement>(formOrSelector);
        } else if (formOrSelector instanceof HTMLFormElement) {
            form = formOrSelector;
        } else if (this.containerEl) {
            form = this.containerEl.closest('form') as HTMLFormElement | null;
        }

        if (!form) throw new Error('[Checkout] intercept: form not found');

        this.unbindSubmit = interceptFormSubmit(form, this);

        return this.unbindSubmit;
    }

    destroy() {
        window.removeEventListener('message', this.handleMessage);
        this.iframe?.remove();
        this.iframe = undefined;
    }

    async requestExpiry(): Promise<string> {
        if (!this.iframe?.contentWindow) {
            throw new Error('Iframe not ready');
        }

        console.log('DEBUG - New Expiry Request');
        this.iframe!.contentWindow!.postMessage({ type: 'getExpiry' }, this.targetOrigin);

        return new Promise<string>((resolve, reject) => {
            const onMsg = (evt: MessageEvent) => {
                if (evt.origin !== this.targetOrigin) {
                    return;
                }
                const data = evt.data || {};
                if (data?.type === 'expiry') {
                    window.removeEventListener('message', onMsg);
                    clearTimeout(timer);
                    resolve(data.expiry);
                }
                if (data?.type === 'error') {
                    window.removeEventListener('message', onMsg);
                    clearTimeout(timer);
                    reject(new Error(data.message || 'Expiry retrieval failed'));
                }
            };

            const timer = setTimeout(() => {
                window.removeEventListener('message', onMsg);
                reject(new Error('Expiry retrieval timed out'));
            }, 20000);

            window.addEventListener('message', onMsg);
        });
    }


    async requestToken(): Promise<string> {
        if (!this.iframe?.contentWindow) {
            throw new Error('Iframe not ready');
        }

        console.log('DEBUG - New Token Request');
        this.iframe!.contentWindow!.postMessage({ type: 'tokenise' }, this.targetOrigin);

        return new Promise<string>((resolve, reject) => {
            const onMsg = (evt: MessageEvent) => {
                if (evt.origin !== this.targetOrigin) {
                    return;
                }

                const data = evt.data || {};
                if (data?.type === 'tokenised') {
                    window.removeEventListener('message', onMsg);
                    clearTimeout(timer);
                    resolve(data.cardToken);
                }
                if (data?.type === 'error') {
                    window.removeEventListener('message', onMsg);
                    clearTimeout(timer);
                    reject(new Error(data.message || 'Tokenisation failed'));
                }
            };


            const timer = setTimeout(() => {
                window.removeEventListener('message', onMsg);
                reject(new Error('Tokenisation timed out'));
            }, 20000);

            window.addEventListener('message', onMsg);
            // ask iframe to tokenise (iframe should validate evt.origin === parentOrigin)

            console.log('DEBUG - Token request Complete');
        });
    }
}
