# Schedule collection and non-card Payper release

Branch: `feature/payper-check-payments`. Base production source: `01a416175c17b027660c1f77d8e4ddcf3fafed46`.

## Scope

- Schedule `גבייה בקופה` carries the existing order UUID to POS. The POS reads the saved order, original total, verified payments, outstanding balance, customer billing, activity, and quote reference. It does not create an order.
- Cashiers and admins collect the full server-calculated outstanding balance. Historical partial payments reduce that balance; this release adds no new partial collection. Check and cash collection create one sale, one payment transaction, one Payper ledger obligation, and one accounting event in a database transaction. A received check is marked `received_uncleared`.
- Standalone check and cash sales use the same non-card Payper dispatch path. The existing internal `RCP-*` confirmation is labeled internal; only a provider-confirmed number and URL are shown as an official document.
- Accountant-confirmed policy: issue an Invoice-Receipt for a genuinely received check, including a postdated check, or cash payment. Issue one for an approved card payment. Never issue for an unpaid order or quotation. The normal new-sale flow has no document selector.
- The non-card Payper request uses empty card transaction identifiers, a `Check` or `Cash` receipt line, billing details, VAT-inclusive invoice lines, and email delivery. Check fields are frozen privately; the provider's generic `document_remarks` carries them into the request. Existing order documents or uncertain requests hold a new obligation for reconciliation instead of sending a duplicate tax invoice.
- Dispatch is one shot, gated by `PAYPER_CHECK_DISPATCH_ENABLED=true`, and uses the existing Payper ledger outcome fences. Uncertain outcomes require reconciliation; a repeated request key never sends a second creation request. The existing digital Pelecard and continuous Payper selectors remain unchanged.
- Admin Accounting reads issued non-card documents from the existing Payper ledger.

## Release sequence requiring approval

1. Integrate this branch with the current production and physical-terminal branches; inspect migration ordering and resolve any overlapping schema changes. The branch was based on the exact active production source, so newer production commits must be incorporated before release. The non-card migration relaxes the shared Payper ledger's nullable order ID and card transaction record constraint only for non-card sources; coordinate these changes with physical-terminal migrations.
2. Confirm with Pelecard/Payper whether generic `document_remarks` is sufficient for all mandatory check fields. Existing-invoice treatment remains held for accountant reconciliation; no undocumented reference ID is sent.
3. The migration passes an isolated PGlite PostgreSQL rehearsal with fixtures and a mocked Payper success, including permissions, historical balance, duplicate request, and existing-document hold. Run an additional staging rehearsal against the complete production schema before deployment. No production migration has been applied by this workstream.
4. With explicit approval, apply `202611150001_payper_check_payments.sql`, deploy `payper-noncard-collection`, and deploy the app. Verify the separate non-card dispatch flag is absent/false first, then perform an approved provider test and activate that flag only after reconciliation checks. Do not change existing digital payment credentials or continuous Payper settings.
5. Manually reconcile legacy sale `RCP-1039` before any document issuance. The read-only production check found a saved ₪1 check sale with its entered check fields and no Payper ledger entry. This branch does not mutate or issue against it.

## Current limits

- The hosted digital order checkout still charges the original order total. It remains available for an unpaid order and is blocked after a historical partial collection so it cannot overcharge. Full outstanding balance after historical partial payment can be collected by check or cash here.
- Bank transfer, Bit/PayBox, external credit, and split payment documents await verified provider and accounting rules.
- Payper's public response documents the document number and URL but not a provider document ID. Existing invoices or uncertain accounting requests are held for reconciliation. No receipt linking ID is invented.
- Production readiness is blocked until provider confirmation of check-detail representation, a full-schema staging rehearsal, and coordinated integration are complete.

## Shared order payment contract for physical-terminal integration

- Use the existing `orders.id` as the financial source. Never create a second order from a schedule collection.
- Lock that order row before reserving or recording a payment. Under the lock, sum succeeded payment transactions (net of verified refunds) plus legacy check/cash sales with no payment transaction. Subtract from `orders.total_price`, which preserves the saved quotation, discounts, and VAT-inclusive price.
- Collect the exact positive outstanding balance for the daily workflow. Reject a stale browser amount, unresolved digital attempt, archived/canceled order, or a legacy payment linked only by order number until reconciled.
- One provider attempt or received-payment request key owns one payment transaction; finalization creates one sale and one accounting obligation. A successful full-balance collection changes the order payment status. Publish the order-change event so schedule, POS, and orders views refresh.
- The physical-terminal worktree `feature/pelecard-physical-cloud-terminal` currently handles standalone terminal intents. Integrating order-linked terminal collection must use this balance fence and must coordinate the shared Payper ledger's nullable `order_id`, document reservation constraint, and multi-document order index with this branch's migration. Terminal-specific worker and credentials remain in that worktree.
