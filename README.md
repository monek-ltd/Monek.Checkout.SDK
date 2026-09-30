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
          phone: document.querySelector('[name="billingPhone"]').value,
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
        onError:   (ctx, { reenable }) => { reenable(); alert(ctx.error?.message || ctx.payment?.Message || 'Payment failed'); },
        onCancel:  (ctx, { reenable }) => reenable(),
      },
      countryCode: '826', //UK - Store Country
      paymentReference: 'ORDER-12345', // optional - your own reference for this payment
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

- **`completion.mode: 'client'`** — The SDK finalises the payment client-side, then calls `onSuccess` / `onError`. `onSuccess` is required in this mode.
- **`completion.mode: 'form'`** — After tokenisation + 3-D Secure, the SDK adds hidden `CardTokenID` and `SessionID` fields to your form and submits it to your server, which then takes the payment.
- **`completion.mode: 'none'`** — The SDK stops after tokenisation + 3-D Secure and takes no further action.

Set `mode` explicitly; if it is omitted the card flow does nothing after 3-D Secure. The express (Apple Pay) surface always takes the payment client-side, regardless of `mode`.

Hooks:

- `onSuccess(context, helpers)`
- `onError(context, helpers)`
- `onCancel(context, helpers)`
- `onClosed(context, helpers)` — fallback used when a 3-D Secure challenge is cancelled and no `onCancel` is set

When the **express** Apple Pay surface completes, the `context` argument also includes an `applePay` object so you can access the customer information that Apple collected during the sheet interaction. This exposes the payer's email, phone, and name when available, as well as normalised copies of the billing and shipping contacts (address lines, postal code, country, etc.) and the selected shipping method. Use this to pre-fill your order confirmation or update your customer record without requesting the same information twice.

## How to Embed Different Formats

`Monek(publicKey)` returns a `Promise`, so `await` it (or use `.then`). `options` below is the same object shown in the Quick Start.

### IIFE (recommended for plain sites)

```html
<script src="https://checkout-js.monek.com/monek-checkout.iife.js"></script>
<script>
  (async () => {
    const sdk = await Monek('your-public-key');

    const checkout = sdk.createComponent('checkout', options);
    await checkout.mount('#checkout-container');

    const express = sdk.createComponent('express', options);
    await express.mount('#express-container');
  })();
</script>
```


### UMD

```html
<script src="https://checkout-js.monek.com/monek-checkout.umd.js"></script>
<script>
  (async () => {
    const sdk = await Monek('your-public-key');

    const checkout = sdk.createComponent('checkout', options);
    await checkout.mount('#checkout-container');
  })();
</script>
```

### ES Module

```html
<script type="module">
  import Monek from 'https://checkout-js.monek.com/monek-checkout.es.js';

  const sdk = await Monek('your-public-key');

  const checkout = sdk.createComponent('checkout', options);
  await checkout.mount('#checkout-container');
</script>
```

### Bundler

```ts
import Monek from 'monek-checkout.js';

const sdk = await Monek('your-public-key');
const checkout = sdk.createComponent('checkout', options);
await checkout.mount('#checkout-container');
```

## SDK API

### `Monek(publicKey, defaultOptions?)`

Resolves to an SDK instance:

| Member | Description |
| --- | --- |
| `createComponent(type, options?)` | Creates a `'checkout'` (hosted card fields) or `'express'` (Apple Pay) component. If `options` is omitted, the `defaultOptions` passed to `Monek()` are used (the two are not merged). |
| `getSessionId()` | Returns a `Promise<string>` for the checkout session. Components mounted at the same time share one session. |
| `resetSession()` | Discards the cached session so the next mount creates a fresh one. |

### Checkout component

| Method | Description |
| --- | --- |
| `mount(selector)` | Renders the hosted fields into the element. The element must be inside a `<form>`. |
| `destroy()` | Removes the iframe and all listeners. |
| `enableAutoIntercept(formOrSelector?)` | Intercepts the form's native `submit` (on by default after `mount`). |
| `disableIntercept()` | Stops intercepting the native `submit`. |
| `triggerSubmission()` | Runs tokenise > 3DS > completion manually. |
| `cancelSubmission()` | Soft-cancels the current run. |

### Express component

| Method | Description |
| --- | --- |
| `mount(selector)` | Renders the Apple Pay button. Nothing is mounted if Apple Pay is not enabled for your public key. |
| `destroy()` | Removes the iframe and all listeners. |

## Payment Reference and Validity ID

Both are plain options passed to `createComponent` and are sent with the payment request. Pass them to **each** component you create (checkout and express), as each component reads only its own options.

```js
const options = {
  // ...callbacks, completion, etc.
  paymentReference: 'ORDER-12345',   // your own reference for the payment, e.g. an order number
  validityId: 'validity-id-from-monek', // only set this if Monek has given you one
};

const checkout = sdk.createComponent('checkout', options);
const express = sdk.createComponent('express', options);
```

- **`paymentReference`** — optional string. Sent as `paymentReference` on the payment so you can match the transaction to your order.
- **`validityId`** — optional string. Sent as `validityId` on the payment; omit it unless you have been issued one.

Options are read when the component is created. If the value changes (for example a new order number), destroy the component and create it again with the new options:

```js
checkout.destroy();
checkout = sdk.createComponent('checkout', { ...options, paymentReference: newOrderRef });
await checkout.mount('#checkout-container');
```

In `completion.mode: 'form'` the SDK does not take the payment, so these two options are not used for card payments; apply them in your server-side payment call instead.


## Options Reference (most common)
```ts
type InitOptions = {
  frameUrl?: string;          // override iframe URL (usually not needed)
  styling?: StylingOptions;   // theming (colors, fonts, cssVars)
  completion?: CompletionOptions;  // hooks & client/server mode
  callbacks?: InitCallbacks;  // data providers (amount, cardholder, description)
  settlementType?: 'Auto' | 'Manual';                      // default 'Auto'
  storeCardDetails?: boolean;                              // default false
  intent?: 'Purchase' | 'Subscription' | 'AccountStatus';  // default 'Purchase'
  cardEntry?: 'ECommerce' | 'CardOnFile' | 'Manual';       // default 'ECommerce'
  challenge?: {                                            // 3-D Secure challenge window
    display?: 'popup' | 'fullscreen';                      // default 'popup'
    size?: 'small' | 'medium' | 'large' | { width: number; height: number }; // default 'medium'
    force?: boolean;                                       // request a challenge
  };
  order?: 'Checkout' | 'Mail' | 'Telephone' | 'Recurring' | 'Instalments'; // default 'Checkout'
  countryCode?: number | string;   // The merchant's country code. Default 826 (UK)
  paymentReference?: string;       // your reference for the payment (e.g. order number)
  validityId?: string;             // use if provided
  channel?: string;                // default 'Web'
  debug?: boolean;                 // enables console logs
  logLevel?: 'debug'|'info'|'warn'|'error'|'silent';

  // Express (Apple Pay) only
  appleMerchantLabel?: string;     // name shown on the Apple Pay sheet total. Default 'Merchant'
  form?: HTMLFormElement;          // form used by completion helpers. Default: first <form> on the page
  sourceIpAddress?: string;        // shopper IP address, if you want to supply it
};
```

#### Required Callbacks

All three can return a value directly or a `Promise`.

- **`getAmount()`** — Returns `{ currency: string | number }` with **either** `minor: number` (e.g. `1099`) **or** `major: string | number` (e.g. `'10.99'`), but not both.  
  Currency is an ISO-4217 numeric or alpha code (e.g. `826` or `'GBP'`).
- **`getDescription()`** — Returns `string`.
- **`getCardholderDetails()`** — Returns `{ name?, email?, phone?, billingAddress? }` where `billingAddress` is `{ addressLine1?, addressLine2?, city?, postcode?, country? }`.

If any of these throw or return missing values, the SDK will surface an error and **halt submission**.

#### Optional Callbacks (Express)

- **`onExpressPaymentDetails(details)`** — Called when the shopper authorises Apple Pay, before the payment is taken. `details` is `{ sessionId, billingContact?, shippingContact? }`, where each contact is `{ name?, email?, phone?, address? }`. Use it to capture the shopper's details on your order. Errors thrown here are logged and ignored.
- **`onPaymentAuthorised(result)`** — Called after the gateway approves an Apple Pay payment so you can verify it server-side before the shopper sees success. `result` is `{ sessionId, approved, transactionId?, verification?, payment }`, where `verification` is a signed token to validate on your server. Return `{ verified: boolean, redirect?, message? }`:
  - `verified: false` (or a thrown error) fails the Apple Pay sheet and calls `onError`.
  - `redirect` (URL string or `{ url, method, parameters }`) is followed after `onSuccess`.
  - The returned object is available to hooks as `context.verification`.

  Without this callback the payment completes on the gateway result alone.

  ```js
  callbacks: {
    // ...getAmount, getDescription, getCardholderDetails
    onPaymentAuthorised: async ({ sessionId, verification }) => {
      const response = await fetch('/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, verification }),
      });
      const { ok, redirectUrl } = await response.json();
      return { verified: ok, redirect: redirectUrl };
    },
  }
  ```

#### Completion Hooks

Each hook receives `(context, helpers)`. A hook can also be a redirect object (`{ url, method, parameters }`) instead of a function.

`context` is `{ sessionId, cardTokenId, auth?, payment?, error?, applePay?, verification? }`.

`helpers`:

| Helper | Description |
| --- | --- |
| `redirect(to)` | Navigates to a URL string, or `{ url, method: 'GET' \| 'POST', parameters }`. |
| `submitForm(fields?)` | Adds `fields` to the form as hidden inputs and submits it. |
| `reenable()` | Re-enables the form's buttons. |
| `disable()` | Disables the form's buttons. |

- **`onSuccess(context, helpers)`** — Typically call `helpers.redirect('/success')`.
- **`onError(context, helpers)`** — Show an error and call `helpers.reenable()` to re-enable the form.
  This fires for declined payments and failed 3-D Secure authentication, and also for failures that
  happen before payment (invalid card details, tokenisation errors, 3-D Secure lookup errors). In the
  pre-payment case `context.payment` and `context.auth` are `null` and `context.cardTokenId` is empty,
  so check `context.error` first:

  ```js
  onError: (ctx, { reenable }) => {
    reenable();
    const message = ctx.error?.message || ctx.payment?.Message || 'Payment failed';
    // ctx.error?.code is one of the codes below when present
    showMessage(message);
  }
  ```

  `context.error` is `{ code, message, cause }` where `code` is one of:

  | Code | Meaning |
  | --- | --- |
  | `INVALID_PAN` | Card number failed the length or Luhn check. |
  | `INVALID_EXPIRY` | Expiry is not in `MM/YY` format. |
  | `INVALID_CVC` | CVC is not 3 or 4 digits. |
  | `SESSION_EXPIRED` | The checkout session expired and could not be refreshed. |
  | `SUBMISSION_FAILED` | Any other failure before payment (e.g. tokenisation or 3-D Secure lookup error). |

  `cause` is the original error thrown by the SDK, useful for logging.

  For Apple Pay failures that happen before or during authorisation, `context.payment.code` is one of `NO_BILLING_ADDRESS`, `NO_TOKEN` or `AUTHORISE_EXCEPTION`.
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
    layout: { containerPadding: 12, textAlign: 'left', buttonAlign: 'stretch' },
    core: { backgroundColor: '#fff', textColor: '#0f172a', fontFamily: 'system-ui', borderRadius: 12 },
    inputs: { inputBackgroundColor: '#fff', inputTextColor: '#0f172a', inputBorderColor: '#d1d5db', inputBorderRadius: 8 },
    typography: { fontSize: 14 },
    cssVars: { '--monek-input-focus': '#0ea5e9' }
  }
};
```

Lengths accept a number (pixels) or a CSS string (`'1rem'`). `containerPadding` also accepts `[vertical, horizontal]` or `[top, right, bottom, left]`. `textAlign` is `'left' | 'center' | 'right'`; `buttonAlign` additionally allows `'stretch'`.

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