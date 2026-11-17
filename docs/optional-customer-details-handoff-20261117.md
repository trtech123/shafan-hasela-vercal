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
