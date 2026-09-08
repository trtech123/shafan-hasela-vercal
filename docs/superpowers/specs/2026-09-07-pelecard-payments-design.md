# Pelecard Hosted Payments Design

**Date:** 2026-09-07  
**Status:** Approved for implementation  
**Scope:** Pelecard payment architecture, immutable ledger, server-side verification, safe Cash Register integration, reconciliation, and capability-gated refund/void support. Rivhit and production deployment are excluded.

## Goals

- Collect all cardholder data only on Pelecard-hosted Redirect/IFrame 2.0 pages.
- Keep Pelecard credentials in Supabase Edge Function secrets and never return them to the browser.
- Treat browser returns and provider callbacks as untrusted notifications, not proof of payment.
- Verify each successful payment with Pelecard before creating a sale or changing an order's payment state.
- Make initiation, callback handling, finalization, status polling, and refunds idempotent.
- Preserve an immutable, queryable audit history without PAN, CVV, expiry, card tokens, or raw provider payloads.
- Preserve the existing external/manual credit workflow and distinguish it from verified Pelecard payments.

## Non-goals

- Rivhit integration or invoice creation.
- Recurring charges, card-on-file, or token storage.
- Direct Gateway card-data collection.
- Production deployment, production migrations, production credentials, or real production transactions.
- Assuming the supplied terminal can refund or void transactions before Pelecard confirms that capability.

## Provider Flow Selection

Use Pelecard IFrame/Redirect 2.0 with a full-page redirect. The server calls `https://gateway20.pelecard.biz/PaymentGW/init`, and the browser receives only the returned hosted URL. Pelecard collects the card details and handles any 3DS challenge.

Pelecard's documented `ConfirmationKey` / `ValidateByUniqueKey` check is an anti-forgery control, not a status query. A callback is successful only after both checks complete:

1. Validate the callback's confirmation key against the locally stored unique key and exact amount in agorot.
2. Retrieve the provider transaction using server-side credentials and verify its final status, transaction ID, terminal, amount, currency, and merchant correlation key.

The browser return page polls local sanitized status. It never finalizes a payment from query parameters.

Official references:

- Hosted flow and verification sequence: https://gateway21.pelecard.biz/ManualIframe/Chart
- Redirect/IFrame parameters, server-side feedback, and output fields: https://gateway21.pelecard.biz/ManualIframe/About
- 3DS terminal and merchant-registration requirements: https://gateway21.pelecard.biz/ManualIframe/CredoRax?Length=6
- Gateway API sandbox and explicit warning against client-side credentials: https://gateway21.pelecard.biz/sandbox

## Existing System Boundaries

The Cash Register currently inserts `sales` directly from React for every method. Its stored method `אשראי` means a payment processed outside this application. Orders likewise allow staff to choose `payment_status = 'אשראי'` manually. Neither represents a Pelecard transaction.

The existing behavior remains available and is relabeled in the UI as external/manual credit without rewriting historical rows. Verified hosted payments use the distinct stored value `פלאקארד`. Only the server-side finalization path may create a `פלאקארד` sale or set an order to `פלאקארד`.

## Components

### Database

Migration `021_pelecard_payment_ledger.sql` adds:

#### `payment_transactions`

One row represents one provider operation or checkout attempt.

| Column | Purpose |
| --- | --- |
| `id uuid` | Internal immutable identifier. |
| `provider text` | Restricted to `pelecard`. |
| `operation text` | `payment`, `refund`, or `void`. |
| `parent_transaction_id uuid` | Original payment for refund/void operations. |
| `order_id uuid` | Optional related order. Uses `ON DELETE RESTRICT` so financial lineage is preserved. |
| `sale_id uuid` | Set only by atomic finalization; unique when present. |
| `provider_session_id text` | Hosted-page session/initialization identifier when supplied. |
| `provider_transaction_id text` | Pelecard transaction identifier, unique per provider when present. |
| `approval_id text` | Provider/acquirer approval reference; not card data. |
| `amount numeric(10,2)` | Positive operation amount in major currency units. |
| `currency text` | ISO code, initially `ILS`. |
| `status text` | Controlled payment state. |
| `idempotency_key text` | Client attempt key, unique per provider. |
| `provider_status_code text` | Sanitized provider result code. |
| `failure_code text` | Stable internal/provider error category. |
| `failure_message text` | Sanitized message without request/response bodies. |
| `checkout_snapshot jsonb` | Business-only sale/order snapshot needed for finalization. |
| `created_by uuid` | Authenticated staff member who initiated the operation. |
| `verified_at timestamptz` | Time of completed provider verification. |
| `created_at`, `updated_at` | Audit timestamps. |

`checkout_snapshot` is restricted by application construction to sale items, discount, linked-order display fields, and return context. Cardholder or provider authentication fields are forbidden.

Constraints and indexes:

- Unique `(provider, idempotency_key)`.
- Partial unique `(provider, provider_transaction_id)` where the provider ID is not null.
- Partial unique `sale_id` where it is not null.
- Foreign-key indexes for `order_id`, `sale_id`, `parent_transaction_id`, and `created_by`.
- Status, provider, amount, and operation checks.
- Refund/void rows must reference an original payment.

The transaction identity, provider, operation, amount, currency, order, parent, idempotency key, checkout snapshot, creator, and creation time cannot be changed after insert. Rows cannot be deleted. Server-side reconciliation may update only lifecycle fields such as status, provider identifiers, approval ID, failure fields, verification time, sale link, and update time.

#### `payment_transaction_events`

Append-only events preserve every accepted lifecycle transition. Each event stores the transaction ID, event type, resulting status, sanitized metadata, actor, and timestamp. Rows cannot be updated or deleted. Raw provider payloads and card fields are never accepted.

#### Existing tables

- Add `sales.payment_transaction_id uuid` with a unique partial index and foreign key to `payment_transactions`.
- Extend the `orders.payment_status` check with `פלאקארד`; existing values and rows remain unchanged.
- Keep `sales.method = 'אשראי'` and `orders.payment_status = 'אשראי'` as external/manual credit.
- Verified sales use `sales.method = 'פלאקארד'`.

#### Database enforcement

- Authenticated users may read safe ledger fields when their current role is admin, operations, or cashier.
- Authenticated users receive no direct insert, update, or delete policy on either payment table.
- Existing staff sale/order write paths may not introduce the verified `פלאקארד` value.
- A restricted `SECURITY DEFINER` finalization function is executable only by `service_role`. It locks the payment row, returns the prior result if already finalized, creates at most one sale, links it, updates the related order, and appends an event in one short database transaction.
- Provider network calls always finish before the finalization database transaction begins.

### Edge Functions

#### `pelecard-initiate`

- Requires a valid Supabase JWT and the admin, operations, or cashier role.
- Accepts an idempotency key and either a validated Cash Register checkout snapshot or an order-payment request.
- Validates monetary arithmetic and derives integer agorot server-side.
- Reuses an existing attempt for an identical duplicate key; rejects reuse with different immutable input.
- Inserts the local pending transaction before provider initialization.
- Calls Pelecard using server-side secrets and stores only the safe session identifier.
- Returns `{ paymentId, status, redirectUrl }`.

#### `pelecard-callback`

- Is publicly reachable because Pelecard does not possess a Supabase user JWT.
- Accepts only POST feedback in Pelecard's documented form/JSON shapes.
- Applies body-size and content-type limits.
- Locates the local payment using a non-secret correlation identifier.
- Performs confirmation-key validation and provider lookup.
- Calls atomic finalization only after all verification fields match.
- Returns an idempotent acknowledgement for duplicate callbacks.
- Records sanitized failure/mismatch events without logging the payload.

#### `pelecard-verify`

- Requires a valid staff JWT.
- Reconciles a pending payment after browser return or an uncertain initiation/callback result.
- Performs the same provider verification pipeline as the callback.
- Never trusts browser-supplied success fields.

#### `pelecard-status`

- Requires a valid staff JWT.
- Returns a whitelisted local projection: payment ID, order/sale IDs, amount, currency, status, failure category, receipt number, and timestamps.
- Repeated polling has no side effects.

#### `pelecard-refund`

- Requires an admin JWT.
- Defaults to disabled unless `PELECARD_REFUND_ENABLED=true` is present in Edge Function secrets.
- Creates a separate idempotent refund/void ledger operation linked to the original payment.
- Calls the confirmed Pelecard cancellation method only when enabled.
- Reconciles the provider result before marking the operation successful and transitioning the original payment.
- Does not delete or alter the original sale receipt. Any accounting correction remains separate and is not connected to Rivhit.

### Shared server modules

- `pelecard-client.ts`: hosted-page initialization, confirmation validation, provider lookup, and capability-gated cancellation. All responses are parsed into explicit allowlisted fields.
- `payment-reconciliation.ts`: verification comparisons and lifecycle decisions independent of HTTP handling.
- `payment-auth.ts`: JWT validation and role checks.
- `payment-http.ts`: CORS, JSON/form parsing, size limits, and consistent safe responses.
- `payment-types.ts`: provider/domain types and status constants.

Shared modules accept `fetch` and persistence dependencies explicitly so provider behavior can be tested without credentials or network calls.

## State Model

Payment lifecycle:

`initiated → pending_provider → succeeded`

Terminal alternatives:

- `initiated|pending_provider → failed`
- `initiated|pending_provider → timed_out`
- `succeeded → refund_pending → refunded`, only through a successful gated refund operation
- `succeeded → void_pending → voided`, only when the confirmed provider capability distinguishes void from refund

Retries and delayed callbacks may reconcile `timed_out` to `succeeded` when the provider lookup proves the original transaction succeeded. No callback can transition a verified success back to failed.

## Integrity Rules

1. A repeated initiation key returns the original payment attempt and does not create a second provider session.
2. The same provider transaction ID cannot be attached to two local payments.
3. The same local payment cannot create two sales.
4. Callback and browser-return data are notifications only.
5. Confirmation validation must pass before provider lookup results are accepted.
6. Provider transaction ID, terminal, amount, currency, merchant key, and success state must match the local attempt.
7. The sale insert, payment-sale link, order update, and final event occur atomically.
8. Network timeouts preserve an uncertain/pending state and are safe to reconcile later.
9. Failure records contain codes and sanitized summaries only.

## Logging and Data Minimization

The implementation uses explicit allowlists. It must not persist or log:

- PAN or masked PAN
- CVV
- expiry date
- national ID supplied on the payment page
- provider card token
- full provider request or response bodies
- Pelecard username, password, terminal secret, or confirmation key

Logs may contain only internal payment UUIDs, HTTP status classes, operation names, sanitized error codes, and timing information. Approval ID and provider transaction ID may be stored in the ledger but are not emitted in general-purpose logs.

## Test Strategy

### Migration tests

- Existing order and sale rows remain valid.
- Unique idempotency and provider-transaction constraints reject duplicates.
- immutable fields and event rows reject modification/deletion.
- authenticated roles can read but cannot write payment rows.
- browser-originated writes cannot claim `פלאקארד` verification.
- atomic finalization creates one sale and one order transition under repeated calls.

### Provider and reconciliation tests

- Successful verified payment.
- Provider-declared failure.
- Duplicate initiation.
- Duplicate callback.
- Forged or invalid confirmation key.
- Provider lookup transaction mismatch.
- Amount or currency mismatch.
- Timeout/network failure followed by safe reconciliation.
- Repeated browser return/status polling.
- Refund/void rejected while capability is disabled and valid transitions when enabled with a mocked provider.

Provider tests use complete documented response fixtures but pass them through the production allowlist so card-related fields never reach persistence or logs.

## Rollout and Compatibility

1. Apply the additive migration in a disposable/local Supabase database and run database contract tests.
2. Deploy Edge Functions only to a non-production Supabase project with Pelecard test credentials.
3. Configure public HTTPS server-side feedback URLs and browser return URLs.
4. Exercise success, decline, duplicate callback, timeout, and mismatch cases against Pelecard's test terminal.
5. Confirm terminal capabilities with Pelecard before enabling refunds or production traffic.
6. Apply the migration and deploy functions to production only after explicit approval, backup/rollback preparation, and an operational review.

Rollback before real payments consists of removing the new UI entry point and functions while retaining the additive ledger tables. Financial ledger rows are never destructively rolled back. No contraction or data deletion is part of this project.

## Provider Capabilities Requiring Confirmation

Pelecard must confirm that the supplied terminal/account is provisioned for:

1. IFrame/Redirect 2.0 Internet J4 transactions.
2. An EMV terminal with the required 3DS merchant enrollment and policy.
3. `ServerSideGoodFeedbackURL` / `ServerSideErrorFeedbackURL` delivery.
4. `ValidateByUniqueKey` and authoritative transaction lookup for this terminal.
5. REST cancellation/refund/void access, including whether the provider exposes one full-cancellation operation or distinct void and refund behavior, its time window, and partial-refund support.

Refund/void remains disabled until item 5 is confirmed.
