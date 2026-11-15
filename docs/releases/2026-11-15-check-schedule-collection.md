# Schedule collection and non-card Payper release

Branch: `feature/payper-check-payments`. Base production source: `01a416175c17b027660c1f77d8e4ddcf3fafed46`.

## Scope

- Schedule `גבייה בקופה` carries the existing order UUID to POS. The POS reads the saved order, original total, verified payments, outstanding balance, customer billing, activity, and quote reference. It does not create an order.
- A cashier can collect the full balance; an admin can collect an authorized partial amount. Check and cash collection create one sale, one payment transaction, one Payper ledger obligation, and one accounting event in a database transaction. The order status becomes `שולם חלקית` or the final payment method. A received check is marked `received_uncleared`.
- Standalone check sales use the same non-card Payper dispatch path. The existing internal `RCP-*` confirmation is labeled internal; only a provider-confirmed number and URL are shown as an official document.
- The non-card Payper request uses empty card transaction identifiers, a `Check` or `Cash` receipt line, billing details, VAT-inclusive invoice lines, email delivery, and the selected `invoice-receipt` or `receipt` document type. Check fields are frozen privately; the provider's generic `document_remarks` carries them into the request.
- Dispatch is one shot, gated by `PAYPER_CHECK_DISPATCH_ENABLED=true`, and uses the existing Payper ledger outcome fences. Uncertain outcomes require reconciliation; a repeated request key never sends a second creation request. The existing digital Pelecard and continuous Payper selectors remain unchanged.
- Admin Accounting reads issued non-card documents from the existing Payper ledger.

## Release sequence requiring approval

1. Integrate this branch with the current production and physical-terminal branches; inspect migration ordering and resolve any overlapping schema changes. The branch was based on the exact active production source, so newer production commits must be incorporated before release. The non-card migration relaxes the shared Payper ledger's nullable order ID and card transaction record constraint only for non-card sources; coordinate these changes with physical-terminal migrations.
2. Obtain accountant approval for document choice and timing for received and postdated checks, partial collections, and payments following an existing tax invoice. Confirm with Pelecard/Payper whether generic `document_remarks` is sufficient for all mandatory check fields and how `reference_document_id` is obtained for an existing invoice.
3. Run the migration in an isolated staging database with fixtures and mocked Payper responses; verify rollback and policies. No production migration has been applied by this workstream.
4. With explicit approval, apply `202611150001_payper_check_payments.sql`, deploy `payper-noncard-collection`, and deploy the app. Verify the separate non-card dispatch flag is absent/false first, then perform an approved provider test and activate that flag only after reconciliation checks. Do not change existing digital payment credentials or continuous Payper settings.
5. Manually reconcile legacy sale `RCP-1039` before any document issuance. The read-only production check found a saved ₪1 check sale with its entered check fields and no Payper ledger entry. This branch does not mutate or issue against it.

## Current limits

- The hosted digital order checkout still charges the original order total. This release blocks a new hosted attempt after non-card partial collection to prevent overcharge; mixed partial followed by digital needs a separately reviewed balance-aware hosted change.
- Standalone cash and other recorded methods retain their existing internal-only confirmation path. Cash is covered for schedule order collection. Bank transfer, Bit/PayBox, external credit, and split payment documents await verified provider and accounting rules.
- Payper's public response documents the document number and URL but not a provider document ID. Linking a receipt to an earlier Payper invoice via `reference_document_id` is supported when the previously issued ID is known and validated in the accounting records; automatic discovery requires provider confirmation.
- Production readiness is blocked until the accountant/provider confirmations and staging migration/contract verification above are complete.
