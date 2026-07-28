# Weekly Red Team Report — Monek.Checkout.SDK

**Run date:** 2026-07-08
**Scheduled task:** `weekly-red-team-report---monekcheckoutsdk`
**Branch:** `main`
**HEAD SHA:** `59d12c2` (`SAM-7895/ fix premature posyMessage calls (#54)`)
**Tracked files:** 86
**Stack:** TypeScript / React / Vite — browser SDK (hosted card fields + Apple Pay via sandboxed iframes)
**Pull status:** `git pull --ff-only` reported `Already up to date` (HEAD already at `59d12c2`). One benign Windows-side lock warning (`unable to unlink '.git/ORIG_HEAD.lock': Operation not permitted`) — see Operational notes.

> All findings re-verified against live source at `59d12c2`. Four commits landed since the previous run (`bd47278`, 2026-07-05): #51 server-side verification support, #52 remove logging of card token id, #53 move notification page to backend, #54 fix premature postMessage calls.

---

## TL;DR

**A quiet, positive week: four small hardening PRs, no fixes to open findings, one new Info.** Since `bd47278`, the team shipped a server-side payment verification mechanism for plugin integrations (`onPaymentAuthorised` callback + opaque verification token, PR #51), scrubbed session IDs and card token IDs from debug logs (PRs #52/#54 — `sessionId` → `hasSession`, `cardTokenId` → `hasToken` and similar at seven log sites), deleted the static `notification/index.html` in favour of a backend-served page (PR #53, `notificationUrl` now `${API.base}/notification?parentOrigin=…` with the challenge listener already pinned to the API origin), and fixed the parent→iframe handshake race so `PING_FROM_PARENT` is only sent after iframe `load`, with duplicate/blind `ready` messages ignored (PR #54). The new verification-redirect path was reviewed and routes through the existing `performRedirect` `http/https` allow-list — no new injection or open-redirect surface (tracked as new Info **I4**).

**All nine previously open findings remain open and unchanged in severity.** The two Highs are untouched: the iframe sandbox still sets `allow-scripts allow-same-origin` (**H3**), and both iframe apps still capture `event.origin` from the first `PING_FROM_PARENT` (**H2**) — PR #54 changed *when* the parent pings, not how the child validates it. `safeUuid()` still degrades to `Math.random()` with the Apple Pay copy lacking the `getRandomValues` intermediate (**M2**), and the 3DS method heuristic still resolves `'performed'` (**M8**). Three Lows (L3, L5, L6) and two Infos (I1, I3) persist. **0 fixed, 1 new (Info), 0 whitelisted.**

## Severity counts

| Critical | High | Medium | Low | Info |
|---------:|-----:|-------:|----:|-----:|
|       0  |   2  |     2  |  3  |   3  |

Open findings: **10** (was 9; +1 Info). Fixed this run: **0**.

## Top priorities

1. **Drop `allow-same-origin` from the iframe sandbox** (H3, `createIframe.ts:13`). Still the highest-severity open item, unchanged for a fourth consecutive run. The 3DS `document.write` dependencies were removed weeks ago, so the change should now be low-risk to land.
2. **Stop trusting the first `PING_FROM_PARENT` origin** (H2, `HostedFieldsApp.tsx:197` / `ExpressCheckoutApp.tsx:93`). PR #54 fixed the timing race but the child still overwrites the mandatory `parentOrigin` param with `event.origin` on first contact. Validate `event.origin === parentOriginParam` on every message, including the ping.
3. **Fail closed when Web Crypto is unavailable** (M2). Both `safeUuid()` implementations still end in `Math.random()`; the Apple Pay copy (`handlePaymentAuthorised.ts:429-443`) still has no `getRandomValues` intermediate. These drive gateway idempotency tokens.
4. **Resolve the 3DS method heuristic to `'unknown'`, not `'performed'`** (M8, `methodInvocation.ts:82-87`) so the gateway chooses the authentication path rather than an optimistic timer.
5. **Finish supply-chain hardening** (L5): still no Dependabot/Renovate and no scheduled audit outside the manual `workflow_dispatch` deploy — a CVE published between deploys is not surfaced.

---

## Findings

> All findings re-verified against live source at `59d12c2` this run; line numbers freshly measured.

### H2 — `parentOrigin` handshake still captures `event.origin` from first `PING_FROM_PARENT`
- **Severity:** High
- **Location:** `SDK/src/hostedFields/components/HostedFieldsApp.tsx:122,196-200,204-206`; `SDK/src/expressCheckout/components/ExpressCheckoutApp.tsx:65,92-96,100-101`
- **Description:** Unchanged in substance. `allowedOriginRef` initialises from the mandatory `parentOrigin` param, but the `PING_FROM_PARENT` handler still executes `allowedOriginRef.current = event.origin` unconditionally on first contact (HostedFields line 197, Express line 93), overwriting the trusted param with whatever origin sent the ping. The subsequent guard then checks against the attacker-supplied value, so a hostile embedding page that posts `PING_FROM_PARENT` first can still receive `tokenised` / `expiry` messages. Note PR #54 changed the *parent* side only (ping now sent after iframe `load`, duplicate `ready` ignored in `CheckoutComponent.ts:330-339`) — this narrows the race window slightly but does not fix the child-side trust flaw.
- **Evidence:** `allowedOriginRef.current = event.origin;` inside the `PING_FROM_PARENT` branch (HostedFields line 197, Express line 93).
- **Recommendation:** Do not reassign `allowedOriginRef` from `event.origin`. Validate `event.origin === parentOriginParam` on every inbound message (including the ping) and ignore mismatches. With the param mandatory and the parent now pinging deterministically post-load, the ping-based capture can likely be deleted outright.
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
- **Evidence:** `logger?.info('3DS method: heuristic performed');` then `resolve('performed');` inside `setTimeout(..., Math.min(6000, timeoutMs))` (lines 85-86).
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
- **Description:** Unchanged since the partial remediation. Actions are SHA-pinned and `npm audit` gates the deploy, but the workflow remains `workflow_dispatch`-only with no dependency-update automation or scheduled audit.
- **Evidence:** Only `deploy.yml` under `.github/workflows/`; no `dependabot.yml`.
- **Recommendation:** Add Dependabot or Renovate plus a weekly scheduled `npm audit` workflow.
- **Jira:** `SAM-7580` (existing).

### L6 — Demo page ships to production CDN
- **Severity:** Low
- **Location:** `SDK/vite.config.ts:14` (`main` = `index.html`); `SDK/public/demo-complete/index.html`
- **Description:** Unchanged. The interactive demo remains the `main` build entry and `public/demo-complete/` is copied verbatim to the production bucket. No keys are embedded (C1 regression gated by the CI grep); residual concern is shipping demo scaffolding to production. The demo's basket renderer uses `innerHTML` template interpolation (`SDK/index.html:384-398`) over hardcoded basket data — not an injection sink today, but another reason demo HTML shouldn't ship.
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

### I4 — NEW: server-side verification flow adds a merchant-controlled redirect (currently mitigated)
- **Severity:** Info
- **Location:** `SDK/src/sdk/core/apple/pay/handlePaymentAuthorised.ts:155-233`; `SDK/src/sdk/core/apple/utils/extractVerificationToken.ts`; `SDK/src/sdk/types/completion.ts:28-41`
- **Description:** PR #51 introduces `onPaymentAuthorised`: after a gateway-approved Apple Pay authorisation, the SDK passes an opaque verification token to the integration's callback and treats the payment as verified only if the callback returns `{ verified: true }` — failing closed if the callback throws (`verified = false`, `STATUS_FAILURE`). The callback may also return a `redirect`, which the SDK follows via `completionHelpers.redirect(...)`. Reviewed this run: the redirect routes through the shared `performRedirect` helper, which enforces the `https:`/`http:` scheme allow-list (M4 fix), so `javascript:` and similar are rejected; the callback itself sits on the merchant side of the trust boundary. Two residual notes: (a) integrations without the callback still complete on the browser-observed gateway result alone (a `logger.warn` is emitted — pre-existing behaviour, now explicit); (b) `extractVerificationToken` probes four alternative response field names (`verification`, `verificationToken`, `signedToken`, `signature`), which invites contract drift.
- **Evidence:** `completionHelpers.redirect(verification.redirect);` (line 232); scheme allow-list in `performRedirect.ts:22-26`; fail-closed catch at lines 178-183.
- **Recommendation:** Keep the redirect routed through `performRedirect` (add a comment/test to prevent regression to `window.location = …`). Pin the verification-token field name once the backend contract settles. Consider a config flag for plugin builds that *requires* verification so gateway-only completion can't occur silently.
- **Jira:** not ticketed (Info excluded by policy).

---

## Delta since last run (vs. 2026-07-05, `bd47278`)

- **Fixed:** 0. No open finding was remediated by PRs #51–#54.
- **Still open:** 9 — H2, H3, M2, M8, L3, L5, L6, I1, I3. All unchanged in substance and severity. H2's parent-side timing improved (PR #54) but the child-side origin capture — the actual flaw — is untouched.
- **New:** 1 — I4 (Info): server-side verification flow reviewed; redirect surface mitigated by the existing `performRedirect` allow-list. No new Critical/High/Medium/Low findings: the four new commits introduced no secrets, no new XSS sinks, no wildcard `postMessage` (repo-wide grep clean), and no new third-party fetches.
- **Whitelisted:** 0.
- **Notable non-finding improvements:** card token IDs and session IDs scrubbed from debug logs (PRs #52/#54: `makePayment.ts:33`, `submissionController.ts:49,66`, `CheckoutComponent.ts:209,303`, `ExpressComponent.ts:67,150`, `handlePaymentAuthorised.ts:48,136`); static `notification/index.html` deleted in favour of a backend-served page (PR #53) — `notificationUrl` is now `${API.base}/notification?parentOrigin=${encodeURIComponent(parentOrigin)}` (`authenticate.ts:103`) and the challenge listener already pins `event.origin` to the API origin plus `event.source` to the iframe (`challenge.ts:132-140`), so the M5 fix carries over cleanly.

## Whitelist

No `.cowork/red-team-whitelist.md` (or `.yml`/`.json`) present at run time. Whitelist is empty; nothing suppressed.

## Assumptions and caveats

1. **Source fully re-verified this run.** The repo is a connected Cowork directory; all findings re-read against live source at `59d12c2` with freshly measured line numbers.
2. **I4 banded Info, not higher**, because the redirect is (a) only reachable after a gateway-approved payment, (b) supplied by the merchant's own verification callback (merchant side of the trust boundary), and (c) filtered through the `performRedirect` scheme allow-list. If any of those three conditions changes, re-band.
3. **Working-tree noise ignored.** `git status` shows ~84 files "modified" with identical insert/delete counts — CRLF↔LF churn from the Windows checkout. Committed `HEAD` (`59d12c2`) is the source of truth used here.
4. **"Weekly" cadence note:** previous report is dated 2026-07-05 (three days ago); the delta window is correspondingly short, which explains the small commit set.
5. **Jira not reachable this run** — see Jira sync summary. Immaterial: zero new ticketable findings.

## Operational notes

- `git pull --ff-only` on `main` returned `Already up to date` at `59d12c2`, with one benign Windows-side lock warning (`unable to unlink '.git/ORIG_HEAD.lock': Operation not permitted`). No effect on the result.
- Workspace mounts this run: `outputs`, `red-team-reports` (OneDrive), `uploads`, the repo, and the `Documents\Claude\Scheduled` template folder. Full read access to the repo confirmed (86 tracked files).
- This markdown is written to `.cowork/reports/`; the HTML companion (built from the shared template) is written to the OneDrive `red-team-reports` folder for Power Automate delivery.
- **Jira sync:** no Atlassian/Jira connector connected to this scheduled-task session, so the dedup JQL could not be executed. Zero new Critical/High/Medium/Low findings this run, so no tickets required creating regardless. No existing tickets touched.

## Jira sync summary

- **Dedup query:** not executed — no Atlassian/Jira connector available in this session (registry search confirmed none connected). Best-effort per task rules; report output not blocked.
- **New findings requiring tickets:** 0. The only new finding (I4) is Info, excluded by policy.
- **New tickets created this run:** 0.
- **Skipped as duplicates (ticket already existed):** H2 (`SAM-7566`), H3 (`SAM-7567`), M2 (`SAM-7569`), M8 (`SAM-7575`), L3 (`SAM-7578`), L5 (`SAM-7580`), L6 (`SAM-7581`).
- **Info findings (I1, I3, I4):** not ticketed by policy.
- **Errors:** none blocking. Jira connector unavailable (non-blocking; zero new ticketable findings).
