import { applePayEventHandler } from '../core/apple/applePayEventHandler';
import { ensureApplePayReady, canMakeApplePayments } from '../core/apple/applePayReady';
import { createSession } from '../core/init/createSession';

export class ExpressComponent {
    private publicKey: string;
    options: Record<string, any>;
    private frameUrl: string;

    constructor(publicKey: string, options: Record<string, any>) {
        this.options = options;
        this.publicKey = publicKey;
        this.frameUrl =
            this.options.frameUrl ||
            'https://checkout-js.monek.com/src/expressCheckout/express-checkout.html';
    }

    async mount(selector: string) {
        const root = document.querySelector(selector);
        if (!root) throw new Error(`[Express] Mount target '\${selector}' not found`);

        const form = root.closest('form');
        if (!form) throw new Error('[Express] Mount target must be inside a <form>');

        root.innerHTML = '';

        const sessionId = await createSession(this.publicKey);

        const iframe = document.createElement('iframe');
        iframe.src = this.frameUrl;
        iframe.style.width = '100%';
        iframe.style.height = '65px';
        iframe.style.border = '0';
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        iframe.setAttribute('payment', '*');

        root.appendChild(iframe);

        const onMessage = async (evt: MessageEvent) => {
            if (new URL(this.frameUrl).origin !== evt.origin) {
                return;
            }

            if (evt.data && evt.data.type === 'ap-click') {
                const ok = await ensureApplePayReady();
                if (!ok || !canMakeApplePayments()) {
                    console.warn('[ApplePay] Apple Pay is not available.');
                    return;
                }

                applePayEventHandler(this.publicKey, this.options, sessionId);
            }
        };

        window.addEventListener('message', onMessage);
    }
}
