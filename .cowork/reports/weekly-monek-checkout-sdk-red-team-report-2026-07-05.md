# Weekly Red Team Report — Monek.Checkout.SDK

**Run date:** 2026-07-05
**Scheduled task:** `weekly-red-team-report---monekcheckoutsdk`
**Branch:** `main`
**HEAD SHA:** `bd47278` (`MON-3243 red team (#49)`)
**Tracked files:** 86
**Stack:** TypeScript / React / Vite — browser SDK (hosted card fields + Apple Pay via sandboxed iframes)
**Pull status:** `git pull --ff-only` advanced the tree to `bd47278`. Multiple benign Windows-side lock warnings (`unable to unlink '.git/objects/**/tmp_obj_*': Operation not permitted`) — see Operational notes. Pull otherwise succeeded.

> Source fully re-verified against live code at `bd47278`. The repo is connected as a Cowork directory this run, so every finding below was re-read against live source and all line numbers were freshly measured.

---

## TL;DR

**This is the big remediation week.** A single squash-merged PR — `MON-3243 red team (#49)` — landed since the last run (`baca69b` → `bd47278`) and directly addresses the red-team backlog. **12 of the 21 open findings are now fixed**, including the standing **Critical (C1)**: the four hardcoded merchant keys are gone from `index.html` (the demo now takes a key at runtime), and the deploy pipeline gained a CI grep that fails the build on any `live_[0-9a-f]{32}` regression. Both 3DS `document.write` HTML-injection sinks (H1, M1) were rewritten to build forms via DOM APIs through a shared `performRedirect` helper, which now also enforces an `http/https` scheme allow-list (M4). The client-side ipify IP lookup (M3) was deleted outright, and the deploy workflow was hardened to `npm ci` + `npm audit` + SHA-pinned Actions (M6).

**Nine findings remain open, several only partially remediated.** No Critical or new findings this run. The two open Highs are the iframe-sandbox bypass (**H3**, `allow-scripts allow-same-origin` unchanged) and the parent-origin handshake (**H2**) — where the `'*'` default is now fixed (`parentOrigin` is mandatory) but the handler still captures `event.origin` unconditionally on the first `PING_FROM_PARENT`, so the guard remains bypassable. `safeUuid()` still degrades to `Math.random()` (**M2**, partially improved on the payment path only), the 3DS method heuristic still resolves `'performed'` (**M8**), and three Lows plus two Infos persist. **0 new findings, 0 whitelisted.**

## Severity counts

| Critical | High | Medium | Low | Info |
|---------:|-----:|-------:|----:|-----:|
|       0  |   2  |     2  |  3  |   2  |

Open findings: **9** (was 21). Fixed this run: **12**.

## Top priorities

1. **Drop `allow-same-origin` from the iframe sandbox** (H3, `createIframe.ts:13`). This is now the single highest-severity item. `allow-scripts allow-same-origin` is a documented sandbox bypass; pair the removal with a strict CSP on the iframe document.
2. **Stop trusting the first `PING_FROM_PARENT` origin** (H2). The `'*'` default is fixed (`parentOrigin` is now required), but `HostedFieldsApp.tsx:197` / `ExpressCheckoutApp.tsx:93` still do `allowedOriginRef.current = event.origin` on first contact. Validate `event.origin === parentOriginParam` before accepting, on every message including the first.
3. **Fail closed when Web Crypto is unavailable** (M2). The payment path now tries `crypto.getRandomValues` before falling back, but both `safeUuid()` implementations still end in `Math.random()`; the Apple Pay path (`handlePaymentAuthorised.ts:393`) has no `getRandomValues` step at all. Throw/surface an error instead of silently degrading idempotency tokens.
4. **Resolve the 3DS method heuristic to `'unknown'`, not `'performed'`** (M8, `methodInvocation.ts:85-86`) so the gateway — not an optimistic timer — chooses the authentication path.
5. **Finish the supply-chain hardening** (L5): Actions are now SHA-pinned and `npm audit` gates the deploy, but there is still no Dependabot/Renovate and no scheduled (out-of-deploy) audit. Add dependency-update automation and a weekly audit workflow.

---

## Findings

> All findings re-verified against live source at `bd47278` this run. Line numbers are freshly measured. Fixed findings are retained below (marked **FIXED this run**) for week-over-week traceability; their IDs are retired from the open set but not reused.

### H2 — `parentOrigin` handshake still captures `event.origin` from first `PING_FROM_PARENT`
- **Severity:** High (partially remediated)
- **Location:** `SDK/src/hostedFields/components/HostedFieldsApp.tsx:23,122,196-200,204-206`; `SDK/src/expressCheckout/components/ExpressCheckoutApp.tsx:10-16,64-65,92-96,100-101`
- **Description:** The `'*'` default is **fixed** this run — `getParentOriginParam()` now calls `getRequiredParam('parentOrigin')` (HostedFields line 23) / throws `"parentOrigin is unset"` (Express lines 12-13), so the wildcard bypass is gone and `allowedOriginRef` initialises to the required param. **However**, the `PING_FROM_PARENT` handler still executes `allowedOriginRef.current = event.origin` unconditionally on first contact (HostedFields line 197, Express line 93), overwriting the trusted param with whatever origin sent the ping. The subsequent guard `if (allowed !== '*' && event.origin !== allowed)` then checks against the attacker-supplied value. An embedding page that posts `PING_FROM_PARENT` still joins the channel and can receive `tokenised` / `expiry` messages.
- **Evidence:** `allowedOriginRef.current = event.origin;` inside the `PING_FROM_PARENT` branch (HostedFields line 197, Express line 93); guard at HostedFields line 205 / Express line 101.
- **Recommendation:** Do not reassign `allowedOriginRef` from `event.origin`. Validate `event.origin === parentOriginParam` on every inbound message (including the ping) and ignore mismatches. Consider dropping the ping-based capture entirely now that the param is mandatory.
- **Jira:** `SAM-7566` (existing).

### H3 — Iframe sandbox negated by `allow-scripts allow-same-origin`
- **Severity:** High
- **Location:** `SDK/src/sdk/core/iframe/createIframe.ts:13`
- **Description:** Unchanged this run. `createSandboxedIframe` still sets `sandbox="allow-scripts allow-same-origin"`. This combination is a documented sandbox bypass: scripts inside the iframe can reach `document.cookie` / `localStorage` and other same-origin state for `checkout-js.monek.com`, defeating most of the isolation the sandbox is meant to provide.
- **Evidence:** `iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');` (line 13).
- **Recommendation:** Drop `allow-same-origin`. Pair with a strict CSP on the iframe document. The 3DS-injection remediations this run (H1/M1) remove the internal dependence on same-origin `document.write`, which should make this change lower-risk to land.
- **Jira:** `SAM-7567` (existing).

### M2 — `safeUuid()` still falls back to `Math.random()` for idempotency tokens
- **Severity:** Medium (partially remediated)
- **Location:** `SDK/src/sdk/core/form/pay/buildPaymentRequest.ts:101-115`; `SDK/src/sdk/core/apple/pay/handlePaymentAuthorised.ts:379-394`
- **Description:** Improved but not closed. The payment-path `safeUuid()` now tries `crypto.randomUUID()` then `crypto.getRandomValues(new Uint8Array(16))` before its final fallback (buildPaymentRequest lines 104-109) — good. But it still ends in `` `sdk-${Date.now()}-${Math.random().toString(36).slice(2)}` `` (line 114), and the Apple Pay `safeUuid()` has **no** `getRandomValues` intermediate at all — it goes straight from `crypto.randomUUID` to `Math.random` (handlePaymentAuthorised line 393). These tokens drive gateway idempotency/de-dup; `Math.random` collisions on older engines risk double-charge / replay edges.
- **Evidence:** `return \`sdk-${Date.now()}-${Math.random().toString(36).slice(2)}\`;` at both sites (lines 114 / 393).
- **Recommendation:** Throw / surface an error if Web Crypto is unavailable (or require a polyfill at SDK init) rather than silently degrading. At minimum, port the `getRandomValues` intermediate into the Apple Pay implementation.
- **Jira:** `SAM-7569` (existing).

### M8 — `performThreeDSMethodInvocation` resolves `'performed'` on heuristic fallback
- **Severity:** Medium
- **Location:** `SDK/src/sdk/core/form/3ds/methodInvocation.ts:82-87`
- **Description:** Unchanged in substance. The hard `setTimeout` correctly resolves `'timeout'` (line 46), and the WebSocket path resolves `'performed'` on a real `3ds.method.result` (line 74) — both fine. But when a WebSocket client is present and its wait throws, the heuristic fallback timer still resolves `'performed'` with no confirmation the method actually completed (lines 85-86). Downstream `/3ds/authenticate` then runs on optimistic state. The return union is still `'skipped' | 'performed' | 'timeout'` with no `'unknown'`.
- **Evidence:** `logger?.info('3DS method: heuristic performed');` (line 85) then `resolve('performed');` (line 86) inside `setTimeout(..., Math.min(6000, timeoutMs))`.
- **Recommendation:** Extend the return union with `'unknown'` and resolve the heuristic path to it, letting the gateway choose the authentication path rather than assuming completion.
- **Jira:** `SAM-7575` (existing).

### L3 — Apple Pay SDK loaded from `1.latest/` without SRI
- **Severity:** Low
- **Location:** `SDK/src/expressCheckout/express-checkout.html:9`; `SDK/src/sdk/core/apple/applePayReady.ts:22`
- **Description:** Unchanged. Apple's Apple Pay JS SDK is loaded from `https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js`. SRI is impossible by design (mutable URL), so the residual supply-chain risk must be mitigated another way.
- **Evidence:** `<script src="https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js"></script>` (html) and the dynamic injection `s.src = '…/1.latest/apple-pay-sdk.js'` (applePayReady line 22).
- **Recommendation:** Pin a strict CSP `script-src` to Apple's origins; monitor for script changes. Accept as inherent otherwise.
- **Jira:** `SAM-7578` (existing).

### L5 — No Dependabot/Renovate; no scheduled (out-of-deploy) audit
- **Severity:** Low (partially remediated)
- **Location:** `.github/workflows/` (only `deploy.yml` present); no `.github/dependabot.yml`
- **Description:** Substantially improved. Actions are now SHA-pinned (`actions/checkout@de0fac2…`, `actions/setup-node@48b55a0…`, `aws-actions/configure-aws-credentials@ec61189…`, lines 19/25/36) and `npm audit --omit=dev --audit-level=high` gates the deploy (line 33). What remains: there is still no Dependabot/Renovate automation and no scheduled audit workflow independent of a manual `workflow_dispatch` deploy — so a CVE published between deploys is not surfaced proactively.
- **Evidence:** Only `deploy.yml` under `.github/workflows/`; `on: workflow_dispatch` only (line 4); no `dependabot.yml`.
- **Recommendation:** Add Dependabot or Renovate and a weekly scheduled `npm audit` workflow with thresholding.
- **Jira:** `SAM-7580` (existing).

### L6 — Demo page ships to production CDN
- **Severity:** Low (risk materially reduced)
- **Location:** `SDK/vite.config.ts:13-14` (`main` = `index.html`); `SDK/public/demo-complete/index.html`
- **Description:** `index.html` (the interactive demo) is still the `main` build entry (`main: resolve(__dirname, 'index.html')`, line 14) and still reaches `checkout-js.monek.com`; `public/demo-complete/` is still copied verbatim. The **C1 regression vector is now gated** by the deploy-time `live_[0-9a-f]{32}` grep, and the demo no longer embeds any keys (runtime entry), so the residual concern is shipping demo/scaffolding HTML to the production bucket rather than key leakage.
- **Evidence:** `main: resolve(__dirname, 'index.html')` (vite.config line 14); `public/demo-complete/` present.
- **Recommendation:** Split the demo into a separate build target; do not deploy demo HTML to the production CDN bucket.
- **Jira:** `SAM-7581` (existing).

### I1 — `parentUrl` in Apple Pay validation request
- **Severity:** Info
- **Location:** `SDK/src/sdk/core/apple/validate/handleValidateSession.ts:18`
- **Description:** Unchanged. The validation request still includes `parentUrl: document.location.hostname`. Apple already enforces the merchant domain at session create; this field appears unused gateway-side.
- **Recommendation:** Confirm whether the gateway consumes it; if not, remove.
- **Jira:** not ticketed (Info excluded by policy).

### I3 — Scheduled-task description drift
- **Severity:** Info
- **Location:** uploaded `SKILL.md` for this task vs any prior in-repo skill reference
- **Description:** Minor, unchanged. Current runs use the SKILL.md attached to the scheduled task; earlier runs referenced an in-repo skill file. Not a security issue.
- **Recommendation:** Pick one source of truth.
- **Jira:** not ticketed (Info excluded by policy).

---

## Fixed this run (retained for traceability)

The following 12 findings were verified **closed** against live source at `bd47278`. Their Jira tickets are left untouched per task rules (the team owns ticket lifecycle).

- **C1 — Hardcoded merchant API keys in demo HTML** — `SDK/index.html`. All four `test_*`/`live_*` literals removed; the demo now reads the key from a runtime `<input>` / `?key=` param (`initSdkForKey`, lines 532-536). Backstopped by the CI `live_[0-9a-f]{32}` grep in `deploy.yml:22`. **FIXED.** (`SAM-7564`)
- **H1 — HTML injection in 3DS method-invocation iframe via `document.write`** — `methodInvocation.ts`. Rewritten to `document.createElement('form')` + shared `performRedirect` with hidden inputs (lines 21-37); no `document.write`, no string interpolation of `methodUrl`/`methodData`. **FIXED.** (`SAM-7565`)
- **M1 — 3DS challenge iframe inline `<script>` via `document.write`** — `challenge.ts`. Rewritten to DOM APIs + `performRedirect` (lines 66-74); the inline auto-submit `<script>` and `document.write` are gone. **FIXED.** (`SAM-7568`)
- **M3 — Client IP fetched from `api.ipify.org`** — `getClientIp.ts` deleted; no ipify references remain and `sourceIpAddress` is now only an optional passed-in field. **FIXED.** (`SAM-7570`)
- **M4 — `performRedirect` accepted arbitrary URL schemes** — `performRedirect.ts:22-26` now rejects anything outside `['https:', 'http:']`, closing `javascript:` and similar. **FIXED.** (`SAM-7571`)
- **M5 — `notification/index.html` posted to `'*'`; challenge handler ignored origin** — sender now posts to `qp('parentOrigin')` (`notification/index.html:67,72`); consumer now validates `event.origin !== new URL(API.base).origin` (`challenge.ts:136`) in addition to the existing `event.source` check. **FIXED.** (`SAM-7572`)
- **M6 — Deploy pipeline used `npm install` + `continue-on-error`, no audit** — `deploy.yml` now uses `npm ci` (line 47), `npm audit --omit=dev --audit-level=high` (line 33), no `continue-on-error`, plus the live-key grep (line 22). **FIXED.** (`SAM-7573`)
- **M7 — `fetchAccessKey` interpolated `publicKey` into URL path unencoded** — `fetchAccessKey.ts:15-19` now calls `validatePublicKey()` (strict `^(?:test|live)_[a-f0-9]{32}$`) before building the path, closing the injection/traversal surface. **FIXED.** (`SAM-7574`)
- **L1 — Raw `console.*` bypassing `Logger` redaction** — all flagged raw `console.*` calls removed; the only remaining `console.*` are inside `Logger.ts` itself (lines 38-53). `validateSession.ts:27` now uses `logger.error(...)`. **FIXED.** (`SAM-7576`)
- **L2 — Commented-out `x-api-key` header in Apple Pay session validation** — the `//'x-api-key': apiKey` line is gone from `validateSession.ts`; headers are now just `Content-Type`. **FIXED.** (`SAM-7577`)
- **L4 — `//TODO REMOVE` on `serverTransactionId` mapping** — the TODO and the associated mapping line are gone from `authenticate.ts`. **FIXED.** (`SAM-7579`)
- **I2 — Dead `qp()` helper in notification page** — `qp()` is now used (defines line 58, called line 67) as part of the M5 fix. **FIXED.** (was not ticketed — Info)

---

## Delta since last run (vs. 2026-06-17)

- **Fixed:** 12 — C1, H1, M1, M3, M4, M5, M6, M7, L1, L2, L4 (all ticketed) plus I2 (Info). All verified closed at `bd47278`.
- **Still open:** 9 — H2, H3, M2, M8, L3, L5, L6, I1, I3. Of these, **H2, M2, L5 and L6 are partially remediated** (see per-finding notes); H3, M8, L3, I1, I3 are unchanged.
- **New:** 0. The refactor introduced no new secrets, no wildcard `postMessage`, and no new third-party fetches (all `fetch` targets are Monek API; only external script remains Apple's CDN under L3). `innerHTML` appears twice (`CheckoutComponent.ts:170`, `ExpressComponent.ts:64`) but only as `= ''` mount-clearing — not an injection sink.
- **Whitelisted:** 0.

No finding IDs were re-banded this run. Fixed IDs are retired from the open set and not reused; open IDs and their Jira mappings are unchanged.

## Whitelist

No `.cowork/red-team-whitelist.md` (or `.yml`/`.json`) present at run time. Whitelist is empty; nothing suppressed.

## Assumptions and caveats

1. **Source fully re-verified this run.** The repo is connected as a Cowork directory, so `Read`/`grep`/shell all operate on live source. Line numbers are freshly measured against `bd47278`.
2. **`MON-3243 red team (#49)` is a squash-merge** of the remediation work; individual per-finding commits are not separately visible on `main`. Dispositions above are based on the resulting live source, not commit archaeology.
3. **M7 marked fixed on the strength of `validatePublicKey`.** The path still interpolates `publicKey` without `encodeURIComponent`, but the strict `^(?:test|live)_[a-f0-9]{32}$` gate rejects any character that could traverse or inject, so the surface is closed in practice. If that regex is ever loosened, M7 should be reopened.
4. **"Partial" findings kept at prior severity.** H2, M2, L5, L6 are genuinely improved but not closed; IDs and severities are held stable for continuity, with the residual gap documented per finding. H2 in particular retains High because the ping-based origin capture still defeats the now-mandatory param.
5. **Jira not reachable this run.** No Atlassian/Jira connector is connected to this session, so the dedup JQL could not be executed. This had no material impact: there are **0 new findings**, so no tickets needed creating regardless (see Jira sync summary).
6. **Line-ending noise.** `git status` may show CRLF↔LF-only "modifications"; committed `HEAD` (`bd47278`) is the source of truth used here.

## Operational notes

- Workspace mounts this run: `outputs`, `red-team-reports`, `uploads`, the repo at `C:\Users\AdrianDavies\github\Monek.Checkout.SDK`, and the `Documents\Claude\Scheduled` template folder. Full read access to the repo confirmed.
- `git pull --ff-only` advanced `main` from `baca69b` to `bd47278` (one commit, PR #49). It emitted ~30 benign Windows-side warnings of the form `unable to unlink '.git/objects/**/tmp_obj_*': Operation not permitted` (OneDrive/AV holding object files). These did not affect the pull result — `HEAD` is `bd47278` and the working tree is clean.
- This markdown is written to the canonical `.cowork/reports/` path; the HTML companion is written to the OneDrive `red-team-reports` folder for Power Automate delivery, built from the shared template.
- **Jira sync:** no new findings this run, so no tickets were created. The Atlassian connector was not connected, so the dedup query was not executed; this is immaterial given zero new findings. No existing tickets were updated, transitioned, or commented on. See Jira sync summary.

## Jira sync summary

- **Dedup query:** not executed — no Atlassian/Jira connector is connected to this scheduled-task session. Best-effort per task rules; report output was not blocked.
- **New findings requiring tickets:** 0. No Critical/High/Medium/Low finding is new this run — every open finding (H2 `SAM-7566`, H3 `SAM-7567`, M2 `SAM-7569`, M8 `SAM-7575`, L3 `SAM-7578`, L5 `SAM-7580`, L6 `SAM-7581`) already carries a ticket from prior runs.
- **New tickets created this run:** 0.
- **Skipped as duplicates (ticket already existed):** H2 (`SAM-7566`), H3 (`SAM-7567`), M2 (`SAM-7569`), M8 (`SAM-7575`), L3 (`SAM-7578`), L5 (`SAM-7580`), L6 (`SAM-7581`).
- **Fixed findings (C1, H1, M1, M3, M4, M5, M6, M7, L1, L2, L4):** tickets `SAM-7564`, `SAM-7565`, `SAM-7568`, `SAM-7570`, `SAM-7571`, `SAM-7572`, `SAM-7573`, `SAM-7574`, `SAM-7576`, `SAM-7577`, `SAM-7579` left **untouched** — the team owns lifecycle/closure, per task rules.
- **Info findings (I1, I3):** not ticketed by policy.
- **Errors:** none blocking. Jira connector unavailable (non-blocking, zero new findings).
