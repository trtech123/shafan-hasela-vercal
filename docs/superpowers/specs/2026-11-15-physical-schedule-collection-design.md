# Physical terminal collection for scheduled orders

## Scope and ownership

The physical branch owns J4 credentials, device assignment, reservation, one-shot dispatch, EMV verification, recovery, and physical payment finalization. `feature/payper-check-payments` owns the Schedule → `גבייה בקופה` route, the order collection screen, shared balance presentation, and check/cash accounting. The branches meet at an order-linked physical payment request and a read-only order status response. No digital Pelecard or continuous Payper code or configuration changes.

## Collection contract

The schedule screen supplies only an existing order UUID. The physical screen receives that UUID and a requested amount in minor units; the client never supplies catalog prices, a replacement order, or an authoritative balance. The physical API uses a distinct `prepareOrder` action. The database locks the existing order, rejects archived or cancelled orders and unresolved payment attempts, recomputes the balance from succeeded payments, refunds, and legacy check/cash sales, then reserves an amount greater than zero and no larger than the balance. The first release permits an administrator to choose a partial amount and a cashier to collect the full balance, matching the order collection branch's current authorization contract. Both roles can complete a full payment.

The reservation writes `payment_transactions.order_id` and freezes the order ID, order number, client and organization, original total, paid amount, balance before collection, collected amount, billing identity, applicable VAT, and the order's existing discount facts. Its J4 amount comes from the locked, validated reservation. Reusing a request key must return the same intent or reject a changed order or amount. A different unresolved payment blocks a second reservation on the order. Register `004` remains the only enabled device.

## Verified finalization

The worker retains the existing claim-before-send behavior and performs no second J4 send after an uncertain result. A matching EMV approval finalizes exactly one payment and one linked sale in a database transaction. The sale and the physical Payper hold both carry the order ID. The order's `payment_status` becomes `שולם חלקית` when a balance remains and `פלאקארד` when the balance reaches zero. The paid and remaining amounts are derived from the ledger on each status read; no mutable order total is overwritten. Repeated finalization returns the existing payment and sale. The browser can recover by request key after closure and refresh the order collection status, schedule, and accounting views.

## Accounting documents

Physical Payper issuance remains blocked. The hold carries payment, sale, and order IDs. An accountant-approved provider document can be reconciled only after verifying the matching transaction, amount, document number, URL, and no previous document for that payment. The physical branch does not call `CreatePayperInvoice`. Pelecard's public Payper guide describes automatic creation for iframe/redirect and payment-link flows, plus a separate CreatePayperInvoice API; it does not establish J4 CT20 behavior. Provider confirmation of card-present behavior and a read-only document retrieval method remains required before automatic handling or a genuine charge.

## Release sequence and tests

Add the physical order contract in a new migration numbered after the second branch's `202611150001_payper_check_payments.sql`; do not apply it to production without separate approval. Keep the physical Vercel and worker dispatch gates off. Test standalone and order-linked reservations, full/partial balances, changed-balance rejection, idempotent finalization, uncertain outcomes, browser recovery, digital regression, and production build with mocked provider responses. Push only the dedicated physical branch. Integrate after the second branch commits its contract, with a review of both migrations and shared UI wiring before deployment.

Rollback before dispatch is to disable the physical browser/API gates and leave any additive schema in place. After a real dispatch, preserve intent and payment rows for reconciliation; never delete or replay them as rollback.
