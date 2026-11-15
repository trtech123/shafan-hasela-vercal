# Schedule collection and non-card Payper release

Branch: `feature/payper-check-payments`. Base production source: `01a416175c17b027660c1f77d8e4ddcf3fafed46`.

## Scope

- Schedule `גבייה בקופה` carries the existing order UUID to POS. The POS reads the saved order, original total, verified payments, outstanding balance, customer billing, activity, and quote reference. It does not create an order.
- Cashiers and admins collect the full server-calculated outstanding balance. Historical partial payments reduce that balance; this release adds no new partial collection. Check and cash collection create one sale, one payment transaction, one Payper ledger obligation, and one accounting event in a database transaction. A received check is marked `received_uncleared`.
- Standalone check and cash sales use the same non-card Payper dispatch path. The existing internal `RCP-*` confirmation is labeled internal; only a provider-confirmed number and URL are shown as an official document.
- Accountant-confirmed policy: issue an Invoice-Receipt for a genuinely received check, including a postdated check, or cash payment. Issue one for an approved card payment. Never issue for an unpaid order or quotation. The normal new-sale flow has no document selector.
- The non-card Payper request uses empty card transaction identifiers, a `Check` or `Cash` receipt line, billing details, VAT-inclusive invoice lines, and email delivery. Check fields are frozen privately; the provider's generic `document_remarks` carries them into the request. Existing order documents or uncertain requests hold a new obligation for reconciliation instead of sending a duplicate tax invoice.
- Dispatch is one shot. Cash and check use separate default-off gates, `PAYPER_CASH_DISPATCH_ENABLED` and `PAYPER_CHECK_DISPATCH_ENABLED`. Uncertain outcomes require reconciliation; a repeated request key never sends a second creation request. The existing digital Pelecard and continuous Payper selectors remain unchanged.
- Order collection with absent or non-taxable VAT data records the received payment and holds the official document for VAT review. It never silently sends a taxable Invoice-Receipt.
- Admin Accounting reads issued non-card documents from the existing Payper ledger.

## Final local verification

- `npm run test:full-schema` passed with all 67 application migrations. Adding the physical release migration as an optional input also passed in filename order, including physical reservation after a historical cash partial payment. All 985 public constraints validated.
- `npm run test:migration` passed with a mocked Payper success, issued document number and URL, email request, idempotency, and existing-document hold.
- `npm test -- --maxWorkers=4 --reporter=dot` passed: 131 files, 1,063 tests. `deno check` passed for the non-card Edge function and request builder. `npm run build` and focused lint passed.

## Release sequence requiring approval

1. Integrate this branch with the current production and physical-terminal branches. Apply the shared migrations in order: `202611150001_payper_check_payments.sql`, physical release branch `202611150002_physical_order_collection.sql` (commit `58299f27da92b73589b551042f406330d068bbf2`), then `202611150003_physical_order_collection_compat.sql`. The compatibility migration accepts only the physical order snapshot tied to the same order and amount; hosted checkout remains blocked after a non-card partial payment. Reconcile newer production commits before release.
2. Confirm with Pelecard/Payper whether generic `document_remarks` is sufficient for all mandatory check fields. Existing-invoice treatment remains held for accountant reconciliation; no undocumented reference ID is sent.
3. All 67 application migrations plus the terminal order migration replay in filename order on isolated PGlite PostgreSQL with Supabase auth/storage bootstrap objects. Rehearsal verifies 66 public tables, 985 validated constraints, 125 RLS policies, 120 triggers, 249 functions, cash order collection, permissions, duplicate prevention, a blocked hosted retry, and physical collection of the remaining balance after a partial cash payment. This is a full application migration replay, but it is not a clone of the current production database: no staging connection or production schema dump was available. Compare the actual production migration history and catalog before deployment.
4. With explicit approval, apply coordinated migrations, deploy `payper-noncard-collection`, and deploy the app. Leave both non-card dispatch flags false until approved provider tests. Cash can be activated independently of check because its request contains only the documented `Cash` receipt line and no check remarks. Do not activate cash until the provider accepts that exact invoice-receipt request and returns a usable number and URL in an approved test. Do not change existing digital payment credentials or continuous Payper settings.
5. Manually reconcile legacy sale `RCP-1039` before any document issuance. The read-only production check found a saved ₪1 check sale with its entered check fields and no Payper ledger entry. This branch does not mutate or issue against it.

## Current limits

- The hosted digital order checkout still charges the original order total. It remains available for an unpaid order and is blocked after a historical partial collection so it cannot overcharge. Full outstanding balance after historical partial payment can be collected by check or cash here.
- Bank transfer, Bit/PayBox, external credit, and split payment documents await verified provider and accounting rules.
- Payper's public response documents the document number and URL but not a provider document ID. Existing invoices or uncertain accounting requests are held for reconciliation. No receipt linking ID is invented.
- Check issuance remains blocked pending provider confirmation of the mandatory check-detail representation. Cash has an independent dispatch flag but still requires an approved live provider acceptance test. An actual production-equivalent staging clone and catalog comparison remain release gates.

## Shared order payment contract for physical-terminal integration

- Use the existing `orders.id` as the financial source. Never create a second order from a schedule collection.
- Lock that order row before reserving or recording a payment. Under the lock, sum succeeded payment transactions (net of verified refunds) plus legacy check/cash sales with no payment transaction. Subtract from `orders.total_price`, which preserves the saved quotation, discounts, and VAT-inclusive price.
- Collect the exact positive outstanding balance for the daily workflow. Reject a stale browser amount, unresolved digital attempt, archived/canceled order, or a legacy payment linked only by order number until reconciled.
- One provider attempt or received-payment request key owns one payment transaction; finalization creates one sale and one accounting obligation. A successful full-balance collection changes the order payment status. Publish the order-change event so schedule, POS, and orders views refresh.
- The physical release worktree `release/physical-terminal-prep-20261112` at `58299f27da92b73589b551042f406330d068bbf2` adds order-linked reserve/finalize and depends on the non-card migration. The combined rehearsal proved its snapshot initially violated the shared checkout constraint. `202611150003` resolves that specific conflict and permits terminal reservation after a historical non-card partial collection, while the existing hosted digital flow remains protected. Terminal worker and credentials stay in its branch.
