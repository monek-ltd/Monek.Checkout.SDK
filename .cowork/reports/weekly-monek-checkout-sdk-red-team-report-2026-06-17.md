# Weekly Red Team Report — Monek.Checkout.SDK

**Run date:** 2026-06-17
**Scheduled task:** `weekly-red-team-report---monekcheckoutsdk`
**Branch:** `main`
**HEAD SHA:** `baca69b` (`Update-apple-pay-domain-name (#50)`, 2026-06-01)
**Tracked files:** 86
**Stack:** TypeScript / React / Vite — browser SDK (hosted card fields + Apple Pay via sandboxed iframes)
**Pull status:** `git pull --ff-only` → `Already up to date`. One benign Windows-side lock warning (`unable to unlink '.git/ORIG_HEAD.lock': Operation not permitted`) — see Operational notes.

> Source re-verified against live code at `baca69b`. The repo is connected as a Cowork directory this run, so every finding below was re-read against live source. All line numbers were freshly measured this run.

---

## TL;DR

No code change since the last run (2026-06-04). `main` is still at `baca69b`; the most recent commit (`baca69b`, PR #50) edits only the Apple Pay `apple-developer-merchantid-domain-association` verification file, which is benign. Re-reading every finding against live source confirms the SDK is materially **unchanged since the `ed6eb78` baseline**. **All 21 findings remain open** (1 Critical, 3 High, 8 Medium, 6 Low, 3 Info). **No findings fixed, no new findings, nothing whitelisted.** The Critical (C1) — two `live_*` and two `test_*` merchant keys committed to the demo page — remains in source and must be treated as long-since public.

The L2 `x-api-key` comment is still present on `main` (line 11 of `validateSession.ts`); the PR that removes it has still not merged, so L2 stays open. No other movement.

## Severity counts

| Critical | High | Medium | Low | Info |
|---------:|-----:|-------:|----:|-----:|
|       1  |   3  |     8  |  6  |   3  |

## Top priorities

1. **Rotate the four merchant keys in `SDK/index.html:210-214` today** (C1). Two `live_*`, two `test_*`, mapping to real merchant numbers. They reach the public CDN via the `main` Vite entry. Assume public; revoke gateway-side and add a deploy-time grep for `live_[0-9a-f]{32}`.
2. **Escape the method-invocation iframe like the challenge iframe already does** (H1). `methodInvocation.ts:34-35` interpolates `${methodUrl}`/`${methodData}` straight into `document.write` with no escaping, while `challenge.ts:68-69` already wraps its values in `escapeHtml()`. Port the same helper across.
3. **Make `parentOrigin` mandatory and validate every inbound message** (H2). `HostedFieldsApp.tsx:16` and `ExpressCheckoutApp.tsx:13` default to `'*'`; the `PING_FROM_PARENT` handler captures `event.origin` unconditionally on first contact (`HostedFieldsApp.tsx:190`, `ExpressCheckoutApp.tsx:90`). An embedding attacker page completes the handshake.
4. **Drop `allow-same-origin` from the iframe sandbox** (H3, `createIframe.ts:13`) and pair with a strict CSP.
5. **Lock down the deploy pipeline** (M6, L5, `deploy.yml`): `npm ci` not `npm install`, remove `continue-on-error: true`, add `npm audit --audit-level=high`, SHA-pin Actions, add Dependabot, and add a `live_*` key grep so C1-class regressions fail the build.

---

## Findings

> All findings re-verified against live source at `baca69b` this run. Line numbers are freshly measured.

### C1 — Hardcoded merchant API keys in committed demo HTML
- **Severity:** Critical
- **Location:** `SDK/index.html:210-214`
- **Description:** Four merchant API keys are embedded in the demo page: `test_9290ecf1…` (0000894), `test_73cd7463…` (0000015), `live_312ede4e…` (0000894), `live_105aae69…` (0150185). `index.html` is the `main` entry in `SDK/vite.config.ts`, so it builds and ships to `checkout-js.monek.com`. Anyone who views source or scrapes the CDN can extract them.
- **Evidence:** Ternaries at `index.html:210-214` select between committed `test_*` and `live_*` literals.
- **Recommendation:** Rotate all four keys today and revoke gateway-side. Replace the demo with placeholder keys plus a runtime warning. Add a deploy-time grep for `live_[0-9a-f]{32}` to fail CI on regression.
- **Jira:** `SAM-7564` (existing).

### H1 — HTML injection in 3DS method-invocation iframe via `document.write`
- **Severity:** High
- **Location:** `SDK/src/sdk/core/form/3ds/methodInvocation.ts:34-35`
- **Description:** The hidden method-invocation iframe is built by string concatenation and committed with `iframeDocument.write(...)`, interpolating `${methodUrl}` and `${methodData}` from the gateway response **without HTML-escaping**. A malicious or compromised 3DS response can inject markup/script into the iframe document. Note the inconsistency: the sibling `challenge.ts` already escapes equivalent values.
- **Evidence:** `<form ... action="${methodUrl}" ...><input ... value="${methodData}"></form>` then an inline `<script>` submit — all via `document.write`.
- **Recommendation:** Build the form with `document.createElement` / `setAttribute` / `textContent`, or at minimum reuse `challenge.ts`'s `escapeHtml()`. Drop `document.write`; this also unblocks a strict CSP.
- **Jira:** `SAM-7565` (existing).

### H2 — `parentOrigin` defaults to `'*'`; first `PING_FROM_PARENT` trusted unconditionally
- **Severity:** High
- **Location:** `SDK/src/hostedFields/components/HostedFieldsApp.tsx:16,189-198`; `SDK/src/expressCheckout/components/ExpressCheckoutApp.tsx:13,89-98`
- **Description:** When `parentOrigin` is absent from the iframe URL it defaults to `'*'`. On the first `PING_FROM_PARENT` the handler sets `allowedOriginRef.current = event.origin` with no validation, and the later guard `if (allowed !== '*' && event.origin !== allowed)` is a no-op while `allowed` is `'*'`. An attacker page embedding the iframe completes the handshake and joins the channel.
- **Evidence:** `getParams().get('parentOrigin') || '*'`; `allowedOriginRef.current = event.origin` inside the `PING_FROM_PARENT` branch (HostedFields line 190, Express line 90).
- **Recommendation:** Require `parentOrigin` in the iframe URL; refuse to start if absent. Validate `event.origin` against it on every message including the first.
- **Jira:** `SAM-7566` (existing).

### H3 — Iframe sandbox negated by `allow-scripts allow-same-origin`
- **Severity:** High
- **Location:** `SDK/src/sdk/core/iframe/createIframe.ts:13`
- **Description:** `createSandboxedIframe` sets `sandbox="allow-scripts allow-same-origin"`. This combination is a documented sandbox bypass: scripts in the iframe can reach `document.cookie` / `localStorage` and other same-origin state for `checkout-js.monek.com`, defeating most of the protection the sandbox would otherwise give.
- **Evidence:** `iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')`.
- **Recommendation:** Drop `allow-same-origin`. Pair with a strict CSP on the iframe document.
- **Jira:** `SAM-7567` (existing).

### M1 — 3DS challenge iframe uses inline `<script>` via `document.write`, forcing `'unsafe-inline'`
- **Severity:** Medium
- **Location:** `SDK/src/sdk/core/form/3ds/challenge.ts:65-74`
- **Description:** The challenge iframe is composed with `innerDocument.write(...)` including an inline `<script>` that auto-submits the ACS form. This forces `'unsafe-inline'` on any future CSP for the iframe origin. The interpolated `acsUrl` and `creq` *are* HTML-escaped here (`escapeHtml()`, lines 68-69), so the injection vector is already closed — only the inline-script / CSP concern remains.
- **Evidence:** `<script>document.getElementById('monek-3ds-form').submit();</script>` inside the `document.write` template (line 71).
- **Recommendation:** Build via DOM APIs and externalise the submit script to a same-origin file CSP can allow via `'self'`, so `'unsafe-inline'` is not required.
- **Jira:** `SAM-7568` (existing).

### M2 — `safeUuid()` falls back to `Math.random()` for idempotency tokens
- **Severity:** Medium
- **Location:** `SDK/src/sdk/core/form/pay/buildPaymentRequest.ts:107-118`; `SDK/src/sdk/core/apple/pay/handlePaymentAuthorised.ts:379-393`
- **Description:** Both `safeUuid()` implementations fall back to `` `sdk-${Date.now()}-${Math.random().toString(36).slice(2)}` `` when `crypto.randomUUID` is unavailable. These tokens are used for gateway idempotency/de-dup; `Math.random` collisions on older engines risk double-charge or replay edges.
- **Evidence:** `return \`sdk-${Date.now()}-${Math.random().toString(36).slice(2)}\`;` at both sites (lines 118 / 393).
- **Recommendation:** Throw / surface an error if Web Crypto is unavailable, or require a polyfill at SDK init, rather than silently degrading.
- **Jira:** `SAM-7569` (existing).

### M3 — Client IP fetched from `api.ipify.org` and forwarded as `sourceIpAddress`
- **Severity:** Medium
- **Location:** `SDK/src/sdk/core/utils/getClientIp.ts:1-21`
- **Description:** `getClientIpViaIpify()` issues client-side `fetch`es to `https://api.ipify.org` (and `api64.ipify.org` fallback) and the result is threaded into payment / 3DS / Apple Pay payloads. Wrong trust boundary (browser-supplied IP) and a third-party dependency on the critical checkout path.
- **Evidence:** `fetchWithTimeout('https://api.ipify.org?format=json')` (line 10), with `api64.ipify.org` fallback (line 15).
- **Recommendation:** Drop the client-side call; source the IP server-side from the inbound TCP connection at the gateway.
- **Jira:** `SAM-7570` (existing).

### M4 — `performRedirect` accepts arbitrary URLs (no scheme allow-list)
- **Severity:** Medium
- **Location:** `SDK/src/sdk/core/form/helpers/performRedirect.ts:3-19`
- **Description:** `performRedirect` resolves a completion-hook-supplied URL with `new URL(rawUrl, location.href)` and calls `window.location.assign(...)` with no scheme validation. Dangerous schemes (e.g. `javascript:`) are not rejected.
- **Evidence:** `const resolvedUrl = new URL(rawUrl, window.location.href);` (line 15) … `window.location.assign(resolvedUrl.toString());` (line 19) with no allow-list.
- **Recommendation:** Allow-list `https:` (and `http:` only for explicit dev). Reject other schemes with a thrown error.
- **Jira:** `SAM-7571` (existing).

### M5 — `notification/index.html` posts to `'*'`; challenge handler checks source but not origin
- **Severity:** Medium
- **Location:** `SDK/public/notification/index.html:67`; consumed by `SDK/src/sdk/core/form/3ds/challenge.ts:132-140`
- **Description:** The notification page posts `{ type: '3ds.challenge.close' }` with `window.parent.postMessage(payload, '*')`. The parent handler in `challenge.ts` *does* gate on `event.source !== iframeElement.contentWindow`, which materially limits who can trigger close — but it still does not validate `event.origin`, and the sender still broadcasts to `'*'`.
- **Evidence:** `window.parent.postMessage(payload, '*')` (sender, line 67); `if (event.source !== iframeElement.contentWindow) return;` (consumer, no origin check).
- **Recommendation:** Post to a known origin and validate `event.origin` against the same value in addition to the existing `event.source` check.
- **Jira:** `SAM-7572` (existing).

### M6 — Deploy pipeline uses `npm install` with `continue-on-error` and no audit gate
- **Severity:** Medium
- **Location:** `.github/workflows/deploy.yml:36-46`
- **Description:** The deploy workflow runs `npm install` (not `npm ci`) under `continue-on-error: true`, never runs `npm audit`, then `aws s3 sync ./SDK/dist s3://checkout-js.monek.com --delete`. A failed/partial install does not block the production sync.
- **Evidence:** `continue-on-error: true` (line 37) / `run: npm install` (line 39); deploy step `aws s3 sync … --delete` (line 46).
- **Recommendation:** `npm ci`, drop `continue-on-error`, add `npm audit --audit-level=high`, SHA-pin Actions.
- **Jira:** `SAM-7573` (existing).

### M7 — `fetchAccessKeyDetails` interpolates `publicKey` into URL path without encoding
- **Severity:** Medium
- **Location:** `SDK/src/sdk/core/init/fetchAccessKey.ts:14`
- **Description:** `const url = \`${API.base}/key/${publicKey}\`;` interpolates `publicKey` straight into the path with no `encodeURIComponent`. Malformed input lands verbatim against the gateway (path-traversal / injection surface).
- **Evidence:** `${API.base}/key/${publicKey}` (line 14) with no encoding; `publicKey` also passed as `x-api-key` header (line 15).
- **Recommendation:** Wrap with `encodeURIComponent` and validate the key format (regex) at SDK init.
- **Jira:** `SAM-7574` (existing).

### M8 — `performThreeDSMethodInvocation` resolves `'performed'` on heuristic fallback
- **Severity:** Medium
- **Location:** `SDK/src/sdk/core/form/3ds/methodInvocation.ts:91-97`
- **Description:** The hard `setTimeout` resolves `'timeout'` (line 50), an improvement. But when a WebSocket client is present and its wait fails, the heuristic fallback (`setTimeout(..., Math.min(6000, timeoutMs))`) still resolves `'performed'` without confirmation that the method actually completed. Downstream `/3ds/authenticate` then runs on optimistic state.
- **Evidence:** Fallback block: `logger?.info('3DS method: heuristic performed');` (line 95) `resolve('performed');` (line 96).
- **Recommendation:** Resolve the heuristic path with `'unknown'` (extend the return union) and let the gateway choose the authentication path.
- **Jira:** `SAM-7575` (existing).

### L1 — Raw `console.error`/`console.log` bypasses `Logger` redaction
- **Severity:** Low
- **Location:** `SDK/src/sdk/core/apple/validate/validateSession.ts:27`; `SDK/src/sdk/core/form/helpers/performRedirect.ts:9`; `SDK/src/sdk/core/form/pay/makePayment.ts:31`; `SDK/src/expressCheckout/components/ExpressCheckoutApp.tsx:74,76`
- **Description:** Several paths log raw error/info objects via `console.*` directly, bypassing the `Logger` redaction rules and surfacing internal state (URLs, server messages) into the browser console.
- **Evidence:** `console.error("Error during validating merchant: ", error)`; `console.log('[Pay]', message, data ?? '')`.
- **Recommendation:** Route all logging through `Logger`; never `console.*` raw objects in production builds.
- **Jira:** `SAM-7576` (existing).

### L2 — Commented-out `x-api-key` header in Apple Pay session validation
- **Severity:** Low
- **Location:** `SDK/src/sdk/core/apple/validate/validateSession.ts:11`
- **Description:** `//'x-api-key': apiKey,` remains commented out in the validate-session request headers. A commented security control is ambiguous in source. A PR removing this line was noted in prior runs (rationale: Monek controls the endpoint, no API key required, validation happens Apple-side), but it is **still not merged to `main`** as of this run, so L2 remains open.
- **Evidence:** `headers: { "Content-Type": "application/json", //'x-api-key': apiKey, }` (line 11).
- **Recommendation:** Land the open PR (delete the comment), or ship the header if it is in fact required — no commented controls in source either way.
- **Jira:** `SAM-7577` (existing).

### L3 — Apple Pay SDK loaded from `1.latest/` without SRI
- **Severity:** Low
- **Location:** `SDK/src/expressCheckout/express-checkout.html:9`; `SDK/src/sdk/core/apple/applePayReady.ts:22`
- **Description:** Apple's Apple Pay JS SDK is loaded from `https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js`. SRI is impossible by design (mutable URL), so the residual supply-chain risk should be mitigated another way.
- **Evidence:** `<script src="https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js"></script>` and the dynamic injection in `applePayReady.ts:22`.
- **Recommendation:** Pin a strict CSP `script-src` to Apple's origins; monitor for script changes.
- **Jira:** `SAM-7578` (existing).

### L4 — `//TODO REMOVE` on `serverTransactionId` mapping in `authenticate.ts`
- **Severity:** Low
- **Location:** `SDK/src/sdk/core/form/3ds/authenticate.ts:31`
- **Description:** `serverTransactionId: j.ServerTransactionID ?? j.serverTransactionID, //TODO REMOVE` — ambiguous whether the field is required or dead.
- **Evidence:** The `//TODO REMOVE` comment on the mapping line (line 31).
- **Recommendation:** Resolve the TODO: keep and remove the comment if required, delete the field if dead.
- **Jira:** `SAM-7579` (existing).

### L5 — No Dependabot/Renovate; Actions not SHA-pinned; no scheduled audit
- **Severity:** Low
- **Location:** `.github/workflows/` (only `deploy.yml` present)
- **Description:** No dependency-update automation; `actions/checkout@v4`, `actions/setup-node@v4`, `aws-actions/configure-aws-credentials@v4` referenced by mutable tag, not SHA; no scheduled `npm audit` workflow.
- **Evidence:** `uses: actions/checkout@v4` etc. (lines 19, 20, 27); no `dependabot.yml`; single workflow file.
- **Recommendation:** Add Dependabot or Renovate, SHA-pin Actions, add a weekly audit workflow with thresholding.
- **Jira:** `SAM-7580` (existing).

### L6 — Demo pages ship to production CDN
- **Severity:** Low
- **Location:** `SDK/vite.config.ts:13-17` (`main` = `index.html`); `SDK/public/demo-complete/index.html`
- **Description:** `index.html` (the interactive demo with the TEST/LIVE toggle) is the `main` build entry and reaches `checkout-js.monek.com`. `SDK/public/demo-complete/` is copied verbatim by Vite's public-dir handling and also ships. This is the regression vector for C1.
- **Evidence:** `main: resolve(__dirname, 'index.html')` (line 14); `public/demo-complete/` present.
- **Recommendation:** Split the demo into a separate build; do not deploy demo HTML to the production CDN bucket.
- **Jira:** `SAM-7581` (existing).

### I1 — `parentUrl` in Apple Pay validation request
- **Severity:** Info
- **Location:** `SDK/src/sdk/core/apple/validate/handleValidateSession.ts:19`
- **Description:** The validation request includes `parentUrl: document.location.hostname`. Apple already enforces the merchant domain at session create; this field appears unused on the gateway side.
- **Recommendation:** Confirm whether the gateway consumes it; if not, remove.
- **Jira:** not ticketed (Info excluded by policy).

### I2 — Dead `qp()` helper in notification page
- **Severity:** Info
- **Location:** `SDK/public/notification/index.html:56`
- **Description:** Query-string helper `qp()` is defined but never called by current code.
- **Recommendation:** Remove dead code.
- **Jira:** not ticketed (Info excluded by policy).

### I3 — Scheduled-task description drift
- **Severity:** Info
- **Location:** uploaded `SKILL.md` for this task vs prior `.cowork/red-team-skill.md`
- **Description:** Earlier runs referenced a `red-team-skill.md` inside the repo; current runs use the SKILL.md attached to the scheduled task. Minor drift, not a security issue.
- **Recommendation:** Pick one source of truth.
- **Jira:** not ticketed (Info excluded by policy).

---

## Delta since last run (vs. 2026-06-04)

- **Fixed:** 0. `main` is still at `baca69b`; no source change since the prior run. The L2 fix remains in an unmerged PR.
- **Still open:** 21 (C1, H1–H3, M1–M8, L1–L6, I1–I3).
- **New:** 0.
- **Whitelisted:** 0.

No finding IDs were added, retired, or re-banded this run. IDs and Jira mappings are unchanged from 2026-06-04.

## Whitelist

No `.cowork/red-team-whitelist.md` (or `.yml`/`.json`) present at run time. Whitelist is empty; nothing suppressed.

## Assumptions and caveats

1. **Source fully re-verified this run.** The repo is connected as a Cowork directory, so `Read`/`Grep`/shell all work against live source. Line numbers are freshly measured against `baca69b`.
2. **L2 fix is in an unmerged PR.** The working tree and `main` still contain the commented `x-api-key` line, so L2 is reported open. The PR's rationale (Monek-controlled endpoint, no API key required, Apple-side validation) is sound; L2 should close once it deploys.
3. **Working-tree line-ending noise.** `git status` may show files as "modified" due to CRLF↔LF differences only, not content changes. Committed `HEAD` (`baca69b`) is the source of truth used here.
4. **Jira ticket statuses were not queried for content this run** beyond the dedup label search (see Jira sync summary). Ticket lifecycle is owned by the team and left untouched.

## Operational notes

- Workspace mounts this run: `outputs`, `red-team-reports`, `uploads`, the repo at `C:\Users\AdrianDavies\github\Monek.Checkout.SDK`, and the `Documents\Claude\Scheduled` template folder. Full read access to the repo confirmed.
- `git pull --ff-only` returned `Already up to date` with one benign Windows-side warning: `unable to unlink '.git/ORIG_HEAD.lock': Operation not permitted`. No impact on the pull result.
- This markdown is written to the canonical `.cowork/reports/` path; the HTML companion is written to the OneDrive `red-team-reports` folder for Power Automate delivery.
- **Jira sync:** dedup query matched all 18 existing non-Info tickets by namespaced finding label; **0 new tickets created** this run (no new findings). No existing tickets were updated, transitioned, or commented on, per task rules. See Jira sync summary for details.

## Jira sync summary

- **Dedup query:** `"Epic Link" = SAM-7298 AND labels = "repo-monek-checkout-sdk"` (requesting the `labels` field) returned the existing red-team tickets `SAM-7564`–`SAM-7581` (18 non-Info findings), each carrying its `redteam-monek-checkout-sdk-finding-<id>` label. Full dedup hit set.
- **New tickets created this run:** 0 (no new findings).
- **Skipped as duplicates (ticket already existed):** C1 (`SAM-7564`), H1 (`SAM-7565`), H2 (`SAM-7566`), H3 (`SAM-7567`), M1 (`SAM-7568`), M2 (`SAM-7569`), M3 (`SAM-7570`), M4 (`SAM-7571`), M5 (`SAM-7572`), M6 (`SAM-7573`), M7 (`SAM-7574`), M8 (`SAM-7575`), L1 (`SAM-7576`), L2 (`SAM-7577`), L3 (`SAM-7578`), L4 (`SAM-7579`), L5 (`SAM-7580`), L6 (`SAM-7581`).
- **Info findings (I1, I2, I3):** not ticketed by policy.
- **Existing-ticket lifecycle:** untouched by this task (no update/transition/comment).
- **Errors:** none.
