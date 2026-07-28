# Weekly Red Team Report — Monek.Checkout.SDK

**Run date:** 2026-07-28
**Scheduled task:** `weekly-red-team-report---monekcheckoutsdk`
**Branch:** `main`
**HEAD SHA:** `e64db09` (`MON-3297: Better challenge outcome handling (#57)`)
**Tracked files:** 87
**Stack:** TypeScript / React / Vite — browser SDK (hosted card fields + Apple Pay via sandboxed iframes)
**Pull status:** `git pull --ff-only` reported `Already up to date`. One benign Windows-side lock warning (`unable to unlink '.git/ORIG_HEAD.lock': Operation not permitted`) — see Operational notes.

> Three commits landed since the previous run (2026-07-15, `59d12c2`): `e71c8bb` (SAM-7977, "Improve 3DS2 challenge redirect", #55), `193a1e2` ("Ensure unhappy-path challenge flow consistency", #56) and `e64db09` (MON-3297, "Better challenge outcome handling", #57). They rework the 3DS2 challenge return path: a new front-channel notification page (`SDK/public/notification/index.html`) posts a `3ds.challenge.close` message to the SDK, and `challenge.ts` / `threeDSFlow.ts` now branch on the ACS `transStatus` carried by that close. This is the only new code surface this week and is the focus of the review.

---

## TL;DR

**The 3DS challenge-return rework is a net security improvement, but it introduced one new Medium.** The unhappy-path handling is materially better than before: `threeDSFlow.ts` now maps the ACS `transStatus` (`Y`/`A` → authenticated, everything else → `not-authenticated` → `onError`, failing closed), and the challenge receiver in `challenge.ts` correctly gates inbound messages on both `event.source === iframe.contentWindow` **and** `event.origin === new URL(FRAMES.base).origin` — good origin hygiene. The concern (**M9**, new) is that a *status-bearing* front-channel close is treated as **authoritative** and resolves the flow immediately, winning the race against the trustworthy WebSocket back-channel — and that status ultimately originates from a URL query parameter (`transStatus`/`status`) on the notification page, i.e. a browser-visible, cardholder-observable channel. The gateway remains the real authority server-side, so this is defence-in-depth rather than a direct bypass, but the SDK should prefer the back-channel result and not let a client-controllable status gate completion.

**The two long-standing Highs are unchanged for a sixth consecutive run.** The iframe sandbox still pairs `allow-scripts` with `allow-same-origin` (**H3**, `createIframe.ts:13`), and both hosted-field / express iframe apps still overwrite the trusted `parentOrigin` param with `event.origin` from the first `PING_FROM_PARENT` (**H2**). `safeUuid()` still degrades to `Math.random()` (**M2**), the 3DS method heuristic still resolves `'performed'` (**M8**), and the three Lows and three Infos persist. Repo-wide sweeps (wildcard `postMessage` `targetOrigin`, `document.write`, `eval`/`new Function`, `javascript:` URLs, committed `test_`/`live_` secrets) came back clean. **0 fixed, 1 new, 0 whitelisted.**

## Severity counts

| Critical | High | Medium | Low | Info |
|---------:|-----:|-------:|----:|-----:|
|       0  |   2  |     3  |  3  |   3  |

Open findings: **11** (was 10). Fixed this run: **0**. New this run: **1** (M9).

## Top priorities

1. **Prefer the WebSocket back-channel over the front-channel status** (M9, new — `challenge.ts:152-160`, `notification/index.html:69-84`). A status-bearing `3ds.challenge.close` short-circuits the grace window and is trusted as the authentication outcome, but the status comes from a URL query param the cardholder can observe/modify. Treat the front-channel status as advisory only; let the server-originated back-channel result decide, or re-verify server-side before completion.
2. **Drop `allow-same-origin` from the iframe sandbox** (H3, `createIframe.ts:13`). Highest-severity open item, unchanged for a sixth consecutive run. The `document.write` dependencies that once justified it are long gone.
3. **Stop trusting the first `PING_FROM_PARENT` origin** (H2, `HostedFieldsApp.tsx:197` / `ExpressCheckoutApp.tsx:93`). The child still overwrites the mandatory `parentOrigin` param with `event.origin` on first contact. Validate `event.origin === parentOriginParam` on every message.
4. **Fail closed when Web Crypto is unavailable** (M2). Both `safeUuid()` implementations still end in `Math.random()`; the Apple Pay copy (`handlePaymentAuthorised.ts:443`) still lacks the `getRandomValues` intermediate.
5. **Resolve the 3DS method heuristic to `'unknown'`, not `'performed'`** (M8, `methodInvocation.ts:82-87`).

---

## Findings

> All findings re-verified against live source at `e64db09` this run by grep/read. New code from PRs #55–57 reviewed in full.

### H2 — `parentOrigin` handshake still captures `event.origin` from first `PING_FROM_PARENT`
- **Severity:** High
- **Location:** `SDK/src/hostedFields/components/HostedFieldsApp.tsx:197`; `SDK/src/expressCheckout/components/ExpressCheckoutApp.tsx:93`
- **Description:** Unchanged. `allowedOriginRef` initialises from the mandatory `parentOrigin` param, but the `PING_FROM_PARENT` handler still executes `allowedOriginRef.current = event.origin` unconditionally on first contact, overwriting the trusted param with whatever origin sent the ping. A hostile embedding page that posts `PING_FROM_PARENT` first can still receive `tokenised` / `expiry` messages. Note the subsequent guard `if (allowed !== '*' && event.origin !== allowed)` (HostedFields line 205) also silently permits a wildcard `'*'` allowed-origin should one ever be set.
- **Evidence:** `allowedOriginRef.current = event.origin;` inside the `PING_FROM_PARENT` branch (HostedFields line 197, Express line 93).
- **Recommendation:** Do not reassign `allowedOriginRef` from `event.origin`. Validate `event.origin === parentOriginParam` on every inbound message (including the ping) and ignore mismatches.
- **Jira:** `SAM-7566` (existing).

### H3 — Iframe sandbox negated by `allow-scripts allow-same-origin`
- **Severity:** High
- **Location:** `SDK/src/sdk/core/iframe/createIframe.ts:13`
- **Description:** Unchanged. `createSandboxedIframe` still sets `sandbox="allow-scripts allow-same-origin"` — a documented sandbox bypass. Scripts inside the iframe can reach same-origin state for the frames host (`checkout-js.monek.com`), defeating most of the intended isolation.
- **Evidence:** `iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');` (line 13).
- **Recommendation:** Drop `allow-same-origin`; pair with a strict CSP on the iframe document.
- **Jira:** `SAM-7567` (existing).

### M2 — `safeUuid()` still falls back to `Math.random()` for idempotency tokens
- **Severity:** Medium
- **Location:** `SDK/src/sdk/core/form/pay/buildPaymentRequest.ts:101-114`; `SDK/src/sdk/core/apple/pay/handlePaymentAuthorised.ts:429-443`
- **Description:** Unchanged. The payment-path `safeUuid()` tries `crypto.randomUUID()` then `crypto.getRandomValues(new Uint8Array(16))` but still ends in `` `sdk-${Date.now()}-${Math.random().toString(36).slice(2)}` ``; the Apple Pay copy still goes straight from `crypto.randomUUID` to `Math.random` with no `getRandomValues` intermediate. These tokens drive gateway idempotency/de-dup.
- **Evidence:** `return \`sdk-${Date.now()}-${Math.random().toString(36).slice(2)}\`;` at both sites (lines 114 / 443).
- **Recommendation:** Throw/surface an error if Web Crypto is unavailable rather than silently degrading; at minimum port the `getRandomValues` intermediate into the Apple Pay implementation.
- **Jira:** `SAM-7569` (existing).

### M8 — `performThreeDSMethodInvocation` resolves `'performed'` on heuristic fallback
- **Severity:** Medium
- **Location:** `SDK/src/sdk/core/form/3ds/methodInvocation.ts:82-87`
- **Description:** Unchanged. When the WebSocket wait throws (or no client is supplied), the heuristic fallback timer resolves `'performed'` with no confirmation the 3DS method actually completed; downstream `/3ds/authenticate` runs on optimistic state. The return union (`'skipped' | 'performed' | 'timeout'`) still lacks `'unknown'`.
- **Evidence:** `logger?.info('3DS method: heuristic performed');` then `resolve('performed');` inside `setTimeout(..., Math.min(6000, timeoutMs))` (lines 85-87).
- **Recommendation:** Extend the return union with `'unknown'` and resolve the heuristic path to it.
- **Jira:** `SAM-7575` (existing).

### M9 — Front-channel `3ds.challenge.close` status (from a URL query param) is trusted as authoritative
- **Severity:** Medium
- **Location:** `SDK/src/sdk/core/form/3ds/challenge.ts:142-171` (esp. 152-160); `SDK/public/notification/index.html:56-85` (esp. 69-84); consumed in `SDK/src/sdk/core/form/submission/threeDSFlow.ts:142-160`
- **Description:** New this run, introduced by PRs #55–57. The 3DS challenge return now flows through a notification page served from the frames host. That page reads the ACS outcome from its own URL query string (`const status = qp('transStatus') || qp('status');`) and `postMessage`s a `3ds.challenge.close` payload carrying that `status` to the SDK. In `challenge.ts`, a **status-bearing** close is treated as authoritative and resolves the flow immediately — explicitly short-circuiting the `FRONT_CHANNEL_GRACE_MS` window that would otherwise let the server-originated WebSocket back-channel (`3ds.challenge.result`) win. `threeDSFlow.ts` then maps that status (`Y`/`A` → authenticated → proceed to `completeSubmission`). The receiver's origin/source checks are correct (`event.source === iframe.contentWindow` **and** `event.origin === new URL(FRAMES.base).origin`), so a foreign page cannot forge the message — but the *value* originates from a front-channel URL parameter that the cardholder's own browser can observe and, if the ACS→notification redirect can be manipulated client-side, alter. Preferring this client-visible channel over the trustworthy back-channel weakens the intended design; the gateway's server-side authorisation remains the real control, which is why this is Medium (defence-in-depth) rather than a direct bypass.
- **Evidence:** `challenge.ts:158` — `complete({ kind: 'polled', data: { status } });` inside the `if (status) { … resolve immediately … }` branch, with the comment "A status-bearing close carries the real ACS outcome, so it is authoritative". `notification/index.html:69` — `const status = qp('transStatus') || qp('status');` then `window.parent.postMessage(payload, parentOrigin)`.
- **Recommendation:** Treat the front-channel status as advisory (UX/loading only) and let the server-originated WebSocket `3ds.challenge.result` decide the outcome; if the front channel must be honoured (WS unavailable), gate final completion on a server-side re-verification of the challenge result rather than the browser-supplied `transStatus`. Do not let a status-bearing close short-circuit the back-channel grace window. Separately, the notification page posts to `parentOrigin` taken verbatim from its query string — pin it to the known frames/parent origin rather than echoing an untrusted parameter.
- **Jira:** new — to be ticketed this run (see Jira sync summary).

### L3 — Apple Pay SDK loaded from `1.latest/` without SRI
- **Severity:** Low
- **Location:** `SDK/src/expressCheckout/express-checkout.html:9`; `SDK/src/sdk/core/apple/applePayReady.ts:22`
- **Description:** Unchanged. Apple's SDK is loaded from the mutable `1.latest/` URL; SRI is impossible by design.
- **Evidence:** `<script src="https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js"></script>` and `s.src = '…/1.latest/apple-pay-sdk.js'`.
- **Recommendation:** Pin a strict CSP `script-src` to Apple's origins; accept as inherent otherwise.
- **Jira:** `SAM-7578` (existing).

### L5 — No Dependabot/Renovate; no scheduled (out-of-deploy) audit
- **Severity:** Low
- **Location:** `.github/workflows/` (only `deploy.yml`); no `.github/dependabot.yml`
- **Description:** Unchanged. Actions are SHA-pinned and `npm audit` gates the deploy, but the workflow remains `workflow_dispatch`-only with no dependency-update automation or scheduled audit.
- **Evidence:** Only `deploy.yml` under `.github/workflows/`; no `dependabot.yml` (re-confirmed this run).
- **Recommendation:** Add Dependabot or Renovate plus a weekly scheduled `npm audit` workflow.
- **Jira:** `SAM-7580` (existing).

### L6 — Demo page ships to production CDN
- **Severity:** Low
- **Location:** `SDK/vite.config.ts:14` (`main` = `index.html`); `SDK/public/demo-complete/index.html`
- **Description:** Unchanged. The interactive demo remains the `main` build entry and `public/demo-complete/` is copied verbatim to the production bucket. No keys are embedded (C1 regression gated by the CI grep); residual concern is shipping demo scaffolding to production. The demo's basket renderer uses `innerHTML` template interpolation (`SDK/index.html:384`) over hardcoded basket data — not an injection sink today, but another reason demo HTML shouldn't ship.
- **Evidence:** `main: resolve(__dirname, 'index.html')` (vite.config line 14); `public/demo-complete/` present.
- **Recommendation:** Split the demo into a separate build target; do not deploy demo HTML to the production CDN bucket.
- **Jira:** `SAM-7581` (existing).

### I1 — `parentUrl` in Apple Pay validation request
- **Severity:** Info
- **Location:** `SDK/src/sdk/core/apple/validate/handleValidateSession.ts:18`
- **Description:** Unchanged. `parentUrl: document.location.hostname` still sent; Apple already enforces the merchant domain at session create.
- **Recommendation:** Confirm whether the gateway consumes it; if not, remove.
- **Jira:** not ticketed (Info excluded by policy).

### I3 — Scheduled-task description drift
- **Severity:** Info
- **Location:** uploaded `SKILL.md` for this task vs any prior in-repo skill reference
- **Description:** Unchanged; not a security issue. Current runs use the SKILL.md attached to the scheduled task.
- **Recommendation:** Pick one source of truth.
- **Jira:** not ticketed (Info excluded by policy).

### I4 — Server-side verification flow adds a merchant-controlled redirect (currently mitigated)
- **Severity:** Info
- **Location:** `SDK/src/sdk/core/apple/pay/handlePaymentAuthorised.ts:155-233`; `SDK/src/sdk/core/apple/utils/extractVerificationToken.ts`; `SDK/src/sdk/types/completion.ts:28-41`
- **Description:** Unchanged. `onPaymentAuthorised` passes an opaque verification token to the integration's callback and fails closed if the callback throws; the callback-supplied `redirect` routes through the shared `performRedirect` `https:`/`http:` scheme allow-list, so `javascript:` and similar are rejected. Residual notes stand: integrations without the callback still complete on the browser-observed gateway result alone, and `extractVerificationToken` probes several alternative response field names, inviting contract drift.
- **Evidence:** `completionHelpers.redirect(verification.redirect);` (line 232); scheme allow-list in `performRedirect.ts:22-26`.
- **Recommendation:** Keep the redirect routed through `performRedirect` (add a comment/test to prevent regression). Pin the verification-token field name once the backend contract settles.
- **Jira:** not ticketed (Info excluded by policy).

---

## Delta since last run (vs. 2026-07-15, `59d12c2`)

- **Fixed:** 0. No open finding was resolved; H2, H3, M2, M8, L3, L5, L6, I1, I3, I4 all persist.
- **New:** 1 — **M9** (front-channel challenge status trusted as authoritative), introduced by PRs #55–57 reworking the 3DS2 challenge return path.
- **Still open:** 10 carried forward + M9 = **11** total open.
- **Whitelisted:** 0.
- **Repo movement:** three commits since last run (`e71c8bb`, `193a1e2`, `e64db09`) touching `notification/index.html` (new), `challenge.ts`, `threeDSFlow.ts`, `submissionController.ts`, `challenge-window.ts`. The unhappy-path branching is a security improvement (fails closed on non-`Y/A` status); the residual concern is M9.

## Whitelist

No `.cowork/red-team-whitelist.md` (or `.yml`/`.json`) present at run time. Whitelist is empty; nothing suppressed.

## Assumptions and caveats

1. **Source fully re-verified this run.** All findings re-checked by grep/read against live source at `e64db09`; new PR code reviewed in full.
2. **M9 severity is defence-in-depth.** It assumes the gateway performs server-side 3DS authorisation and does not settle purely on the browser-reported `transStatus`. If the backend actually trusts the client-reported status, M9 should be re-rated High. This could not be verified from the client repo alone.
3. **Working-tree noise ignored.** `git status` shows many files "modified" — CRLF↔LF churn from the Windows checkout, as in prior runs. The whitespace-ignored diff against `HEAD` is empty for those; committed `HEAD` is the source of truth.
4. **Delta window:** previous report is dated 2026-07-15 (thirteen days ago).
5. **Tracked-file count** rose to 87 with the new `notification/index.html`.

## Operational notes

- `git pull --ff-only` on `main` returned `Already up to date` at `e64db09`, with one benign Windows-side lock warning (`unable to unlink '.git/ORIG_HEAD.lock': Operation not permitted`). It did not affect results.
- Workspace mounts this run: `outputs`, `uploads`, the repo, `monek-app`, and the `Documents\Claude\Scheduled` template folder. Full read access to the repo confirmed (87 tracked files). The OneDrive `red-team-reports` drop folder was **not** auto-mounted at session start; it was reconnected mid-run via a directory request so the HTML companion and prune could complete.
- This markdown is written to `.cowork/reports/`; the HTML companion (built from the shared template) was written to the OneDrive `red-team-reports` drop folder (`Red Team Report - (3) - MonekCheckOutSDK.html`, overwriting the prior copy) for Power Automate delivery. A copy also exists in the session `outputs` folder.
- **Jira sync:** see Jira sync summary below — the Atlassian connector was unavailable this session, so no dedup query or ticket creation ran (best-effort, non-blocking).
- **Drop-folder retention prune:** the only dated stem-file present in the drop folder was `weekly-monek-checkout-sdk-red-team-report-2026-07-08.html`; with just one dated file it falls inside the two-newest keep window, so it plus the fixed-name email body were kept and **0 files were deleted**. No file outside the `weekly-monek-checkout-sdk-red-team-report-` stem was in the delete set (dry-run confirmed empty); the sibling `weekly-monek-checkout-embedded-red-team-report-` stem was not present and untouched.

## Jira sync summary

- **Dedup query:** `"Epic Link" = SAM-7298 AND labels = "repo-monek-checkout-sdk"`, requesting `labels`. **Not executed** — no Atlassian/Jira connector is connected to this scheduled-task session (registry shows Atlassian Rovo `connected: false`). Per task rules, Jira sync is best-effort and must not block report output, so it was skipped.
- **New findings requiring tickets this run:** M9 (Medium) — **could not be created** this run because the connector is unavailable. It should be ticketed on the next run once Jira connectivity is restored (summary `[Red Team: Monek.Checkout.SDK / M9] Front-channel 3DS challenge status trusted as authoritative`, priority `Medium`, labels `redteam-auto`, `repo-monek-checkout-sdk`, `redteam-monek-checkout-sdk-finding-m9`, `redteam-severity-medium`, epic `SAM-7298`).
- **Skipped as duplicates (ticket already existed):** H2 (`SAM-7566`), H3 (`SAM-7567`), M2 (`SAM-7569`), M8 (`SAM-7575`), L3 (`SAM-7578`), L5 (`SAM-7580`), L6 (`SAM-7581`) — noted from prior reports; dedup query not runnable this session.
- **Info findings (I1, I3, I4):** not ticketed by policy.
- **Errors:** Jira connector unavailable (non-blocking). Zero tickets created this run.
