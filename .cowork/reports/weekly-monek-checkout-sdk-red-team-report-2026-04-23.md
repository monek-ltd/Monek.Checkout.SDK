# Weekly Red-Team Review — Monek.Checkout.SDK

**Run date:** 2026-04-23
**HEAD SHA:** `ed6eb78` — "MON-3152-Update-Readme (#48)" (2026-03-10)
**Branch:** `main`
**Repo path (host):** `C:\Users\AdrianDavies\github\Monek.Checkout.SDK`
**Mount path (review):** `/sessions/focused-funny-gauss/mnt/Monek.Checkout.SDK`
**Pull status:** `git pull --ff-only` failed with `Another git process seems to be running in this repository` — a concurrent Windows-side git maintenance run had `.git/ORIG_HEAD.lock` and `.git/objects/maintenance.lock` held. Per scheduled-task rules these are tolerated as benign Windows-side locks. Review was run against the current working tree at SHA `ed6eb78`, which matches the remote as observed in the prior run earlier today.
**Reviewer mode:** Read-only static review of the whole working tree.

---

## TL;DR

Working tree is unchanged since the prior run (SHA `ed6eb78`, no new commits). Every finding from the earlier 2026-04-23 report has been re-verified in place and persists. **Nothing has been fixed this week.** The single Critical (`live_*` and `test_*` merchant keys committed to the demo page that ships to `checkout-js.monek.com`) remains the dominant exposure; the three Highs (unescaped HTML sinks in the 3DS method iframe, a `postMessage` origin that defaults to `'*'` and unconditionally trusts the first `PING_FROM_PARENT`, and a `sandbox="allow-scripts allow-same-origin"` that effectively disables the iframe sandbox) are all first-party, not dependency-driven, and fixable without a rewrite. Jira sync will create individual tickets under `SAM-7298` for every Critical/High/Medium/Low this run, since no prior red-team tickets exist for this repo.

---

## Severity counts

| Severity | Count | IDs |
|---|---|---|
| Critical | 1 | C1 |
| High | 3 | H1, H2, H3 |
| Medium | 8 | M1, M2, M3, M4, M5, M6, M7, M8 |
| Low | 6 | L1, L2, L3, L4, L5, L6 |
| Info | 3 | I1, I2, I3 |

---

## Top priorities this week

1. **Rotate the two `live_*` merchant keys in `SDK/index.html` today** (C1). Revoke them gateway-side. Rewriting git history does not help because the CDN already served the file; assume the values are public. Rotate the `test_*` keys too — they identify real test merchants.
2. **Stop posting `*` anywhere that implies token possession** (H2, M5). The fix is one line per place but needs careful testing against the real merchant integration path. Require `parentOrigin` in the hosted-fields / express-checkout query string and verify `event.origin` against it.
3. **Harden the 3DS iframe HTML sinks** (H1, M1) — both `methodInvocation.ts` and `challenge.ts` should build forms via DOM APIs, not string templates. This single refactor also lets you tighten the CSP on `checkout-js.monek.com`.
4. **Drop `allow-same-origin` from the iframe sandbox** (H3) and add a server-side CSP. This materially changes the defense-in-depth posture and pairs well with fix 3.
5. **Lock down the deploy pipeline** (M6, L5): `npm ci` not `npm install`, no `continue-on-error`, SHA-pinned actions, Dependabot, `npm audit` gate, and an optional pre-deploy grep-for-`live_` check so C1-class regressions fail the build automatically.
6. **Remove the ipify dependency** (M3). Server-side IP is more reliable and removes a third-party availability and integrity dependency from the checkout flow.

---

## Findings

Findings are grouped by severity. For each, the remediation line is a direction, not a code fix. IDs are stable week-over-week; a finding keeps its ID until it is closed.

### Critical

#### C1 — Live (and test) API keys for real merchants committed to the demo page
**Severity:** Critical
**File:** `SDK/index.html` lines 209-215

**Evidence:**

```js
const KEYS = {
    A: host === 'dev-checkout-js.monek.com' || host.startsWith('dev-')
        ? 'test_9290ecf10347472fae33addb0438bbde' // 0000894
        : 'test_73cd746315f242ce9785d2775fbd5164', // 0000015
    B: host === 'dev-checkout-js.monek.com' || host.startsWith('dev-')
        ? 'live_312ede4ef0c840bea54e3a6a40773a23' // 0000894
        : 'live_105aae69a7b546aead763cd55d9cce13', // 0150185
};
```

Four API keys — including two `live_*` keys — are hardcoded into the demo dashboard that ships to the public CDN (`checkout-js.monek.com`). The inline comments map each key to the merchant reference it belongs to (0000894, 0000015, 0150185). Although the SDK treats these as "public" keys, every API call in the SDK presents them in the `x-api-key` header (`createSession`, `fetchAccessKeyDetails`, `tokenise`, `3ds`, `3ds/authenticate`, `payment`, `payment/apple-pay`). Exposure of the `live_*` values means any third party can:

- Create real checkout sessions against those merchants.
- Hit the tokenisation endpoint with arbitrary PANs (generating load, card-probing / BIN-attack surface, and possibly consuming any velocity limits you have set).
- Call `/3ds/authenticate` and `/payment/apple-pay` under those merchant IDs. The merchant reference is the merchant you are billing — a compromise here is directly an abuse primitive.

Because the keys are committed, they are also in `git log` forever (several commits back), so rotation alone is not enough; you must invalidate the specific `live_*` values on the payment side.

**Remediation direction:** Immediately rotate/revoke the two `live_*` keys (and ideally the two `test_*` ones too — they identify real test merchants). Stop shipping real-merchant keys in the demo page; have the demo read keys from a runtime config endpoint or from the query string and fall back to a clearly-marked sandbox merchant. Add a pre-commit / CI secret-scan (gitleaks, trufflehog, or a simple regex for `live_[0-9a-f]{32}`) so a repeat is blocked at the pipeline. Confirm the gateway enforces per-key origin/referrer allow-listing so a leaked public key alone is not sufficient to transact.

---

### High

#### H1 — Unescaped HTML injection in the 3DS method-invocation iframe
**Severity:** High
**File:** `SDK/src/sdk/core/form/3ds/methodInvocation.ts` lines 33-39

**Evidence:**

```ts
iframeDocument.write(`
  <form id="threeDSMethodForm" action="${methodUrl}" method="POST">
    <input type="hidden" name="threeDSMethodData" value="${methodData}">
  </form>
  <script>document.getElementById('threeDSMethodForm').submit();</script>
`);
```

`methodUrl` and `methodData` are returned by the `/3ds` endpoint and are written straight into `document.write` with zero escaping. The sibling file `challenge.ts` *does* `escapeHtml(...)` both equivalents (cReq / acsUrl). Because the iframe is created via `createSandboxedIframe(..., 'sandbox="allow-scripts allow-same-origin"')`, the resulting document runs effectively without sandbox isolation against the Monek origin (the `allow-scripts allow-same-origin` combo disables most sandbox benefits — see H3), so a crafted response from the 3DS backend, an MITM (the library pins to HTTPS, but a compromised intermediary or a compromised upstream 3DS server), or a scheme/acquirer that ever returns attacker-influenced text can inject script that runs in the Monek origin and can pivot to the hosted-fields frame. Today the only guardrails are TLS and trust in the 3DS server.

**Remediation direction:** Escape both values the way `challenge.ts` does (`escapeHtml` for both the attribute body of `action="…"` and the hidden input `value="…"`). Better, stop using `document.write` at all for this — construct the elements with `createElement` + `setAttribute` and `form.submit()`; the DOM APIs do the escaping for you. While you're there, align with `challenge.ts` so there is a single helper for "autosubmitting 3DS form inside a hidden iframe".

#### H2 — `parentOrigin` defaults to `'*'` and the handshake trusts the first `PING_FROM_PARENT` sender
**Severity:** High
**Files:**
- `SDK/src/hostedFields/components/HostedFieldsApp.tsx` lines 14-16, 115, 184-194, 221-245
- `SDK/src/expressCheckout/components/ExpressCheckoutApp.tsx` lines 12-14, 62, 81-93

**Evidence (hosted fields):**

```ts
function getParentOriginParam() {
    return getParams().get('parentOrigin') || '*';
}
...
const allowedOriginRef = useRef<string>(getParentOriginParam());
...
window.parent.postMessage({ type: 'ready' }, allowedOriginRef.current);
...
if (event?.data?.type === 'PING_FROM_PARENT') {
    allowedOriginRef.current = event.origin;  // unconditionally trusts sender
    window.parent.postMessage({ type: 'ready' }, allowedOriginRef.current);
    return;
}
```

Two related issues:

1. When the iframe is loaded *without* the `parentOrigin` query-string parameter, `allowedOriginRef` starts as `'*'`. The initial `postMessage({ type: 'ready' }, '*')` will leak to any cross-origin window that has a handle on the frame's `window.parent`. Any `tokenised`/`expiry`/`error` post that fires before the handshake completes would also go to `'*'`.
2. Even with a `parentOrigin` param, the first `PING_FROM_PARENT` unconditionally **overwrites** the allowed origin with whatever `event.origin` the sender has — there is no check against the original `parentOrigin` param. A cross-origin parent that frames the hosted-fields page can post a single `PING_FROM_PARENT`, become the trusted origin, and subsequently receive `tokenised`/`expiry` events by sending `{type:'tokenise'}` / `{type:'getExpiry'}` messages — the exact messages the SDK itself sends.

Realistic threat model: a malicious merchant site (or a compromised script on a merchant site) can frame `checkout-js.monek.com/src/hostedFields/hosted-fields.html` without the `parentOrigin` param, ask the cardholder to fill the hosted fields, then trigger `tokenise` and receive the token — under a valid merchant's session. Gateway-side scope of that token depends on what `sessionId` it was bound to, but the pattern is unsafe.

**Remediation direction:** Require `parentOrigin` in the query string and reject (or render an explicit error) when it is missing; never default to `'*'`. Treat `parentOrigin` as the single source of truth — the `PING_FROM_PARENT` handler should *verify* `event.origin === parentOriginParam` and ignore the message otherwise. Never call `postMessage(..., '*')` for anything that carries (or implies possession of) session/token/expiry data. Apply the same fix in `ExpressCheckoutApp.tsx` and in `SDK/public/notification/index.html` (see M5).

#### H3 — `sandbox="allow-scripts allow-same-origin"` effectively disables the iframe sandbox
**Severity:** High
**File:** `SDK/src/sdk/core/iframe/createIframe.ts` line 13

**Evidence:**

```ts
iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
```

Per the HTML spec / MDN: combining `allow-scripts` with `allow-same-origin` lets the framed document remove the `sandbox` attribute from its own `<iframe>` parent via `window.parent.frameElement.removeAttribute('sandbox')` (if that parent is same-origin), and generally negates most sandbox benefits. In this SDK, hosted-fields and express-checkout are both hosted at `checkout-js.monek.com` (same origin across both frames), so this iframe behaves essentially as unsandboxed for anything on that origin. Combined with H1 this means an HTML-injection bug in either frame can pivot to its parent sandbox frame freely.

**Remediation direction:** Decide what you actually need inside the frame. The hosted-fields and express-checkout frames need to run scripts and make fetch calls, but they do not need `allow-same-origin` against the merchant page (they're already cross-origin from the merchant). Drop `allow-same-origin`; if that breaks React hydration, split into narrower sandbox tokens (`allow-forms allow-popups allow-popups-to-escape-sandbox`) that preserve what you genuinely need. Add a Content-Security-Policy response header on `checkout-js.monek.com` (`script-src 'self'; frame-ancestors <merchant list>;` etc.) so a future HTML-injection has no useful sink.

---

### Medium

#### M1 — 3DS challenge iframe uses inline `<script>` via `document.write`, forcing `'unsafe-inline'`
**Severity:** Medium
**File:** `SDK/src/sdk/core/form/3ds/challenge.ts` lines 79-88

**Evidence:**

```ts
innerDocument.write(`
  ...
  <script>document.getElementById('monek-3ds-form').submit();</script>
`);
```

The inline script means any future CSP on `checkout-js.monek.com` has to allow `'unsafe-inline'` (or a nonce-based inline policy) on the challenge page. It is not a vulnerability by itself — `escapeHtml` is applied to both `acsUrl` and `creq` so the attribute values are safely quoted — but the pattern is brittle (single quotes are not escaped by `escapeHtml`, which relies on the template using only double quotes), and it blocks a strong CSP.

**Remediation direction:** Build the form via DOM APIs (`createElement('form')`, `setAttribute('action', acsUrl)`, etc.) and call `form.submit()` from the outer script. That eliminates both the inline-script requirement and the escaping dependence in one go, and aligns with the fix for H1.

#### M2 — `safeUuid()` fallback uses `Math.random()` for idempotency tokens
**Severity:** Medium
**Files:**
- `SDK/src/sdk/core/form/pay/buildPaymentRequest.ts` lines 107-118
- `SDK/src/sdk/core/apple/pay/handlePaymentAuthorised.ts` lines 379-393

**Evidence:**

```ts
return `sdk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
```

Idempotency tokens are the defense against double-charge on retry. `crypto.randomUUID()` is the primary path and is available in every current browser, but the fallback falls back to ~52 bits of non-cryptographic PRNG plus a millisecond timestamp. On older or constrained environments the collision probability is higher than the gateway probably assumes, and (more subtly) an attacker who can observe one token on the wire can predict subsequent tokens from the same tab and potentially force replay collisions if idempotency is only checked by token equality.

**Remediation direction:** Drop the `Math.random()` fallback. If `crypto.randomUUID()` isn't available, fall back to `crypto.getRandomValues(new Uint8Array(16))` and hex-encode — still Web Crypto, still available everywhere you would reasonably run this SDK. Remove the timestamp concatenation or keep it for debugging only; do not let token uniqueness depend on it.

#### M3 — Client IP sourced from a third-party endpoint (`api.ipify.org`) and forwarded in payment requests
**Severity:** Medium
**File:** `SDK/src/sdk/core/utils/getClientIp.ts`

**Evidence:**

```ts
fetchWithTimeout('https://api.ipify.org?format=json')
```

Two concerns:
- **Supply chain / data exfil.** Every SDK mount issues a cross-origin fetch to ipify. If ipify is compromised, hijacked via DNS, or replaced, attacker-controlled JS doesn't run (the response is JSON, not a script), but the attacker learns the browser is about to transact with Monek and which domain it's on (the browser sends `Referer` by default). It also gives an attacker positioned on ipify a denial-of-service vector for your checkout.
- **Fraud-signal integrity.** The returned IP is threaded into payment / 3DS / Apple Pay authorise requests as `sourceIpAddress` (`buildPaymentRequest.ts` and `handlePaymentAuthorised.ts`). A client can trivially lie about this IP (intercept the JS, stub the function), so it is a weak fraud signal and should not be trusted server-side anyway. A malicious or compromised ipify response can poison it.

**Remediation direction:** Remove the client-side IP fetch. Derive the cardholder IP server-side on the gateway from `X-Forwarded-For` / the edge's `True-Client-IP` header. If you genuinely need a client-attested value (you generally do not for PCI/3DS), at minimum treat it as untrusted on the server and never use it for fraud decisions without corroboration.

#### M4 — `performRedirect` accepts arbitrary URLs from completion hooks
**Severity:** Medium
**File:** `SDK/src/sdk/core/form/helpers/performRedirect.ts` (whole file)

**Evidence:**

```ts
const resolvedUrl = new URL(rawUrl, window.location.href);
...
window.location.assign(resolvedUrl.toString());
```

A completion hook can return a string URL or `{ url, method, parameters }`, and `performRedirect` resolves it against `window.location.href`, sets it as `form.action`, and submits. For server-mode completion this is expected; in client-mode the merchant supplies the URL. If a merchant inadvertently feeds an attacker-controlled URL through `onSuccess` (e.g. from a URL query string or an AJAX response), the SDK will happily follow it — there is no allow-list, no scheme check, and no max-length. `javascript:` **is** a valid URL scheme and `window.location.assign('javascript:alert(1)')` executes.

**Remediation direction:** Validate `resolvedUrl.protocol` against an allow-list (`'https:'`, or `'https:'`+`'http:'` if you need http for local integrations). Reject `javascript:`, `data:`, `vbscript:`, `file:` explicitly. Document that `redirect.url` must be same-origin or a merchant-allow-listed domain.

#### M5 — `notification/index.html` posts to `'*'`
**Severity:** Medium
**File:** `SDK/public/notification/index.html` line 67

**Evidence:**

```js
window.parent.postMessage(payload, '*');
```

The payload is just `{ type: '3ds.challenge.close' }`, so the direct disclosure is limited. But this runs inside the 3DS challenge iframe hosted on the Monek origin, with the parent being the challenge-window iframe created by `challenge.ts`, whose own frontchannel handler checks `event.source === iframeElement.contentWindow` but does **not** check `event.origin`. That means an attacker who can get any iframe of `checkout-js.monek.com` loaded into the challenge frame can send `3ds.challenge.close` and short-circuit the 3DS result. Low direct impact today because the payload is boolean-ish, but combined with H1/H3 it is a useful gadget.

**Remediation direction:** Replace `'*'` with the known parent origin — the parent is always the frame that `challenge.ts` created, so its origin is the merchant page's origin; pass it in via `postMessage` origin or a query param, and validate it. In `challenge.ts#onWindowMessage`, also check `event.origin` against the iframe's expected origin (the Monek challenge origin) in addition to `event.source`.

#### M6 — CI pipeline uses `npm install` with `continue-on-error` and no audit gate
**Severity:** Medium
**File:** `.github/workflows/deploy.yml` lines 33-37

**Evidence:**

```yaml
- name: Install dependencies
  continue-on-error: true
  working-directory: SDK
  run: npm install
```

`npm install` (versus `npm ci`) does not strictly honour the lockfile and may silently upgrade transitives. `continue-on-error: true` means the build continues even if install fails outright, which can produce empty or corrupted `dist/` artefacts that then get synced to the production bucket with `--delete` (wiping the good prior deploy). There is no `npm audit --production --audit-level=high` step.

**Remediation direction:** Use `npm ci` (fails fast on lockfile drift). Remove `continue-on-error` on the install step — a failing install should fail the deploy. Add an `npm audit --omit=dev --audit-level=high` step (or an equivalent Dependabot/Snyk check). Consider adding OIDC scope hardening so the assumed role can only write to the specific S3 prefix.

#### M7 — `fetchAccessKeyDetails` interpolates `publicKey` into a URL path without encoding
**Severity:** Medium
**File:** `SDK/src/sdk/core/init/fetchAccessKey.ts` lines 13-15

**Evidence:**

```ts
const url = `${API.base}/key/${publicKey}`;
```

The value is SDK-caller-provided and today is expected to be `test_*` / `live_*` hex. If a merchant accidentally passes a `publicKey` containing `/`, `?`, `#`, or URL-encoded traversal, the request ends up at a different API route. Low likelihood, but cheap to fix.

**Remediation direction:** `encodeURIComponent(publicKey)` or validate with a strict regex (`/^(test|live)_[a-f0-9]{32}$/i`) before constructing the URL.

#### M8 — `performThreeDSMethodInvocation` falsely reports `'performed'` after a fallback timeout
**Severity:** Medium
**File:** `SDK/src/sdk/core/form/3ds/methodInvocation.ts` lines 90-95

**Evidence:**

```ts
window.setTimeout(() =>
{
  window.clearTimeout(timeoutId);
  cleanup();
  logger?.info('3DS method: heuristic performed');
  resolve('performed');
}, Math.min(6000, timeoutMs));
```

When the WebSocket is unavailable or never produces `3ds.method.result`, the function resolves with `'performed'` after ~6 s regardless of whether the 3DS method call actually completed. This is not itself a security issue, but downstream code reads that as "method OK" and continues to `/3ds/authenticate`, which means the issuer may be making authentication decisions without a fresh `methodCompletion`. For 3DS v2 this can downgrade RBA ("frictionless") decisions into a forced challenge — or worse, if the issuer is lenient, a missed fingerprint.

**Remediation direction:** Return `'timeout'` (not `'performed'`) from the heuristic path and let `runThreeDSFlow` decide whether to proceed or fail. Surface the true completion state in the 3DS method-completion field sent to `/3ds/authenticate`.

---

### Low

#### L1 — `console.error` leaks error objects with potential PII
**Severity:** Low
**File:** `SDK/src/sdk/core/apple/validate/validateSession.ts` line 27
**Also:** `SDK/src/sdk/core/form/helpers/performRedirect.ts` line 9, `SDK/src/sdk/core/form/pay/makePayment.ts` line 31, `SDK/src/expressCheckout/components/ExpressCheckoutApp.tsx` lines 74 and 76.

These bypass the controlled `Logger` (which has redact-keys and an enabled-flag) and print to the browser console unconditionally. The demo Apple Pay session validation logs the raw error object, which can include the validation URL and context.

**Remediation direction:** Route all logging through the existing `Logger` so redact rules and "enabled" flags apply uniformly.

#### L2 — Commented-out `'x-api-key'` in Apple Pay session validation
**Severity:** Low
**File:** `SDK/src/sdk/core/apple/validate/validateSession.ts` lines 10-14

**Evidence:**

```ts
headers: {
    "Content-Type": "application/json",
    //'x-api-key': apiKey,
},
```

The Apple Pay session-validation POST goes to `API.appleSession` **without** an API key, unlike every other request in the SDK. Either the server-side endpoint does its own attribution via the signed Apple validation URL and domain verification (in which case the header is genuinely unnecessary and the commented-out line should be deleted), or this is an authentication gap. Worth a gateway-side confirmation.

**Remediation direction:** Either delete the commented line with a code comment explaining why the endpoint doesn't need the key, or re-enable the header. Do not ship commented-out auth code as an open question.

#### L3 — Apple Pay SDK loaded without Subresource Integrity
**Severity:** Low
**File:** `SDK/src/sdk/core/apple/applePayReady.ts` lines 17-20

**Evidence:**

```ts
s.src = 'https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js';
```

The `1.latest/` path is intentionally mutable (Apple updates it), so SRI is not usable here. Noted for awareness rather than remediation — Apple's CDN is the only acceptable source for this script.

**Remediation direction:** Keep as-is. Consider adding a CSP `script-src https://applepay.cdn-apple.com` so only this specific domain can be loaded as a script from the SDK page.

#### L4 — `//TODO REMOVE` dead-ish field in 3DS authenticate response mapping
**Severity:** Low
**File:** `SDK/src/sdk/core/form/3ds/authenticate.ts` line 28

**Evidence:**

```ts
serverTransactionId: j.ServerTransactionID ?? j.serverTransactionID, //TODO REMOVE
```

Tracking-debt, not a vulnerability, but visible in the committed output.

**Remediation direction:** Either remove the field or drop the TODO.

#### L5 — No Dependabot / Renovate config; GitHub Actions not SHA-pinned; no audit job
**Severity:** Low
**Files:** `.github/workflows/deploy.yml` (actions referenced), no `dependabot.yml`

The only GitHub workflow is `deploy.yml`. There is no scheduled `npm audit` job, no Dependabot config, no CodeQL, and no pinned digests on action versions (`actions/checkout@v4`, `actions/setup-node@v4`, `aws-actions/configure-aws-credentials@v4` are referenced by tag). Any one of those actions being hijacked would execute in the context of the deploy job with `id-token: write`, i.e. able to mint the AWS role and publish a poisoned `monek-checkout.iife.js`.

**Remediation direction:** Pin all `uses: …@<version>` to the commit SHA (Actions Best Practices). Add Dependabot for both `github-actions` and `npm` ecosystems. Add a scheduled `npm audit --omit=dev --audit-level=high` job on `main`.

#### L6 — `demo-complete/` and demo dashboard pages ship to production CDN
**Severity:** Low
**Files:** `SDK/public/demo-complete/index.html`, `SDK/index.html`

The demo dashboard, including the hardcoded keys from C1, is part of the built site (referenced from `vite.config.ts` as an entry). It is therefore served from `checkout-js.monek.com`. Even after C1 is fixed, shipping a public demo that exercises real merchant keys is fragile — a refactor can re-introduce the problem.

**Remediation direction:** Build the demo in a separate Vite config that is not part of `npm run build` / `npm run build:site`, or serve it only from a `demo.checkout-js.monek.com` subdomain that is not treated as production SDK surface. Fail the deploy if `index.html` contains strings matching `live_[0-9a-f]{32}`.

---

### Info

#### I1 — `parentUrl` revealed in Apple Pay merchant validation
**File:** `SDK/src/sdk/core/apple/validate/handleValidateSession.ts` line 17
`parentUrl: document.location.hostname` is posted to the Apple-Pay session endpoint. This is expected (Apple Pay uses domain verification), but noting so that the privacy statement / data-flow diagram reflects it.

#### I2 — Dead query-string parsing in the 3DS notification page
**File:** `SDK/public/notification/index.html` lines 58-61
`qp(name)` is defined but never called.

#### I3 — `scheduled-task` description describes the repo as ".NET/C# SDK" but the repo is TypeScript
The scheduled-task SKILL file has since been updated to reflect the TypeScript/React/Vite stack; this run uses the updated description. No security consequence.

---

## Delta since last run

**Previous run:** `weekly-monek-checkout-sdk-red-team-report-2026-04-23.md` (08:10 UTC, same day).
**Working-tree diff vs. previous run:** none. SHA still `ed6eb78`, no new commits on `main`.

- **NEW** findings: none.
- **RESOLVED** findings: none.
- **PERSISTS** (all 21 findings re-verified in place): C1, H1, H2, H3, M1, M2, M3, M4, M5, M6, M7, M8, L1, L2, L3, L4, L5, L6, I1, I2, I3.
- **WHITELISTED** findings: none (see Whitelist section).

---

## Whitelist

No `.cowork/red-team-whitelist.md` (or `.yml`/`.json`) exists. Whitelist is empty; nothing is suppressed.

---

## Assumptions and caveats

1. The scheduled-task file's Target section describes the repo as "TypeScript / React / Vite browser SDK" and the review is weighted accordingly. The repo contains no `.cs`, `.csproj`, `appsettings*.json`, or other .NET artefacts — only a `.esproj` (Visual Studio JS project wrapper), TS/TSX under `SDK/src`, and a Vite build.
2. No `.cowork/red-team-whitelist.md` exists. Whitelist treated as empty.
3. Review is static. No payload execution, no `npm install`, no `npm audit` was performed (network-side supply-chain surface is noted but not enumerated against the CVE database).
4. Finding IDs (C1, H1, …) are kept stable across runs for the same file/issue so that deltas remain meaningful. New findings get the next free ID in their severity band.
5. `git pull` did not complete this run due to a Windows-side maintenance lock (see Operational notes). Review ran against the current working tree at SHA `ed6eb78`, which was confirmed identical to the remote the last time a pull succeeded (earlier today). If a new commit has landed on the remote since, it was not picked up in this run and will be reviewed next week.

---

## Operational notes

- Pull step: `git pull --ff-only` failed with `Another git process seems to be running in this repository`. Lock files present: `.git/ORIG_HEAD.lock` and `.git/objects/maintenance.lock`. Per scheduled-task rules these Windows-side locks are tolerated as benign; the current working tree at `ed6eb78` was reviewed.
- Mount succeeded without prompting; host paths `C:\Users\AdrianDavies\github\Monek.Checkout.SDK` and `C:\Users\AdrianDavies\OneDrive - Monek LTD\red-team-reports` are pre-approved.
- `.cowork/reports/` already contained a 2026-04-23 report from an earlier run (08:10). That report was used as the "previous run" baseline and overwritten with this one.
- No `.cowork/red-team-whitelist.md` present — nothing suppressed.
- No network operations performed other than the (failed) `git pull`. No files in the repository were modified outside `.cowork/reports/`.
- HTML email body mirrored to `C:\Users\AdrianDavies\OneDrive - Monek LTD\red-team-reports\weekly-monek-checkout-sdk-red-team-report-2026-04-23.html` for Power Automate pickup.

---

## Jira sync summary

**Atlassian site:** `monekltd.atlassian.net` · **project:** `SAM` · **epic:** `SAM-7298` (Security Review 2026) · **issue type:** `Security`

**Dedup lookup:** JQL `"Epic Link" = SAM-7298 AND labels = "repo-monek-checkout-sdk"` returned 0 results — no existing red-team tickets for this repo. All 18 non-Info findings below were ticketed fresh.

**Tickets created this run (18):**

| Finding | Severity | Jira key |
|---|---|---|
| C1 | Critical | [SAM-7564](https://monekltd.atlassian.net/browse/SAM-7564) |
| H1 | High | [SAM-7565](https://monekltd.atlassian.net/browse/SAM-7565) |
| H2 | High | [SAM-7566](https://monekltd.atlassian.net/browse/SAM-7566) |
| H3 | High | [SAM-7567](https://monekltd.atlassian.net/browse/SAM-7567) |
| M1 | Medium | [SAM-7568](https://monekltd.atlassian.net/browse/SAM-7568) |
| M2 | Medium | [SAM-7569](https://monekltd.atlassian.net/browse/SAM-7569) |
| M3 | Medium | [SAM-7570](https://monekltd.atlassian.net/browse/SAM-7570) |
| M4 | Medium | [SAM-7571](https://monekltd.atlassian.net/browse/SAM-7571) |
| M5 | Medium | [SAM-7572](https://monekltd.atlassian.net/browse/SAM-7572) |
| M6 | Medium | [SAM-7573](https://monekltd.atlassian.net/browse/SAM-7573) |
| M7 | Medium | [SAM-7574](https://monekltd.atlassian.net/browse/SAM-7574) |
| M8 | Medium | [SAM-7575](https://monekltd.atlassian.net/browse/SAM-7575) |
| L1 | Low | [SAM-7576](https://monekltd.atlassian.net/browse/SAM-7576) |
| L2 | Low | [SAM-7577](https://monekltd.atlassian.net/browse/SAM-7577) |
| L3 | Low | [SAM-7578](https://monekltd.atlassian.net/browse/SAM-7578) |
| L4 | Low | [SAM-7579](https://monekltd.atlassian.net/browse/SAM-7579) |
| L5 | Low | [SAM-7580](https://monekltd.atlassian.net/browse/SAM-7580) |
| L6 | Low | [SAM-7581](https://monekltd.atlassian.net/browse/SAM-7581) |

**Skipped because a ticket already existed:** none (no prior tickets).

**Info findings (I1, I2, I3):** intentionally not ticketed, per rules.

**Errors:** none. All 18 issues created with priority, labels (`redteam-auto`, `repo-monek-checkout-sdk`, `redteam-monek-checkout-sdk-finding-<id>`, `redteam-severity-<severity>`) and Epic Link = `SAM-7298` (via `customfield_10013`). Initial attempt used `customfield_10014` for Epic Link and failed with `"Start date must be of the format yyyy-MM-dd"`; switched to the correct `customfield_10013` identified via `getJiraIssueTypeMetaWithFields` and all subsequent creates succeeded on the first try.
