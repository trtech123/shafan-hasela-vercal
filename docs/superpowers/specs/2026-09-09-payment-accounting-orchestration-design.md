# Pelecard Payment Accounting Orchestration Design

**Date:** 2026-09-09  
**Base:** release candidate `0a36f0a5f6331088570012facd7860a9807a66e8`

## Outcome

Every future, locally verified Pelecard payment success creates exactly one durable accounting event. A server worker claims that event, reloads the trusted local payment and related order, resolves the semantic Rivhit mapping `payment_success`, and invokes the existing `runRivhitAccounting()` workflow. Rivhit failure never changes the payment, sale, or order success state.

## Chosen approach

Use an additive database outbox plus a best-effort first-attempt wake-up from the verified payment handler and an authenticated operations retry endpoint. This keeps the financial state transition atomic, gives retries a durable source, and reuses the existing Rivhit customer/document ledger and attempt fencing.

Rejected alternatives:

- Calling Rivhit inside `finalize_pelecard_payment`: database transactions must not contain an external HTTP dependency, and accounting failure must not roll back payment success.
- Creating a Rivhit document directly from callback/return data: those inputs are untrusted notifications, not financial truth.
- A manual-only Rivhit button: it does not satisfy durable orchestration or automatic first-attempt processing.

## Data model

Migration `027_payment_accounting_orchestration.sql` creates `accounting_events` with generic source identity, accounting provider, semantic purpose, lifecycle status, retry time, explicit lease token/expiry, attempt count, sanitized error, and timestamps. A uniqueness constraint over source type/source id/purpose/provider guarantees one event per financial purpose.

An `AFTER INSERT OR UPDATE OF status` trigger on `payment_transactions` inserts `payment_success` only when a Pelecard payment has durably entered `succeeded` with `verified_at`, provider transaction id, and sale id. Existing rows are not backfilled. The trigger contains no callback data and no provider call.

Service-role RPCs atomically claim events with `FOR UPDATE SKIP LOCKED`, fence completion/failure by attempt count and lease token, and permit retry only for retryable/configuration states. Admin and operations users receive read-only RLS access; browser writes remain forbidden.

## Processing flow

1. Pelecard verification validates the notification, performs the authoritative provider lookup, and calls the existing atomic finalizer.
2. The finalizer commits payment, sale, order state, payment audit event, and accounting outbox event in one local transaction.
3. The payment handler calls an optional post-success hook with only the local payment UUID. Hook errors are swallowed after durable accounting state is updated; the payment response remains successful.
4. The accounting processor claims the outbox event and reloads the payment. It refuses any row that is not a verified, succeeded Pelecard payment.
5. The processor requires an associated order for billing/customer identity. An unlinked POS payment moves to `reconciliation_required`; it is never silently mapped to a made-up customer.
6. The mapper uses the immutable payment amount and checkout items, the order billing/contact identity, semantic key `payment_success`, and payment UUID as the Rivhit source identity. Multiple payments for one order therefore cannot collapse into one document.
7. The existing Rivhit repository, connector, and `runRivhitAccounting()` own customer/document idempotency and reconciliation.
8. The outbox mirrors succeeded, retryable, permanent, or reconciliation-required outcome without mutating payment state.

If `RIVHIT_DOCUMENT_TYPE_MAP.payment_success` or other Rivhit activation configuration is absent, the event becomes `configuration_required` before any Rivhit call. No numeric document type is embedded in source code or SQL.

## Operator UI

The admin/operations page `/accounting-operations` reads a protected operations view. It shows payment/order identity, amount, verified time, orchestration and Rivhit document states, document number/link, attempts, last error, next retry, and reconciliation state. Retry invokes the worker with the event ID; the backend performs authorization and claim eligibility checks. There is no payment-status mutation in this page.

## Error and retry policy

- Retryable Rivhit failures use bounded exponential backoff and remain manually retryable through the server boundary.
- Permanent failures are visible but not retryable.
- An ambiguous external success or local persistence ambiguity becomes `reconciliation_required` and is never automatically retried.
- A missing semantic mapping becomes `configuration_required` and can be retried after configuration is supplied.
- Duplicate callbacks, duplicate wake-ups, duplicate worker calls, and stale workers cannot duplicate an accounting event or Rivhit document.

## Deployment boundary

Code, migration, tests, and preview UI can be completed locally. Production activation still requires the client/accountant to provide the exact `payment_success` mapping and deployment scheduler configuration for unattended retries. No production document is created during implementation or verification.

## Non-goals

- No iCredit recurring-charge to Rivhit orchestration.
- No historical financial backfill.
- No modification to the Order Confirmation PDF or its email/WhatsApp flow.
- No real charge, refund, void, customer message, or Production Rivhit call.

