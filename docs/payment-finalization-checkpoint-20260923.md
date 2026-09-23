# PAYMENT FINALIZATION CHECKPOINT — 2026-09-23

**Decision: NOT ready for a provider TEST transaction or a real charge.** Local safety defects have been corrected and rehearsed. The actual provider transports and notification decoder remain deliberately unwired. Configuration alone cannot activate this code.

No push, merge, deployment, production migration/configuration change, provider transaction, charge, void/refund, message, or accounting document was performed. Production inspection used only schema metadata GETs and function OPTIONS requests. No paused workstream was edited.

## 1. Canonical implementation and ancestry

Read-only `git ls-remote` confirmed the local main/payment refs match origin.

```text
feat/pelecard-payments 037ee04
  -> 57bd956 integration merge
  -> integration/shafan-final / workstream/payment-accounting 489b8c7
  -> staging-release-candidate 0a36f0a
  -> payment/accounting integration bbad806 (workstream completion 404838d)
  -> release-candidate-2 0df1ced
  -> redirect fix ebfe41e
  -> main / final-candidate-20260916 2a0c7f5
  -> feat/phase1-quotations eb810b9
       |-> fix/payment-finalization-20260923 (this work)
       `-> feat/phase2-customers 03316ef (preserved, not activated/modified)
```

`workstream/payment-rivhit-clubs` ends at `ca98184`; its redirect fix is already represented by `ebfe41e` on main. It has no newer one-off-payment implementation to recover. Main contains payment ledger 021, workflow 025, and accounting outbox 027. No cherry-pick or merge was needed.

Original Pelecard worktree: `C:/Users/nadav/.config/superpowers/worktrees/shafan-hasela-vercal/feat-pelecard-payments`. Current isolated worktree: `.worktrees/payment-finalization`. Base `eb810b9779e974375cdc71d7280dd9344b473e0a` retains completed quotations and all main payment changes without incorporating the paused customer activation branch.

The ancestry and all 20 gap classifications below were completed before code edits.

## 2–3. Architecture and actual user flow

The existing flow is a staff cash-register flow, not an anonymous customer payment link:

1. Authenticated staff open `/cashregister`, assemble a cart, and link an existing order through the order search.
2. The dedicated Pelecard button calls authenticated `pelecard-initiate`.
3. The new order-only runtime validates the request, checks provider readiness, and calls service-only `reserve_pelecard_order_payment`. It locks the order, checks payment state, compares the expected cart amount with `orders.total_price`, and derives the ledger amount and sale snapshot from the database.
4. With a future configured provider adapter, the server would create a hosted session and return an allowlisted HTTPS URL. The browser redirects; card entry stays on Pelecard.
5. `/payment/return` is authenticated. It submits browser notification data for server verification and polls the local ledger. It never creates a sale or marks the order paid.
6. Public callback and authenticated verify handlers require anti-forgery validation **and** authoritative provider lookup/correlation before atomic finalization.
7. Finalization writes one sale, links payment/sale/order, marks `orders.payment_status='פלאקארד'`, and records verified success. Existing approved accounting orchestration then enqueues a separate Rivhit event and attempts a best-effort wake-up.

**Actual current boundary:** initiation has `capabilities: {}`; callback/verify use `unconfiguredNotificationDecoder` and `unconfiguredVerificationProvider`. The new readiness check returns an unavailable response before reserving an order. A successful real payment cannot happen through these source entrypoints yet.

The cart total must match the saved order total. This task does not introduce partial payments, deposits, anonymous payment links, or new price/discount rules. Manual/external credit retains its distinct existing label; it is not presented as verified Pelecard payment.

## 4–7. Gap audit and local completion

COMPLETE below means locally implemented and tested, not provider/production E2E certified.

| # | Requirement | Before editing | Checkpoint |
|---|---|---|---|
| 1 | Initiate from a real order | PARTIAL | PARTIAL: safe order reservation complete; actual provider initiation missing |
| 2 | Authoritative amount | PARTIAL: arithmetic over browser cart | COMPLETE locally: locked database order total; mismatches rejected |
| 3 | Create provider transaction | MISSING | MISSING: transport/request-response wiring gated on complete contract |
| 4 | Hosted-page redirect | IMPLEMENTED BUT UNVERIFIED | IMPLEMENTED BUT UNVERIFIED against provider; HTTPS/origin tests pass |
| 5 | Success return | PARTIAL | PARTIAL: authenticated return/polling exists; provider decoder missing |
| 6 | Cancel/failure return | PARTIAL | PARTIAL: no false success; cancellation terminal semantics not confirmed |
| 7 | Server provider verification | MISSING at runtime | MISSING: validate/lookup transports and response mapping |
| 8 | Reject forged browser success | COMPLETE locally | COMPLETE: browser never finalizes; verification/correlation required |
| 9 | Duplicate processing | PARTIAL: same-payment only | COMPLETE locally for the new order entrypoint, plus existing finalizer uniqueness |
| 10 | Record payment | IMPLEMENTED BUT UNVERIFIED | COMPLETE locally; production definitions still unverified |
| 11 | Link payment/sale/order | IMPLEMENTED BUT UNVERIFIED | COMPLETE locally; provider E2E unverified |
| 12 | Order payment state | PARTIAL: no paid-order initiation guard | COMPLETE locally: paid/cancelled/previous-sale orders blocked |
| 13 | Retry/idempotency | PARTIAL | COMPLETE locally for order initiation/replay; provider retry contract unverified |
| 14 | Callback/webhook | MISSING wire decoder | MISSING wire decoder and provider delivery/acknowledgment verification |
| 15 | Refresh/back navigation | PARTIAL | PARTIAL: linked-order attempt identity retained; ambiguous retry opens local status; lost-session recovery still requires provider lookup/operations procedure |
| 16 | Timeout/outage | PARTIAL | PARTIAL: pending/unknown preserved; no automatic provider reconciliation without lookup contract |
| 17 | Test/production configuration | BLOCKED BY EXTERNAL CONFIGURATION | BLOCKED BY EXTERNAL CONFIGURATION |
| 18 | Authorization/RLS | IMPLEMENTED BUT UNVERIFIED | COMPLETE locally; actual production grants/policies/function bodies unverified |
| 19 | Safe logging | COMPLETE locally | COMPLETE: allowlisted errors/projections; no raw provider logging added |
| 20 | Rivhit boundary | COMPLETE in approved architecture | COMPLETE; existing asynchronous accounting retained, not activated/changed |

Missing code found: real initiation transport, provider notification decoder, confirmation transport, authoritative lookup transport/response mapping, authoritative order validation, cross-key order reservation protection, safe unknown-status classification, browser retry continuity, and pre-reservation provider readiness.

Code completed here:

- Additive migration `030_pelecard_order_payment_safety.sql`; no new ledger tables and no historical backfill.
- Service-only order reservation with a row lock, actor role validation, authoritative amount/currency/snapshot, and paid/cancelled/existing-sale/overlapping-attempt rejection.
- Pending-order protection against changing payable fields, status, or recording a manual payment-status change while provider outcome is uncertain.
- Order-linked store calls use the new RPC. The Edge entrypoint requires an order. Standalone/manual legacy code is preserved; standalone hosted initiation is not enabled by this runtime.
- The provider receives the reserved amount/currency. Browser order metadata is never copied into the authoritative snapshot.
- Unknown statuses stay pending; only explicitly configured failure codes can terminate a payment as declined.
- Linked-order retries reuse identity; known terminal failures can start a new attempt, while ambiguous/succeeded retries route to local status.
- Unconfigured provider capabilities are checked before reservation, avoiding false pending locks.
- Regression tests and a credential-free, in-memory PostgreSQL migration/behavior rehearsal.

## 8. Provider contract verification

Official sources inspected: [Pelecard developer entrypoint](https://gateway20.pelecard.biz/), [IFrame/Redirect fields](https://gateway20.pelecard.biz/ManualIframe/About), and [payment flow](https://gateway20.pelecard.biz/ManualIframe/Chart).

Verified generic contract: JSON initialization at `https://gateway20.pelecard.biz/PaymentGW/init`; `terminal`, `user`, `password`; `Total` in agorot, `Currency=1` for ILS; hosted redirect URL; `UserKey` (up to 50 characters) for merchant correlation. `ParamX` is limited to 19 characters and must not carry our full UUID. Good/Error/Cancel URLs and server feedback URLs are documented. Browser feedback defaults to GET. Server feedback can wrap JSON in a form field selected by `resultDataKeyName`; even raw JSON feedback is documented with form content type. `ValidateByUniqueKey` takes `ConfirmationKey`, `UniqueKey`, `TotalX100` and returns 1/0; it detects forgery, not payment success. The public manual identifies `000` as successful and restricts QA simulation to test terminals.

The older handoff's blanket statement that public wire documentation is unavailable is therefore too broad. Nevertheless, it does not establish the complete safe activation contract for this merchant.

Specific unresolved provider facts:

1. Authorized TEST terminal/user/password and confirmation that transactions on it cannot settle real money; permitted test cards, decline and 3DS simulations. A sandbox webpage or gateway hostname alone is not proof.
2. Exact authoritative transaction-lookup endpoint/method, request and response schema, including transaction ID, approval (possibly absent on failures), terminal, currency, amount unit, merchant `UserKey`, final/pending/cancelled status and delayed visibility.
3. Lookup by merchant key/session after an ambiguous initialization or missing callback, including whether it distinguishes no transaction from an in-flight transaction.
4. Initialization response session-reference field and expiry/reuse semantics; duplicate initialization/hosted-submit behavior.
5. Callback schema for this integration, correlation field, required acknowledgment, delivery retries/order, and browser cancellation/error behavior.
6. Merchant terminal enablement for hosted J4/3DS, permitted callback/return origins, and test-versus-production configuration. MAX's acquiring role is not established by repository evidence and requires no code/provider substitution.

No provider API transaction request was sent during this task. Public documentation GETs only. No generic public sample credentials were adopted.

## 9. Configuration audit

Values are intentionally omitted. Local means inspected repository/worktree environment files and process environment, not a claim about provider systems.

```text
Local frontend:
VITE_SUPABASE_URL: present
VITE_SUPABASE_ANON_KEY: present
VITE_PELECARD_REDIRECT_ORIGINS: missing

Local server environment:
SUPABASE_URL: missing
SUPABASE_ANON_KEY: missing
SUPABASE_SERVICE_ROLE_KEY: present
SUPABASE_SERVICE_ROLE_KEY_LOCATION: inconsistent
PAYMENTS_APP_ORIGINS: missing
PAYMENTS_RETURN_URL: missing
PAYMENTS_CALLBACK_URL: missing
PELECARD_REDIRECT_ORIGINS: missing
PELECARD_TERMINAL: missing
PELECARD_SUCCESS_STATUS_CODES: missing
PELECARD_FAILURE_STATUS_CODES: missing
PELECARD_USER: missing
PELECARD_PASSWORD: missing
PELECARD_BASE_URL: missing
```

The existing service secret is in main's ignored `app/.env.local`, contrary to project guidance to keep it outside the frontend directory. It has no VITE prefix; literal scans found it absent from both existing main and task build assets. It was not copied, printed, relocated, or committed. USER/PASSWORD/BASE_URL are anticipated transport inputs from historical documentation, not variables that magically wire the current runtime. FAILURE_STATUS_CODES is new and optional: omission safely leaves non-success statuses pending.

**Supabase production secret names:** current verification unavailable. `supabase secrets list --output json` returned 401 Unauthorized. It is not honest to classify those names as missing or present today. The 2026-09-10 handoff records return/callback/app/redirect origins and refund-disabled configuration as present then; terminal credentials were absent then. Those historical claims are not treated as current proof.

Current read-only observations: linked project and frontend project agree; initiate OPTIONS returns 204; callback/verify/status OPTIONS each return 500 with `invalid_configuration`. The exact missing production variable cannot be identified from those sanitized errors. The initiating constructor and verification constructor require different configuration.

**Provider-side configuration:** unverified; no merchant dashboard or terminal credentials inspected. **Frontend production build environment:** historical redirect-origin fix exists, but current hosting environment variables were not retrieved.

Routes in source: `/payment/return` and `/functions/v1/pelecard-callback`; Vercel SPA rewrites exist. The production callback endpoint is reachable but unhealthy. Exact current secret URL values could not be compared with routes because production secret inspection is unauthorized.

## 10. Database / migrations

Current production REST schema metadata confirms `payment_transactions`, `payment_transaction_events`, `accounting_events`, payment/order/sale columns, and existing reserve/finalize/get/complete/fail RPCs. It does **not** prove the deployed SQL definitions, RLS, triggers, uniqueness indexes, grants, or migration checksums match this branch. Those require read-only catalog inspection and migration-history comparison before deployment reliance.

`reserve_pelecard_order_payment` is missing in production. Migration 030 was not applied remotely. Number 029 is reserved by the preserved customer branch; 030 has no customer dependency. Rehearsal applied unchanged migrations 001–028 and new 030 in isolated PGlite PostgreSQL with a synthetic Supabase auth/storage substrate. No schema was duplicated.

Pre-030 synthetic legacy order and sale rows remained byte-for-byte unchanged. Existing payment SQL tests and new order-safety assertions passed, including access grants, idempotency and unique transaction/sale links. PGlite's serial connection is not a multi-connection concurrency/load or Supabase service E2E test. Run native pgTAP and simultaneous sessions in isolated Supabase staging before rollout.

Recovery: keep ledger/history and additive schema; disable new initiation and retain callback/status reconciliation if rollout fails. Do not delete pending/succeeded payments or relax locks to retry uncertain charges. Migration DDL is transaction-wrapped. If 030 fails during application, PostgreSQL rolls back that transaction. Any post-commit removal/rollback requires an explicit reviewed migration; do not revert to an unsafe initiating handler while accepting live traffic. Deploy migration and matching Edge changes together only after approval.

## 11–16. Security and payment behavior

- Only authenticated staff reach initiation/verify/status; the new order RPC additionally checks the saved actor is admin/operations. `cashier` is a legacy handler test role, not an added database role or grant.
- Browser UUIDs are identifiers to validate, never payment authority. Order existence, state, amount, currency and existing payments/sales are checked server-side under an order lock.
- Idempotency protects same-key retries; order locking rejects a different key while any initiated/pending/timed-out attempt exists. Existing payment/provider-ID/sale uniqueness and atomic finalization protect callback replays. Existing historical/manual sales conservatively block a fresh order charge.
- Timeout does not prove failure. Unknown codes remain pending; a new failed-code allowlist must be provider-confirmed. Browser cancellation never changes the order to paid. Definitive cancellation and unattended reconciliation await provider contract work.
- One sale and its payment link are committed with verified payment/order state; repeated finalization returns the same sale. Operational order `status` is not changed by the payment finalizer.
- No card fields were added; provider output is projected into safe fields. Errors do not expose credentials or raw provider bodies.
- The old generic service-only reservation RPC remains for historical compatibility. New order safety requires the matching new Edge entrypoint; do not enable old callers concurrently. Actual production schema protections remain a deployment gate.
- Approved existing Rivhit outbox/wake-up behavior is retained unchanged. A future successful provider test could trigger accounting if configured; staging must have no live Rivhit token/mapping/worker before payment-only testing. An accountant's mapping is not necessary to verify payment itself, but accounting activation is a separate decision.

## 17–18. Automated verification

- Untouched quotation-base regression: 66 files / 695 tests passed.
- Final regression: **67 files / 703 tests passed**, exit 0; all frontend and included Edge suites run with one worker, unchanged timeouts, neutral Supabase test variables.
- Focused payment suites, including auth/forgery/amount mismatch/duplicate/replay/provider-failure/timeout tests, pass. New tests cover readiness, order requirement, server snapshot, unknown codes, identity continuity and confirmed-failure retry.
- `deno check` passes for initiate, callback, verify, status (run from repository root). An invocation from `app/` initially selected app npm resolution; rerunning from root resolves the pinned Edge dependency correctly.
- In-memory rehearsal passes original ledger (12), workflow (15), role protection (4), accounting orchestration (15) SQL assertions with an explicit fail-hard compatibility harness. Original assertions, SQLSTATE checks and plan counts are retained; this is not claimed as native pgTAP/Supabase execution.
- New SQL behavior checks: amount/currency tampering, invalid actor/order, cancelled/manual-paid/already-paid order, cross-order key replay, cross-key duplication, uncertain retry, order edit protection, authenticated RPC denial, atomic success/replay and retry after confirmed decline.
- Production-mode Vite build passes using neutral test configuration. Focused changed-file lint passes. `git diff --check` passes.
- Full lint fails on the same six unrelated errors in Dashboard, Leads, Products, Templates, Users. Full typecheck fails with 175 diagnostics; the untouched quotation base also produces 175. No payment-module diagnostics; payment Edge checking passes. These unrelated workstreams were not edited to make the report green.
- No browser-hosted provider, real card, native multi-session PostgreSQL, callback delivery, or Supabase service E2E test was performed.

## 19. Hook failure investigation

No active Git commit hook/core.hooksPath was found. The reproducible code-1 faults are global Codex GSD commands in `C:/Users/nadav/.codex/hooks.json`:

- PreToolUse `gsd-prompt-guard.js` and PostToolUse `gsd-context-monitor.js` use single-quoted Windows script paths. Under Windows `cmd.exe`, the quotes are literal path characters: both return exit 1 / `MODULE_NOT_FOUND`. The same scripts invoked directly with Node and identical `{}` stdin return 0. Repair is Windows-compatible double-quoted paths, keeping the hooks enabled.
- Codex runtime logs separately record `legacy_notify` failures with Windows error 206, “filename or extension is too long,” for the `codex-computer-use.exe turn-ended` notification hook. This is a separate command-line size failure, not a payment test failure.
- The Impeccable plugin additionally contains POSIX shell syntax in its hook commands; compatibility should be checked against its actual launcher, not silently bypassed.

No hooks were disabled, bypassed or globally modified. The retained logs do not contain the stderr for the user's particular displayed code-1 event, so attribution of every occurrence to a single hook is not proven. The two GSD failures above are directly reproduced, while the notification failure is directly logged.

## 20–24. External steps, test readiness, client/provider inputs and approval boundary

**Provider TEST transaction now: NO.** Required code is still unconfigured, verified test credentials/environment are absent locally, production verification routes are unhealthy, and the new migration exists only locally.

Required from the operator/developer:

1. Restore authorized read-only Supabase management/catalog inspection to establish exact current secret names, function versions, grants, policies, trigger/index definitions and migration history. No production mutation is needed for this audit.
2. Identify an isolated non-production Supabase project and HTTPS frontend preview. No such verified target is currently configured for this task.
3. Obtain the specific provider facts listed in section 8; then implement and fixture-test the init/notification/validate/lookup wire adapter, cancellation and unknown-outcome recovery. Do not enable initialization before authoritative lookup works.
4. Obtain approval before applying migration 030 remotely or deploying/configuring the payment functions and frontend. Run native SQL/concurrency and callback delivery tests there; isolate existing accounting from live credentials.

Required from client: confirm the intended merchant terminal/acquirer and arrange secure provisioning of its authorized TEST credentials, or authorize Pelecard support to supply them. No new business feature, digital signature, Clubs/iCredit work, WhatsApp work or Rivhit document mapping is needed to finish payment-only verification. Do not ask the client to paste secrets into chat.

Required from Pelecard: exact lookup and notification/retry contract, test-terminal/non-settlement confirmation and approved test scenarios, plus terminal permissions/3DS requirements. MAX is needed only if merchant acquiring enablement is absent; the repository does not establish that it is.

Prepared controlled test, **not executed**:

1. On the approved isolated TEST stack, create a synthetic order (client label `PAYMENT-E2E-20260923`, one participant, price per person ILS 1.00, unpaid). Let the database generate its ID/order number; record them before requesting a charge.
2. Use admin/operations, link that order in the cash register, and make the displayed cart expectation ILS 1.00. Confirm the terminal is explicitly TEST and live accounting credentials/workers are absent.
3. Start one hosted attempt, enter only Pelecard-approved test card data on the provider page, and verify authoritative lookup before one local payment/sale/order transition.
4. Repeat callback, browser return, refresh and same-key initiation; verify no second sale/event/charge. Attempt a different-key charge for the paid order; it must be blocked before provider access. Test cancellation, decline, timeout and delayed callback with separate synthetic orders.
5. Accounting outbox creation is expected from the approved architecture; actual document issuance must stay disabled for payment-only testing.

If the supplied terminal is LIVE-only: stop again before initialization/card submission. Proposed amount is ILS 1.00, but no live order/terminal has been selected or approved. The exact void/refund procedure, merchant settlement cutoff and available permissions are not confirmed; obtain them from Pelecard/MAX before requesting any live-charge approval. No refund or void is authorized here.

**Next external action requiring approval:** deploy this reviewed migration/Edge/frontend candidate to a specifically identified isolated TEST project after completing the provider adapter contract. There is no request to approve a live charge now. Production migration/deployment and any live charge remain separate explicit approvals.

## 25. Branch and status

Branch: `fix/payment-finalization-20260923`. Worktree: `.worktrees/payment-finalization`. Base HEAD: `eb810b9779e974375cdc71d7280dd9344b473e0a`. Final local commit HEAD and clean/dirty status are reported in the final response after verification. Main stays `2a0c7f5`; quotations stay `eb810b9`; customers stay `03316ef`. No remote branch changes.
