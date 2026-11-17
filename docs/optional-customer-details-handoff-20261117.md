# Optional customer details — isolated candidate

## Proposed experience

- Staff can save an order with a name, phone, email, any subset, or none. Missing values are `NULL`, not a fabricated customer. Editing the order later adds the actual values. Scheduling, quotation linkage, and existing order payment routes remain available subject to their own gates.
- Order lists and schedule show `פרטי לקוח חסרים` as a display label when both customer name and organization are absent. This label is never persisted as customer data.
- The standalone POS billing step offers `אין ללקוח פרטים מלאים כרגע`. It explains the current invoice constraint before any payment request. Partial entries remain editable in the open payment screen. The current verified billing path remains the default.

## Database and rollout

- Migration `202611170003_optional_order_customer_details.sql` drops `NOT NULL` from `orders.client_name` and `orders.client_phone`. `client_email` and `orders.customer_id` were already nullable. No historical rows are rewritten. Existing order RLS is unchanged.
- Apply the migration in a controlled release **before** deploying the order form. Do not deploy this UI first, because inserting `NULL` would fail on the old schema. No production migration has been applied by this branch.
- Quote creation retains its own customer requirements. Converting a quotation still copies its real customer fields into the order. Order confirmation delivery and WhatsApp remain gated on their required destination data.

## Financial boundary

- Cash and check `payper-noncard-collection` currently validate name, nine-digit identity/company number, and email, then send `customer_name`, `customer_unique_id`, `customer_mail`, `send_by_mail=true` to CreatePayperInvoice. Order cash collection additionally requires a reviewed customer snapshot and valid billing. Hosted POS, order digital, and physical terminal reservations also require verified billing before dispatch. This candidate does not loosen those gates.
- Consequently, a truly anonymous standalone POS purchase is **not activated by this branch**. Staff see why before starting payment. No customer field is synthesized and no invoice is silently skipped.
- Existing payment idempotency keys, Payper document ledgers, provider holds, and reconciliation requirements remain unchanged. A missing or interrupted provider response must be reconciled using the existing intent; staff must not start another charge or document issuance.
- Issued Payper links can already be opened and printed from the receipt and accounting screens. That is the intended delivery route when email-free issuance is confirmed.

## Required provider and accounting confirmation

Ask Pelecard/Payper for the **merchant's actual configuration and each operation** (standalone cash/check CreatePayperInvoice; hosted digital; CT20 direct J4):

1. Can `Invoice-Receipt` be issued with no customer email and `send_by_mail` omitted or false? Is `customer_mail` omitted or empty? What response fields carry a stable invoice link for printing?
2. Can it be issued for an unidentified walk-in customer with no name and no identity/company number? Which exact fields may be omitted or empty, and is a merchant-configured generic customer supported without fabricating an identity?
3. Do requirements differ for person versus organization, cash versus card, or amount? What customer particulars are legally required on the tax document for this merchant? Confirm with the accountant as well.
4. For CT20 J4 using `ShopNumber` and empty card fields, do `PayperParameters` create the same automatic Invoice-Receipt for this merchant, and does the first response contain the number/link? Confirm read-only lookup for interrupted first responses.

After written confirmation, implement a separate tested payment change across UI validation, server reservation, provider serialization, document retrieval, and reconciliation. Keep the existing financial gates until that change passes controlled acceptance. No live payment is part of this candidate.
