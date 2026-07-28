# Weekly Red Team Report — Monek.Checkout.SDK

**Run date:** 2026-07-15
**Scheduled task:** `weekly-red-team-report---monekcheckoutsdk`
**Branch:** `main`
**HEAD SHA:** `59d12c2` (`SAM-7895/ fix premature posyMessage calls (#54)`)
**Tracked files:** 86
**Stack:** TypeScript / React / Vite — browser SDK (hosted card fields + Apple Pay via sandboxed iframes)
**Pull status:** `git pull --ff-only` reported `Already up to date` (HEAD unchanged at `59d12c2`). One benign Windows-side lock warning (`unable to unlink '.git/ORIG_HEAD.lock': Operation not permitted`) — see Operational notes.

> Zero commits landed since the previous run (2026-07-08, also at `59d12c2`). All findings re-verified against live source this run; the working tree matches HEAD (whitespace-ignored diff is empty).

---

## TL;DR

**A no-change week: the repo has not moved since the last run.** HEAD remains at `59d12c2` — the same commit the 2026-07-08 report reviewed — and a whitespace-ignored diff of the working tree against HEAD is empty, so there is no new code surface to assess. Every open finding was nonetheless re-verified against live source rather than carried forward on trust: all ten re-confirmed at their previously reported locations, and the standard repo-wide sweeps (wildcard `postMessage`, `document.write`, `innerHTML` sinks, `eval`/`new Function`, `javascript:` URLs, committed secrets/`test_`/`live_` keys) all came back clean.

**The two Highs are now unchanged for a fifth consecutive run.** The iframe sandbox still pairs `allow-scripts` with `allow-same-origin` (**H3**), and both iframe apps still overwrite the trusted `parentOrigin` param with `event.origin` from the first `PING_FROM_PARENT` (**H2**). With no feature work landing this week, this would be a good window to land both fixes — H3 in particular has been low-risk since the 3DS `document.write` dependency was removed. `safeUuid()` still degrades to `Math.random()` (**M2**), the 3DS method heuristic still resolves `'performed'` (**M8**), and the three Lows and three Infos persist. **0 fixed, 0 new, 0 whitelisted.**

## Severity counts

| Critical | High | Medium | Low | Info |
|---------:|-----:|-------:|----:|-----:|
|       0  |   2  |     2  |  3  |   3  |

Open findings: **10** (unchanged). Fixed this run: **0**.

## Top priorities

1. **Drop `allow-same-origin` from the iframe sandbox** (H3, `createIframe.ts:13`). Highest-severity open item, unchanged for a fifth consecutive run. The `document.write` dependencies that once justified it are long gone; a quiet week with no in-flight feature work is the ideal time to land it.
2. **Stop trusting the first `PING_FROM_PARENT` origin** (H2, `HostedFieldsApp.tsx:197` / `ExpressCheckoutApp.tsx:93`). The child still overwrites the mandatory `parentOrigin` param with `event.origin` on first contact. Validate `event.origin === parentOriginParam` on every message; with the parent now pinging deterministically post-load (PR #54), the capture logic can likely be deleted.
3. **Fail closed when Web Crypto is unavailable** (M2). Both `safeUuid()` implementations still end in `Math.random()`; the Apple Pay copy (`handlePaymentAuthorised.ts:429-443`) still lacks the `getRandomValues` intermediate. These tokens drive gateway idempotency/de-dup.
4. **Resolve the 3DS method heuristic to `'unknown'`, not `'performed'`** (M8, `methodInvocation.ts:82-87`) so the gateway chooses the authentication path rather than an optimistic timer.
5. **Finish supply-chain hardening** (L5): still no Dependabot/Renovate and no scheduled audit outside the manual `workflow_dispatch` deploy — a CVE published between deploys is not surfaced.

---

## Findings

> All findings re-verified against live source at `59d12c2` this run; locations re-confirmed by grep/read.

### H2 — `parentOrigin` handshake still captures `event.origin` from first `PING_FROM_PARENT`
- **Severity:** High
- **Location:** `SDK/src/hostedFields/components/HostedFieldsApp.tsx:197`; `SDK/src/expressCheckout/components/ExpressCheckoutApp.tsx:93`
- **Description:** Unchanged. `allowedOriginRef` initialises from the mandatory `parentOrigin` param, but the `PING_FROM_PARENT` handler still executes `allowedOriginRef.current = event.origin` unconditionally on first contact, overwriting the trusted param with whatever origin sent the ping. A hostile embedding page that posts `PING_FROM_PARENT` first can still receive `tokenised` / `expiry` messages. PR #54 (last cycle) fixed the parent-side timing only; the child-side trust flaw is untouched.
- **Evidence:** `allowedOriginRef.current = event.origin;` inside the `PING_FROM_PARENT` branch (HostedFields line 197, Express line 93).
- **Recommendation:** Do not reassign `allowedOriginRef` from `event.origin`. Validate `event.origin === parentOriginParam` on every inbound message (including the ping) and ignore mismatches.
- **Jira:** `SAM-7566` (existing).

### H3 — Iframe sandbox negated by `allow-scripts allow-same-origin`
- **Severity:** High
- **Location:** `SDK/src/sdk/core/iframe/createIframe.ts:13`
- **Description:** Unchanged. `createSandboxedIframe` still sets `sandbox="allow-scripts allow-same-origin"` — a documented sandbox bypass. Scripts inside the iframe can reach same-origin state for `checkout-js.monek.com` (cookies, storage), defeating most of the intended isolation.
- **Evidence:** `iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');` (line 13).
- **Recommendation:** Drop `allow-same-origin`; pair with a strict CSP on the iframe document.
- **Jira:** `SAM-7567` (existing).

### M2 — `safeUuid()` still falls back to `Math.random()` for idempotency tokens
- **Severity:** Medium
- **Location:** `SDK/src/sdk/core/form/pay/buildPaymentRequest.ts:101-115`; `SDK/src/sdk/core/apple/pay/handlePaymentAuthorised.ts:429-443`
- **Description:** Unchanged. The payment-path `safeUuid()` tries `crypto.randomUUID()` then `crypto.getRandomValues(new Uint8Array(16))` but still ends in `` `sdk-${Date.now()}-${Math.random().toString(36).slice(2)}` ``; the Apple Pay copy still goes straight from `crypto.randomUUID` to `Math.random` with no `getRandomValues` intermediate. These tokens drive gateway idempotency/de-dup.
- **Evidence:** `return \`sdk-${Date.now()}-${Math.random().toString(36).slice(2)}\`;` at both sites (lines 114 / 443).
- **Recommendation:** Throw/surface an error if Web Crypto is unavailable rather than silently degrading; at minimum port the `getRandomValues` intermediate into the Apple Pay implementation.
- **Jira:** `SAM-7569` (existing).

### M8 — `performThreeDSMethodInvocation` resolves `'performed'` on heuristic fallback
- **Severity:** Medium
- **Location:** `SDK/src/sdk/core/form/3ds/methodInvocation.ts:82-87`
- **Description:** Unchanged. When the WebSocket wait throws, the heuristic fallback timer resolves `'performed'` with no confirmation the 3DS method actually completed; downstream `/3ds/authenticate` runs on optimistic state. The return union still lacks `'unknown'`.
- **Evidence:** `logger?.info('3DS method: heuristic performed');` then `resolve('performed');` inside `setTimeout(..., Math.min(6000, timeoutMs))`.
- **Recommendation:** Extend the return union with `'unknown'` and resolve the heuristic path to it.
- **Jira:** `SAM-7575` (existing).

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
- **Description:** Unchanged since first raised last run. `onPaymentAuthorised` passes an opaque verification token to the integration's callback and fails closed if the callback throws; the callback-supplied `redirect` routes through the shared `performRedirect` `https:`/`http:` scheme allow-list, so `javascript:` and similar are rejected. Residual notes stand: integrations without the callback still complete on the browser-observed gateway result alone, and `extractVerificationToken` probes four alternative response field names, inviting contract drift.
- **Evidence:** `completionHelpers.redirect(verification.redirect);` (line 232); scheme allow-list in `performRedirect.ts:22-26`.
- **Recommendation:** Keep the redirect routed through `performRedirect` (add a comment/test to prevent regression). Pin the verification-token field name once the backend contract settles. Consider a config flag for plugin builds that *requires* verification.
- **Jira:** not ticketed (Info excluded by policy).

---

## Delta since last run (vs. 2026-07-08, `59d12c2`)

- **Fixed:** 0. No commits landed; nothing changed.
- **Still open:** 10 — H2, H3, M2, M8, L3, L5, L6, I1, I3, I4. All re-verified against live source this run; all unchanged in substance and severity.
- **New:** 0. HEAD is identical to the previous run's; repo-wide sweeps (wildcard `postMessage`, `document.write`, `innerHTML`, secrets/`test_`/`live_` keys, `javascript:` URLs, `eval`/`new Function`) all clean.
- **Whitelisted:** 0.

## Whitelist

No `.cowork/red-team-whitelist.md` (or `.yml`/`.json`) present at run time. Whitelist is empty; nothing suppressed.

## Assumptions and caveats

1. **Source fully re-verified this run.** All findings re-checked by grep/read against live source at `59d12c2` rather than carried forward from the previous report.
2. **No-change week is genuine, not a mount failure.** `git log` confirms HEAD matches the previous run's SHA, and `git diff --ignore-all-space` against HEAD is empty, so the identical findings set reflects an unchanged repo, not a stale review.
3. **Working-tree noise ignored.** `git status` shows ~85 files "modified" — CRLF↔LF churn from the Windows checkout, as in prior runs. The whitespace-ignored diff is empty; committed `HEAD` is the source of truth.
4. **Delta window:** previous report is dated 2026-07-08 (seven days ago) — a full weekly cycle this time.
5. **Jira not reachable this run** — see Jira sync summary. Immaterial: zero new ticketable findings.

## Operational notes

- `git pull --ff-only` on `main` returned `Already up to date` at `59d12c2`, with one benign Windows-side lock warning (`unable to unlink '.git/ORIG_HEAD.lock': Operation not permitted`). A similar benign `index.lock` warning appeared during `git status`. Neither affected results.
- Workspace mounts this run: `outputs`, `red-team-reports` (OneDrive), `uploads`, the repo, and the `Documents\Claude\Scheduled` template folder. Full read access to the repo confirmed (86 tracked files).
- This markdown is written to `.cowork/reports/`; the HTML companion (built from the shared template) is written to the OneDrive `red-team-reports` folder for Power Automate delivery.
- **Jira sync:** no Atlassian/Jira connector connected to this scheduled-task session, so the dedup JQL could not be executed. Zero new Critical/High/Medium/Low findings this run, so no tickets required creating regardless. No existing tickets touched.

## Jira sync summary

- **Dedup query:** not executed — no Atlassian/Jira connector available in this session. Best-effort per task rules; report output not blocked.
- **New findings requiring tickets:** 0.
- **New tickets created this run:** 0.
- **Skipped as duplicates (ticket already existed):** H2 (`SAM-7566`), H3 (`SAM-7567`), M2 (`SAM-7569`), M8 (`SAM-7575`), L3 (`SAM-7578`), L5 (`SAM-7580`), L6 (`SAM-7581`).
- **Info findings (I1, I3, I4):** not ticketed by policy.
- **Errors:** none blocking. Jira connector unavailable (non-blocking; zero new ticketable findings).
