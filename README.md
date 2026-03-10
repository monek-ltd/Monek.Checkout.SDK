# Monek.Checkout.SDK

Monek Checkout (aka **checkout-js**) is an embedded checkout you can drop into your site. It renders **Secure Hosted Fields** for cards and an **express surface** (e.g. Apple Pay) inside sandboxed iframes, while you keep full layout and styling control.

## Features
- Hosted card fields (PAN/expiry/CVC inside an iframe)
- Express checkout (Apple Pay)
- 3-D Secure flow orchestration
- Client completion hooks (onSuccess, onError, onCancel)
- Theming via simple styling options and CSS variables
- Multiple build formats: IIFE, UMD, ES Module


## Quick Start

### 1) Add containers to your page
```html
<form id="payment-form" action="/charge" method="post">
  <!-- Express (Apple Pay) mounts here -->
  <div id="express-container"></div>

  <!-- Hosted card fields mount here -->
  <div id="checkout-container"></div>

  <button type="submit">Pay Now</button>
</form>

```
### 2) Include the SDK (IIFE)
```html
<script src="https://checkout-js.monek.com/monek-checkout.iife.js"></script>
<script>
  (async () => {
    // Initialize with your PUBLIC key
    const sdk = await Monek('your-public-key');

    // Minimal options + required callbacks
    const options = {
      callbacks: {
        // Amount in minor/major units; currency is ISO-4217 numeric or alpha
        getAmount: () => ({ major: document.querySelector('[name="amount"]').value, currency: '826' }), 
        getDescription: () => 'Order #12345',
        getCardholderDetails: () => ({
          name: document.querySelector('[name="billingName"]').value,
          email: document.querySelector('[name="billingEmail"]').value,
          homePhone: document.querySelector('[name="billingPhone"]').value,
          billingAddress: {
            addressLine1: document.querySelector('[name="billingAddress1"]').value,
            addressLine2: document.querySelector('[name="billingAddress2"]').value,
            city: document.querySelector('[name="billingCity"]').value,
            postcode: document.querySelector('[name="billingPostcode"]').value,
            country: '826', //UK - Billing Country 
          },
        }),
      },
      completion: {
        mode: 'client', // SDK performs payment client-side
        onSuccess: (ctx, { redirect }) => redirect('/thank-you'),
        onError:   (ctx, { reenable }) => { reenable(); alert(ctx?.payment?.Message || 'Payment failed'); },
        onCancel:  (ctx, { reenable }) => reenable(),
      },
      countryCode: '826', //UK - Store Country
    };

    const checkout = sdk.createComponent('checkout', options);
    await checkout.mount('#checkout-container');

    const express = sdk.createComponent('express', options);
    await express.mount('#express-container');
  })();
</script>
```
That's enough to render both **Apple Pay** (on supported browsers/devices) and **card fields**.

## Form Submission Modes

The SDK supports two ways to kick off the payment + 3-D Secure flow:

1. **Auto-intercept** (classic forms)  
   If your checkout lives inside a real `<form>`, the SDK will intercept the `submit` event automatically after `mount()`. You keep your own button and markup — the SDK prevents the default submit, runs tokenisation + 3DS, then completes via your chosen completion mode.

2. **Manual trigger** (no native form / headless UIs)  
   For UIs that don't use a native `<form>`, call `triggerSubmission()` yourself (e.g. on a "Place Order" click). You can still enable or disable auto-intercept if a form is present.

```ts
// If there's a <form> ancestor, enable auto intercept (default in mount):
checkout.enableAutoIntercept(formOrSelector?);

// Stop listening for native submit:
checkout.disableIntercept();

// Manually run the full flow (tokenise > 3DS > completion):
await checkout.triggerSubmission();

// Soft-cancel the current run (reenables UI, closes WS, stops 3DS wait):
checkout.cancelSubmission();
```
In classic form setups you can keep auto-intercept and expose a manual button that calls `triggerSubmission()` — both paths use the same internal routine.

## Completion Modes

- **`completion.mode: 'client'`** — The SDK finalises the payment client-side, then calls `onSuccess` / `onError`.
- **`completion.mode: 'server'`** — The SDK attaches results and submits back to your server (or you can handle the redirect yourself in `onSuccess`).

Both modes support:

- `onSuccess(context, helpers)`
- `onError(context, helpers)`
- `onCancel(context, helpers)`

When the **express** Apple Pay surface completes, the `context` argument also includes an `applePay` object so you can access the customer information that Apple collected during the sheet interaction. This exposes the payer's email, phone, and name when available, as well as normalised copies of the billing and shipping contacts (address lines, postal code, country, etc.) and the selected shipping method. Use this to pre-fill your order confirmation or update your customer record without requesting the same information twice.

## How to Embed Different Formats

### IIFE (recommended for plain sites)

```html
<script src="https://checkout-js.monek.com/monek-checkout.iife.js"></script>
<script>
  const sdk = Monek('your-public-key');

  const checkout = sdk.createComponent('checkout');
  checkout.mount('#checkout-container');

  const express = sdk.createComponent('express');
  express.mount('#express-container');
</script>
```


### UMD

```html
<script src="https://checkout-js.monek.com/monek-checkout.umd.js"></script>
<script>
  const sdk = Monek('your-public-key');

  const checkout = sdk.createComponent('checkout');
  checkout.mount('#checkout-container');
</script>
```

### ES Module

```html
<script type="module">
  import Monek from 'https://checkout-js.monek.com/monek-checkout.es.js';

  const sdk = Monek('your-public-key');

  const checkout = sdk.createComponent('checkout');
  checkout.mount('#checkout-container');
</script>
```

### Bundler

```ts
import Monek from 'monek-checkout.js';

const sdk = Monek('your-public-key');
const checkout = sdk.createComponent('checkout');
checkout.mount('#checkout-container');
```


## Options Reference (most common)
```ts
type InitOptions = {
  frameUrl?: string;          // override iframe URL (usually not needed)
  styling?: StylingOptions;   // theming (colors, fonts, cssVars)
  completion?: CompletionOptions;  // hooks & client/server mode
  callbacks?: InitCallbacks;  // data providers (amount, cardholder, description)
  settlementType?: 'Auto' | 'Manual';
  storeCardDetails?: boolean;
  intent?: 'Purchase' | 'Subscription' | 'AccountStatus';
  cardEntry?: 'ECommerce' | 'CardOnFile' | 'Manual';
  challenge?: { display: 'popup' | 'fullscreen'; size: 'small'|'medium'|'large' };
  order?: 'Checkout' | 'Mail' | 'Telephone' | 'Recurring';
  countryCode?: number | string;   // The merchant's country code.
  validityId?: string;             // use if provided
  channel?: string;                // e.g. 'Web'
  debug?: boolean;                 // enables console logs
  logLevel?: 'debug'|'info'|'warn'|'error'|'silent';
};
```

#### Required Callbacks

All three can return a value directly or a `Promise`.

- **`getAmount()`** — Returns `{ currency: string | number }` with **either** `minor: number` (e.g. `1099`) **or** `major: string | number` (e.g. `'10.99'`), but not both.  
  Currency is an ISO-4217 numeric or alpha code (e.g. `826` or `'GBP'`).
- **`getDescription()`** — Returns `string`.
- **`getCardholderDetails()`** — Returns `{ name?, email?, phone?, billingAddress? }` where `billingAddress` is `{ addressLine1?, addressLine2?, city?, postcode?, country? }`.

If any of these throw or return missing values, the SDK will surface an error and **halt submission**.

#### Completion Hooks

- **`onSuccess(context, helpers)`** — Typically call `helpers.redirect('/success')`.
- **`onError(context, helpers)`** — Show an error and call `helpers.reenable()` to re-enable the form.
- **`onCancel(context, helpers)`** — Called when a 3-D Secure challenge or Apple Pay sheet is cancelled.


## Apple Pay Requirements (Express)

Apple Pay only renders when **all** of the following apply:

1. Your site and the iframe host are served over **HTTPS**
2. The browser/device supports Apple Pay and has it set up
3. Your merchant domain is validated (via your **Monek account**)
4. The public key you are using has **Apple Pay enabled**

If the button doesn't show:

- Confirm `window.ApplePaySession?.canMakePayments()` returns `true`
- Check your key and merchant settings
- Open the DevTools console with `debug: true` to see logs


## Theming

You can pass a `styling` object or set CSS variables:

```css
:root {
  --monek-input-focus: #0ea5e9;
  --monek-shadow: 0 10px 30px rgba(2,6,23,.08);
}
```
```ts
const options = {
  styling: {
    theme: 'light', // or 'dark'
    core: { backgroundColor: '#fff', textColor: '#0f172a', borderRadius: 12 },
    inputs: { inputBackgroundColor: '#fff', inputTextColor: '#0f172a' },
    cssVars: { '--monek-input-focus': '#0ea5e9' }
  }
};
```

## Project Structure

```bash
src/
  sdk/                    # Core SDK
    core/
      form/               # submission, helpers
      iframe/             # messenger, createIframe
      utils/              # logger, network, etc.
      apple/              # Apple Pay flow
    lib/                  # public components (CheckoutComponent, ExpressComponent)
  hostedFields/           # hosted fields iframe app
  expressCheckout/        # express iframe app
dist/                     # built outputs (iife, umd, es)
```

---

## Build Commands

```bash
npm run build         # Build all formats
npm run dev           # Local development server
npm run build:iife    # Only IIFE build
npm run build:umd     # Only UMD build
npm run build:es      # Only ES build
```


## Deployment Notes

- **UMD/IIFE** exposes `window.Monek`
- **ES Module** via `import Monek`
- All iframes must be served via HTTPS for Apple Pay support
- Recommended to host via **S3 + CloudFront**

## Security Notes

Iframes are sandboxed. For `postMessage` and Apple Pay to work, we allow `allow-scripts` and `allow-same-origin`. Messaging is locked down by verifying `event.origin` and by passing `parentOrigin` into the iframe URL (we do both).

Always serve over **HTTPS** (required for Apple Pay).