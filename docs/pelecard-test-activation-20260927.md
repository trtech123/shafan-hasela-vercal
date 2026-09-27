# Pelecard TEST activation checkpoint

## Safety boundary

Project: `divzxsynczeifkpnpupl`. Only `PELECARD_TEST_USER`, `PELECARD_TEST_PASSWORD`, and `PELECARD_TEST_TERMINAL` are consumed by the isolated TEST provider. Secret values are never downloaded, printed, logged, returned, or written to artifacts. `PELECARD_MODE=test` is required exactly; every other value fails closed. The commercial initiation, callback, verification and refund entrypoints have unconditional guards before constructing their runtime. No configuration value enables LIVE execution.

`PELECARD_TEST_TRANSACTION_ENABLED` must equal `true` to initialize even a TEST session. The activation checkpoint leaves it `false`. No initialization or transaction is authorized by a successful read-only preflight.

## Official contract reconciliation

The supplied January 2025 English manual is the authority for REST Services, including its `ResultData` envelope. Its actual local filename has a double `.pdf.pdf` suffix. The Hebrew August 2024 manual and supplied main error-code document were also inspected. All three PDFs remain untracked and excluded from the commit; the manuals include example authentication data and have not been cleared for publication.

| Operation | Fixed endpoint / receiver | Evidence |
|---|---|---|
| Hosted initialization | `POST https://gateway20.pelecard.biz/PaymentGW/init` | Official [IFrame flow](https://gateway20.pelecard.biz/ManualIframe/Chart) and Sandbox implementation |
| Authoritative retrieval | `POST https://gateway21.pelecard.biz/PaymentGW/GetTransaction` | Supplied English manual pp18–19; `StatusCode`, `ResultData` |
| Anti-forgery validation | `POST https://gateway21.pelecard.biz/PaymentGW/ValidateByUniqueKey` | Supplied English manual p17 |
| Non-charging credential preflight | `POST https://gateway21.pelecard.biz/services/GetTerminalName` | Supplied English manual's GetTerminalName operation |
| Provider feedback | `https://divzxsynczeifkpnpupl.supabase.co/functions/v1/pelecard-test-feedback?testPaymentId=<local UUID>` | Configured as both ServerSideGoodFeedbackURL and ServerSideErrorFeedbackURL, with `resultDataKeyName=testResult` |
| Browser return | Same TEST feedback function with `return=1` | Informational only; GET/POST never access payment state |

The gateway20 developer tool also publishes gateway20 GetTransaction/ValidateByUniqueKey routes. Its output tab is flat, unlike the supplied REST manual's nested ResultData example. Those alternative routes are not used as failovers. No generic configurable base URL, host substitution, or compatibility inference is implemented. The cross-host initialization/retrieval sequence follows the respective selected documents but still requires actual TEST evidence. Preflight cannot establish that a gateway20-created session will be retrievable through gateway21; if it is not, verification fails closed and support clarification is required.

### Exact status semantics

- `GetTransaction.StatusCode === "000"`: REST action succeeded; insufficient to declare a payment successful.
- `GetTransaction.ResultData.ShvaResult === "000"`: successful transaction result, corroborated by the supplied main error-code document. If ShvaResultEmv is present, it must also be exactly `"000"`.
- The untrusted callback's PelecardStatusCode is never a decision input. The official IFrame About page independently documents `"000"` for that field.
- `ValidateByUniqueKey` must return JSON number `1`, solely as correlation/anti-forgery evidence. It does not establish payment success.
- Support's verbal `"00"` remains unmapped to an exact documented field/API. It is never padded, converted to a number, equated to `"000"`, or accepted as an alternate success code.

Verification additionally checks the exact provider transaction ID, the stored initialization ConfirmationKey, DebitTotal=100, DebitCurrency="1", JParam="4", a debit transaction type, a nonempty approval number and ApprovedBy in the documented approved values. The provider-held ConfirmationKey is validated against the immutable local UUID and amount. GetTransaction is authenticated with the TEST terminal; its documented response does not independently echo a terminal number, so none is fabricated as provider evidence. Provider IDs are bounded opaque strings, as documented, not assumed to be UUIDs.

## Database and accounting effect of the eventual approved test

Only `public.pelecard_test_payments` is used. It is service-role-only, has fixed mode `test`, fixed amount 100 agorot/ILS, immutable identity, unique provider transaction ID and strict `initiating → pending → test_verified` transitions. There are no order or sale columns or commercial-ledger references. No user credentials, raw provider responses, card data, customer data or terminal number are stored there. Initialization ConfirmationKey and hosted URL are private server-side evidence; only the hosted URL is deliberately returned to an authenticated admin who initializes a test.

An approved initialization creates one TEST record before one provider request. A repeated request with the same UUID is rejected; an interrupted initialization remains reserved and is not automatically reissued. Successful provider verification updates that TEST row only. No commercial payment, sale, order paid flag, receipt, accounting event, invoice, Rivhit customer or document is created. Existing Rivhit behavior and global accounting configuration are unchanged. Unsupported responses or mismatches leave the TEST record unverified.

The existing checkout UI is not the test launcher. Use the separate admin-only `pelecard-test` function. It rejects supplied order IDs, amounts and credentials. Its actions are `preflight`, `initiate`, `verify`, and `status`; initiation remains disabled at this checkpoint. The first test requires explicit approval and provider-approved test-card/instructions. Never enter a real card.

## Production baseline and verification

Production read-only access initially returned HTTP 401; the user restored CLI access before any production mutation. Function source download found deployed source marker `4c539f5`. The relevant payment commits were imported from the existing `fix/payment-finalization-20260923` workstream rather than overwriting production with older main code. Baseline compiled initiation matches the downloaded code; callback/verify/status differences are only emitted class-field declarations in accounting repositories. The unchanged status function, accounting worker, Rivhit functions, unrelated functions and frontend are not deployment targets.

Before changes: 12 orders, 10 sales, zero commercial payments, zero accounting events/documents, no TEST table. The order-safety RPC is present. The production migration-history table is absent, so migration 031 must be applied explicitly after checking table absence, rather than blindly pushing historical migrations.

Validation commands:

```text
npm test --prefix app -- --maxWorkers=2
npm run build --prefix app
deno check supabase/functions/pelecard-test/index.ts supabase/functions/pelecard-test-feedback/index.ts supabase/functions/pelecard-test-preflight/index.ts supabase/functions/pelecard-initiate/index.ts supabase/functions/pelecard-callback/index.ts supabase/functions/pelecard-verify/index.ts supabase/functions/pelecard-status/index.ts supabase/functions/pelecard-refund/index.ts supabase/functions/payment-accounting-worker/index.ts
node scripts/payments/rehearse-test-isolation.mjs
git diff --check
```

The native PostgreSQL runner uses a disposable loopback-only PostgreSQL 18 database, synthetic Supabase auth/storage fixtures and the repository's assertion compatibility functions. It executes actual migrations and every assertion in the ledger, workflow, role protection, accounting orchestration and TEST isolation SQL suites. It does not claim a full hosted Supabase/pgTAP environment. No SQL fixture is run against production.

Exposure checks scan runtime frontend source/build for provider credential identifiers and synthetic credential canaries, check new server modules for logging/unsafe serialization, and check staging for PDFs/environment files. They never retrieve real secrets for comparison. The only frontend-source identifier match is in the existing synthetic backend transport test, not runtime code or the build.

## Deployment and preflight evidence

Implementation commit: `e57be8a0e84baafb7b9d1d4dd5beb291c34759b8`, branch `workstream/pelecard-test-isolation`.

Final local verification passed: 66 test files / 733 tests; production frontend build; Deno checks for all nine payment/TEST/accounting entrypoints listed above; all five SQL suites on native PostgreSQL; frontend/build/server-log/staging exposure checks; `git diff --check`. Independent review identified the opaque provider-ID issue, which was fixed and re-reviewed before final verification.

**Production deployment completed after access was restored.** The fresh read-only baseline still had the three execution functions at v14, no TEST table, and unchanged business counts. Deployed only `pelecard-initiate`, `pelecard-callback`, `pelecard-verify`, `pelecard-test`, and `pelecard-test-feedback`; explicitly applied migration 031. Set only the new settings `PELECARD_MODE=test` and `PELECARD_TEST_TRANSACTION_ENABLED=false`. Existing LIVE credentials and global Rivhit configuration remain untouched.

The temporary `pelecard-test-preflight` function authenticated the TEST credentials through GetTerminalName: HTTP 200, authenticated=true, transactionCreated=false. It was then deleted; its two temporary authorization secrets were unset and the local temporary authorization file removed. Subsequent metadata lists contain only the expected TEST credential names and two permanent mode/gate settings, without inspecting values. No TEST initialization, card entry, charge, refund or void occurred.

Post-deployment source download: all 29 downloaded source files match local files after line-ending normalization. Active execution function versions are v18; TEST and TEST-feedback are v3. Supabase secret updates also advanced versions of untouched functions: status is v16 and Rivhit/accounting worker are v15, but their artifact SHA-256 values exactly match the pre-deployment baseline. They were not redeployed. No frontend deployment or refund-function deployment occurred.

Production verification: 12 orders, 10 sales, zero commercial payments, zero accounting events/documents, zero TEST rows. TEST table has both RLS and FORCE RLS enabled; authenticated SELECT and anon INSERT are denied. Safe HTTP checks passed: empty commercial callback returns 500 from its fail-closed runtime guard; unauthenticated TEST status returns 401; browser return returns 200 with commercialEffect=false; removed temporary probe returns 404. No actual initialization request was used to check the gate.

**Hard stop retained.** A successful credential probe alone does not establish non-settlement or cross-host session compatibility. Provider-approved test-card instructions and confirmation of this hosted TEST flow remain required; support's verbal `00` still lacks a field/API mapping. Never use a real card or silently relax status checks. No actual TEST session may be initialized until the remaining provider instructions are resolved and the user explicitly approves the transaction checkpoint.
