# Optional order details and POS customer selection — isolated candidate

## Customer selection versus invoice billing

- Standalone POS does not require a customer card or linked order. The order search in the cart is optional; leaving it empty proceeds directly to payment. Selecting an order retains the existing order collection route.
- The hosted Pelecard POS route captures `kind`, billing `name`, nine-digit identity/company number, and `email` in the cashier billing dialog. These are invoice facts associated with a payment intent, **not** a customer registration. The current server validates them before reserving or initiating a charge. Staff can enter them for a walk-in customer without creating a customer record.
- The integration does not use data entered on Pelecard's hosted page to populate Payper billing. It persists the reviewed billing fields before redirecting. The hosted form's own fields must not be assumed to return to Payper.
- Cash, check, hosted physical, and Direct J4 still use their existing billing dialogs and financial gates. This branch changes their explanation only where it clarifies that a customer card is unnecessary for standalone physical payment.

## Order creation

- Staff can save an order with a name, phone, email, any subset, or none. Missing values are `NULL`, not a fabricated identity. Editing the order later adds real values. Existing scheduling and quotation linkage remain available. Payment and customer delivery retain their separate eligibility requirements.
- Order lists and schedule show `פרטי לקוח חסרים` when both customer name and organization are absent. The label is display-only.
- Migration `202611170003_optional_order_customer_details.sql` drops `NOT NULL` from `orders.client_name` and `orders.client_phone`. `client_email` and `orders.customer_id` were already nullable. No historical rows are rewritten and order RLS remains unchanged.
- In a controlled release, apply the migration **before** deploying the order form. No production migration has been applied in this branch.

## Hosted POS document path and safeguards

- `reserve_pos_pelecard` stores a payment with `order_id=NULL`, `linked_order_info=NULL`, and a separate Payper billing snapshot with `order_id=NULL`. Approval finalizes a sale. The Payper source freezes from that sale and payment billing snapshot with `sourceType='sale'`, without consulting a customer record.
- The current reservation, provider dispatch claim, request key, status recovery, and Payper ledger protect against duplicate charges and documents. This branch does not change those mechanisms or enable any disabled payment gate.
- If any required billing field is unavailable, the current cashier dialog asks for that field before payment. The required fields come from the current **application/provider serialization and accounting gates**; this branch makes no new claim that every field is legally mandatory.
- Issued Payper document links can already be opened and printed from the receipt and accounting screens. Email remains required by the current hosted POS validation and source-freezing gate, regardless of whether the Payper worker's optional mail flag is enabled.

## Scope boundary and remaining question

This candidate fulfills **optional customer selection**, not anonymous invoicing. A walk-in customer can pay without a customer card when the required invoice billing details are supplied directly in the payment dialog. If Nurit later needs a purchase with missing identity or email, obtain merchant-specific Pelecard/Payper and accountant confirmation before changing validation or document issuance. In particular, do not rely on hosted Pelecard to supply those fields back to Payper without a verified integration contract.

## Integration review, 18 November 2026

- GitHub `main` at `557f8eb6b59fdff7a7786e1bf6baeebff2ffbd7b` contains the manual Vercel deployment-control change but is otherwise older than the verified cashier/physical source `3d86ba1`. Its four-file change was cherry-picked into this isolated branch as `083fc46`; `app/vercel.json` now has `git.deploymentEnabled=false` while retaining the POS, hosted EMV, Direct J4 queue/worker limits, and cron entries. Do not replace this source with the older `main` tree.
- The Vercel production alias resolved read-only to manual deployment `dpl_EQGkGavPKAePUEw2GuHTQBmJCyaK` (READY). It has no source commit metadata. Raw SHA-1 hashes for deployed `CashRegister.jsx` and `server/pelecard-physical/workflow.js` matched the corresponding files in this branch. This is a targeted code parity check, not a claim that the entire deployed tree or database matches.
- Full local PostgreSQL rehearsal applied all 102 committed migrations to a disposable PGlite database and passed guest-order insert/update, existing order payment, POS/document, physical and Direct J4 checks. The current production schema itself has **not** been queried from this worktree. Run `scripts/orders/optional-customer-production-preflight.sql` through an authorized read-only production database session and compare its columns, constraints, triggers and RPCs with the committed schema before approval.
- Migration `202611170003` is transactional, idempotent, changes only two nullable flags, and has a three-second lock timeout. There is no data rewrite or financial gate change. PostgreSQL's `ALTER TABLE` still takes a table lock; schedule it during low traffic and retry only after checking blockers. A failure rolls the transaction back.
- Safe rollout sequence: (1) verify current production source and schema, backup and inspect preflight output; (2) run the migration by the production release coordinator; (3) verify both columns nullable, existing order counts/financial ledger counts unchanged and guard/RLS functions present; (4) manually deploy a clean, pushed integrated source using the Vercel deployment-control process; (5) smoke order creation/editing and no-customer-card POS navigation with synthetic data before approving any live acceptance transaction.
- If application rollback is required, restore the previous application build first; nullable columns are backward compatible with old code. Do **not** automatically restore `NOT NULL`: once real incomplete orders exist, `SET NOT NULL` fails or requires collecting their true details. Decide that data migration separately. Existing orders and receipts are untouched by the forward migration.
- Orders saved without a customer snapshot remain subject to existing order payment, accounting and delivery readiness gates. The standalone POS path remains independent of a customer card and still captures invoice facts before provider dispatch.
