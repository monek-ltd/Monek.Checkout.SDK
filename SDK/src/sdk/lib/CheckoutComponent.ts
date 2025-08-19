export class CheckoutComponent {
    private options: Record<string, any>;
    private iframe?: HTMLIFrameElement;
    private targetOrigin: string;
    private publicKey: string;
    private parentOrigin: string;
    private onReady?: () => void;
    private sessionId?: string; 
    private onError?: (e: { code: string; message: string }) => void;

    constructor(publicKey: string, options: Record<string, any>, onReady?: () => void, onError?: (e: { code: string; message: string }) => void) {
        this.publicKey = publicKey;
        this.options = options;
        this.onReady = onReady;
        this.onError = onError;

        const frameUrl =
            this.options.frameUrl ||
            'https://checkout-js.monek.com/src/hostedFields/hosted-fields.html';

        this.targetOrigin = new URL(frameUrl).origin; // the iframe's origin (strict check)
        this.parentOrigin = window.location.origin;   // who we are (sent to the iframe)
    }

    public getSessionId() {
        if (!this.sessionId) {
            throw new Error('Session ID not set. Call mount() first.');
        }
        return this.sessionId;
    }

    public getPublicKey() {
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
        const root = document.querySelector(selector);
        if (!root) throw new Error(`[Checkout] Mount target '\${selector}' not found`);

        const form = root.closest('form');
        if (!form) throw new Error('[Checkout] Mount target must be inside a <form>');

        root.innerHTML = '';

        this.sessionId = await (await import('../core/createSession')).createSession(this.publicKey);

        const base =
            this.options.frameUrl ||
            'https://checkout-js.monek.com/src/hostedFields/hosted-fields.html';
        const url = new URL(base);
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

        window.addEventListener('message', this.handleMessage);
    }

    destroy() {
        window.removeEventListener('message', this.handleMessage);
        this.iframe?.remove();
        this.iframe = undefined;
    }

    async requestToken(): Promise<string> {
        if (!this.iframe?.contentWindow) {
            throw new Error('Iframe not ready');
        }

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
            this.iframe!.contentWindow!.postMessage({ type: 'tokenise' }, this.targetOrigin);
        });
    }
}
