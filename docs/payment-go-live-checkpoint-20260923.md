# PAYMENT GO-LIVE CHECKPOINT — 2026-09-23

Activation is blocked by the merchant-assigned gateway/environment. Credentials
are present but were not read, exported, logged, or used in a provider request.
No hosted session, charge, refund, void, or synthetic production order was created.

## 1. Final architecture

Staff React checkout → authenticated `pelecard-initiate` → service-only
`reserve_pelecard_order_payment` → Pelecard `PaymentGW/init` → hosted page →
callback/browser notification → `ValidateByUniqueKey` → authenticated
`PaymentGW/GetTransaction` → validation of the lookup's own confirmation key →
reconciliation → atomic `finalize_pelecard_payment` → sale/order/ledger update.
Existing accounting outbox behavior is preserved.

## 2–3. Adapters and authoritative verification

`pelecard-transport.ts` consumes `PELECARD_USER`, `PELECARD_PASSWORD`, and
`PELECARD_TERMINAL` only server-side. `PELECARD_BASE_URL` is mandatory, with no
default; only documented Pelecard gateway hosts are accepted. Requests cannot
follow redirects with credentials. Transport has the existing 10-second timeout.

Initialization uses fixed ILS/agorot, J4, FreeTotal=False, CreateToken=False,
UserKey=local payment UUID, correlated return/callback URLs and the explicitly
configured form wrapper `result`. The documented init `URL` is the hosted URL;
the adapter does not invent a separate init response identifier. It stores that
URL as the session reference. No card data or provider payload is persisted.

Lookup uses the notification's transaction identifier with merchant credentials.
It checks the returned TransactionId, validates the lookup's ConfirmationKey
against the local UUID and returned amount, then reconciles amount/currency
against the stored authoritative reservation. Lookup operation StatusCode=000
alone is insufficient: the charge's ShvaResult must also be 000 and have an
approval number. Conflicting EMV results fail closed. Only safe fields leave
the adapter. Browser success/status is ignored.

Official sources inspected:
- https://gateway20.pelecard.biz/ManualIframe/Chart
- https://gateway20.pelecard.biz/ManualIframe/About
- https://gateway20.pelecard.biz/SandboxServices?selectedMethodId=58
- Official SandboxServices/GetInputTab and GetOutputTab documentation for method 58
- https://gateway20.pelecard.biz/Scripts/Payment/Sandbox.js (init response URL)

These are public-contract implementations tested with synthetic responses,
not evidence of this merchant terminal's actual responses or acceptance.

## 4. Terminal/environment selection

No environment selected. Production Supabase is `divzxsynczeifkpnpupl`.
The user confirms the credentials came from the client's API/e-commerce setup,
but explicitly has no gateway or TEST/LIVE confirmation. A gateway hostname
does not prove non-settlement. Public QAResultStatus is documented as effective
only on Pelecard test terminals; it is not a way to convert a LIVE terminal to TEST.

## 5. Configuration

Production Supabase secret inventory, names only:

| Name | Status |
|---|---|
| PELECARD_USER | present |
| PELECARD_PASSWORD | present |
| PELECARD_TERMINAL | present |
| PELECARD_BASE_URL | missing |
| PELECARD_SUCCESS_STATUS_CODES | present |
| PELECARD_FAILURE_STATUS_CODES | missing |
| PAYMENTS_APP_ORIGINS | present |
| PAYMENTS_RETURN_URL | present |
| PAYMENTS_CALLBACK_URL | present |
| PELECARD_REDIRECT_ORIGINS | present |
| PELECARD_REFUND_ENABLED | present |
| RIVHIT_API_TOKEN | missing |

Configured the publicly documented success code `000`. Runtime rejects other
success mappings and nonempty failure mappings. Failure codes remain unset:
009 is a communication problem, 500 is terminal busy, and even a documented
decline such as 004 does not establish that the hosted session can never later
succeed. Do not map all nonzero codes to an irreversible local failed state.
Unresolved/declined/cancelled browser returns cannot mark an order paid or release
an overlapping charge attempt. Definitive cancellation/session expiry and retry
semantics still need provider validation during controlled testing.

Callback and return URL digests match the actual production function and
`https://shafan-hasela-vercal.vercel.app/payment/return` respectively.
Vercel production has VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and
VITE_PELECARD_REDIRECT_ORIGINS. No provider credentials were added to Vercel.

## 6. Migration 030

Applied to production after a fresh isolated rehearsal and catalog comparison.
The existing reserve/finalize/protect-order function bodies exactly matched
reviewed migrations. Before application: 12 orders, 10 sales, zero payment rows,
zero pending payment attempts; migration 030 RPC/trigger absent. Existing payment
idempotency, provider-transaction and sale uniqueness indexes were verified.

Migration was applied transactionally with lock/statement timeouts and a
session-local before/after fingerprint assertion. All legacy order/sale/payment
rows were unchanged. Post-application: new function body matches 030 exactly;
trigger enabled; service_role EXECUTE=true; anon/authenticated EXECUTE=false.
Existing table RLS remains enabled. No migration-history table existed; do not
blindly run a migration push. Determine state from the real catalog.

An initial SQL-editor submission contained stale text and failed parsing before
execution. The corrected editor content was compared in full to the reviewed
script before the successful application.

Recovery: leave the additive schema installed and disable initiation by leaving
the provider endpoint unset. Redeploy the prior function/frontend artifacts if
necessary. Removing the new trigger/RPC is a separately reviewed action and must
not be done while payment attempts are open. No historical records need deletion.

## 7. Deployed Edge Functions

All four deployed through the authenticated dashboard in the verified project:
`pelecard-initiate`, `pelecard-callback`, `pelecard-verify`, `pelecard-status`.
Dashboard deployment counter: 10 for each after deployment. Each bundled
entrypoint contains source marker `3bb2dd7b630e0dc2dfe25498b9ccc8aa5b21b7c7`;
the editor contents were compared in full to the local artifact before deploy.
Existing unrelated functions and accounting worker were not deployed or edited.

Artifacts were bundled with esbuild using ESM/platform=neutral and external npm
imports. The original pinned Supabase SDK import remains. Base URL absence
blocks initialization before a payment reservation; lazy provider creation
allows OPTIONS and staff authorization checks without provider configuration.

## 8. Deployed frontend

Vercel production project `prj_6rvjmBAfEUpym5E4JwVPut1HiXQC`, team
`team_wBjKr13fvum5krxkUPPpeEuQ`, rootDirectory=app.
Deployment `dpl_EKER1tfAwYt4noxUCxXhewExaZr9`, READY, production alias
https://shafan-hasela-vercal.vercel.app .

A separate release checkout starts at the previous deployed production commit
`2a0c7f5d7e777e044c8d5281c0bd60a3c21a840b`. Release commit
`5d32d9c907cf84d01acc342fcc4b47fa649218ff` changes only:
- app/src/payments/pelecardPayments.js and its tests
- app/src/pages/PaymentReturn.jsx and its tests

It includes guarded retry identity and recovery of a payment UUID from the
return URL after session storage loss. That UUID is a locator, never proof of
payment. No quotation/customer/Clubs/chatbot/signature changes entered this
release. No merge or push was required. Vercel records the release SHA in
`paymentRelease` metadata; its automatic githubCommitSha is null for this CLI
deployment, so do not claim Git-provider commit verification.

## 9–11. Reachability, provider connectivity, security

Deployed checks:
- initiate OPTIONS: 204 with production app Origin
- initiate without authentication: 401
- verify without authentication: 401
- status OPTIONS: 204; without authentication: 401
- malformed public callback: 400
- browser /payment/return: 200

Public Pelecard documentation was reachable. No credential-bearing provider
request was made. Merchant/terminal acceptance is unverified. Authenticated
deployed order cases and a hosted browser flow remain unverified; local tests
cover them. No synthetic production user was created or staff impersonated.

Migration 030 permits order initiation for admin/operations. Production also
has a cashier role; this task did not broaden the reviewed SQL authorization.
No raw card data, tokens or provider responses are logged or stored by the new
transport. Configuration errors and network errors are sanitized.

## 12–13. Automated verification

- Finalization branch: 725/725 tests, 68 files.
- Isolated production release: 624/624 tests, 61 files, complete build PASS.
- Four Edge Function Deno checks PASS.
- Changed frontend/payment test ESLint PASS.
- Fresh isolated migration rehearsal PASS, including unchanged legacy records,
  invalid/cancelled/manual-paid/already-paid orders, amount/currency tampering,
  cross-key duplicates, timeout guard, order edit guard, RPC authorization,
  finalization/replay and existing ledger/accounting suites.
- New transport tests cover explicit environment gating, request mapping,
  malformed/failed init, timeout/unavailable, authoritative lookup, forged
  correlation, transaction mismatch, unknown/declined/error states, amount
  mismatch and callback replay using actual documented wire field names.

Local database rehearsal uses PGlite and an assertion compatibility harness;
it is not a native multi-session concurrent Supabase execution. Production
catalog/grants were separately verified. Existing unrelated full-lint/typecheck
findings from the baseline checkpoint were not repaired or represented as passing.
No test timeout was increased, and no tests were disabled. The old source-contract
test demanding an unwired adapter was replaced with wiring assertions while
retaining its no-logging/no-card-payload checks and adding behavior tests.

## 14–17. TEST, database, replay, accounting

No TEST transaction was run: non-settlement is unconfirmed. Production payment
rows remain zero at the post-migration verification. No sale/order payment
changes, accounting events or documents were generated by a test. Replay is
proven locally, not with Pelecard delivery. Existing success-to-accounting outbox
behavior remains; RIVHIT_API_TOKEN is absent, so do not promise that a future
successful synthetic payment has no durable accounting side effect.

## 18–23. Readiness and exact remaining action

Not production-payment ready and NOT READY FOR LIVE CONTROLLED TEST.
The single activation fact needed is the gateway/environment assignment for the
supplied API/e-commerce credentials. Do not set PELECARD_BASE_URL or send those
credentials to a guessed host. Client need not supply more secrets in chat.

Send to Pelecard/client:

> For the API/e-commerce credentials supplied to Shafan Hasela, please confirm
> the assigned gateway/base URL and whether the terminal is LIVE or a genuine
> non-settling TEST terminal. If LIVE, can Pelecard provide TEST credentials/
> environment for end-to-end testing without charging or settling money?
> Please send any credentials through a secure channel.

After confirmation: set the verified endpoint, perform an authorized non-charge
preflight, validate actual response/callback shapes and terminal behavior, then
run a genuine non-settling synthetic E2E only if explicitly supported. If only
LIVE is available, first prepare the exact order/amount/accounting implications
and merchant-confirmed void/refund procedure, then stop for real-charge approval.
No live test order or refund procedure is claimed ready now.

Operational limits pending provider testing: polling reads the local ledger;
provider verification retries need a callback/return transaction identifier.
Lost provider notifications, definitive cancellation, timeout after init before
the hosted URL is received, and callback retry/acknowledgment behavior have not
been validated with Pelecard. These remain unresolved safely, blocking a second
charge rather than guessing success or releasing the order.

## 24–25. Commits, worktrees and status

Finalization: `fix/payment-finalization-20260923` at implementation commit
`7aa3e07` (following adapter `3bb2dd7` and baseline `dfafc40`). This checkpoint
is committed separately. Worktree: `.worktrees/payment-finalization`.
Production frontend release: `release/payment-only-20260923` at `5d32d9c`,
worktree `.worktrees/payment-finalization/.worktrees/payment-release-20260923`.
Both implementation/release commits were clean when deployed. Main is unchanged.

Hook findings remain as recorded in the baseline checkpoint: Windows quoting
failures in global GSD hook commands and separate notification command-length
failures; no hooks were disabled or bypassed. All commits in this turn succeeded.
