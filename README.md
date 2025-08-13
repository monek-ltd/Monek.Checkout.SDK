# Monek.Checkout.SDK
Monek Checkout (Checkout-Js) SDK, A new embedded checkout solution to display the checkout via Iframe on a merchants own domain

This project is the **embedded checkout SDK** for Monek.  
It provides hosted fields and an express checkout flow (for example, Apple Pay).

---

## ?? Usage

The SDK is built as a **library** with multiple output formats:

- **UMD** – `<script>` embed ? `window.Monek`
- **IIFE** – `<script>` embed ? `window.Monek`
- **ES Module** – `import` / `<script type="module">`

---

## ?? How to Embed

### ? IIFE

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

---

### ? UMD

```html
<script src="https://checkout-js.monek.com/monek-checkout.umd.js"></script>
<script>
  const sdk = Monek('your-public-key');

  const checkout = sdk.createComponent('checkout');
  checkout.mount('#checkout-container');
</script>
```

---

### ? ES Module

```html
<script type="module">
  import Monek from 'https://checkout-js.monek.com/monek-checkout.es.js';

  const sdk = Monek('your-public-key');

  const checkout = sdk.createComponent('checkout');
  checkout.mount('#checkout-container');
</script>
```

Or when using a bundler:

```ts
import Monek from 'monek-checkout.js';

const sdk = Monek('your-public-key');
const checkout = sdk.createComponent('checkout');
checkout.mount('#checkout-container');
```

---

## ? Example Form

```html
<form id="payment-form">
  <div id="checkout-container"></div>
  <div id="express-container"></div>
  <button type="submit">Pay Now</button>
</form>
```

---

## ??? Project Structure

- `src/sdk/` – SDK logic
- `src/hostedFields/` – Hosted iframe entry point
- `src/expressCheckout/` – Express checkout iframe entry point
- `dist/` – All compiled builds (IIFE, UMD, ES)

---

## ?? Build Commands

```bash
npm run build         # Build all formats
npm run dev           # Local development server
npm run build:iife    # Only IIFE build
npm run build:umd     # Only UMD build
npm run build:es      # Only ES build
```

---

## ?? Deployment Notes

- ? **UMD/IIFE** ? `window.Monek`
- ? **ES Module** ? `import Monek`
- ?? All iframes must be served via HTTPS for Apple Pay support
- ?? Recommended to host via **S3 + CloudFront**

---

? **Ready to deploy**
