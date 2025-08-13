export class ExpressComponent {
    options: Record<string, any>;

    constructor(options: Record<string, any>) {
        this.options = options;
    }

    mount(selector: string) {
        const root = document.querySelector(selector);
        if (!root) throw new Error(`[Express] Mount target '\${selector}' not found`);

        const form = root.closest('form');
        if (!form) throw new Error('[Express] Mount target must be inside a <form>');

        root.innerHTML = '';

        const iframe = document.createElement('iframe');
        iframe.src = this.options.frameUrl || 'https://dev-checkout-js.monek.com/src/expressCheckout/express-checkout.html';
        iframe.style.width = '100%';
        iframe.style.height = '120px';
        iframe.style.border = '0';
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');

        root.appendChild(iframe);
    }
}
