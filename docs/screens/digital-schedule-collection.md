# Schedule collection action map and acceptance gate

## Active screen actions

- Schedule opens the saved order at `/cashregister?orderId=<order UUID>` through **גבייה בקופה**.
- Order collection reads `get_payper_order_collection` and shows the saved total, paid amount, balance, prior payments and documents. The digital Pelecard link remains available when cash, check and physical gates are off, but is withheld after a partial collection.
- Digital order payment reads `get_pelecard_order_payment_ui`, billing defaults and `digital_order_payment_issues`. It offers billing kind, name, identity and email fields, then an initialize action only when the source is eligible. Missing VAT or invoice source data deep links to the same order's billing dialog. Staff can search for an existing customer or create/edit a card, select explicit VAT, and link it without recreating the order. That link saves a versioned customer snapshot on the order and offers a return link to eligibility.
- Initialize sends an expected amount and previous attempt ID. The server checks eligibility before dispatch; the SQL reservation repeats the check under the order lock, computes the amount from `orders.total_price`, and writes the immutable Payper billing snapshot with the payment. The checkout snapshot contains a real activity description and the same amount.
- Return, refresh and browser Back use the existing status and verified recovery actions. A return alone cannot mark an order paid. After an authoritative approval, existing finalization creates the sale and payment link, and continuous Payper creates one Invoice-Receipt obligation from the frozen source.
- Cashier and administrator can collect. Other roles cannot read or initialize this payment API.

## Acceptance conditions

1. The selected saved order has a genuine scheduled activity, a linked customer snapshot, explicit VAT, valid billing identity and email, no previous financial collection, and no conflicting accounting document.
2. The server amount matches the current saved order. A stale browser amount, direct API call with missing billing/VAT, repeated attempt or partial prior payment fails before provider initialization.
3. A mocked approved Pelecard lookup finalizes exactly one payment and one sale. Refresh and Back create none. The order is paid, and exactly one Payper Invoice-Receipt obligation refers to that payment and its frozen snapshot.
4. Receipt `RCP-...` remains an internal sale confirmation. Its screen and print show שפן הסלע; the Payper document remains the official accounting document.

## Controlled live test proposal

Read-only production inspection on 15 November found no customer card named “דניאל בדיקה”; its six named legacy orders have no linked customer snapshot or determined VAT. The best future-dated small candidate is **ORD-1057**, UUID `98f1cdaa-e176-42ab-8a4e-598a761aef90`, **ארוחת בורגרים**, **16 November 2026**, **₪98.00** unpaid. It has no payment, sale, Payper ledger row, or order accounting document. Its saved client name is misspelled “דניאל בדיהק”. It is **not currently eligible**.

Before using this candidate, identify or create the authorized Daniel test customer card with real test billing name, verified identification number, delivery email, and explicitly determined VAT treatment. Correct the order's client name; link or refresh that customer through the existing order/customer workflow so the order and immutable customer snapshot carry the same VAT and billing facts. Recheck activity, total, balance, prior payments, and accounting documents. Do not fill fields by guessing. If the activity is unsuitable for a genuine controlled test, create a new small scheduled order under that same validated test customer instead.

Once the order is eligible and this candidate is separately approved for a specific transaction: Schedule → **ORD-1057** → **גבייה בקופה** → **תשלום דיגיטלי בפלאקארד** → review **₪98.00** and frozen billing → hosted payment → authoritative approval → exactly one payment and one sale → paid order → exactly one official Payper **Invoice-Receipt** obligation for **₪98.00**, using the verified customer and explicit VAT treatment. Refresh and browser Back must not duplicate either record. The internal `RCP-...` sale confirmation is separate from the official Payper document. This document does not authorize a charge or invoice.
