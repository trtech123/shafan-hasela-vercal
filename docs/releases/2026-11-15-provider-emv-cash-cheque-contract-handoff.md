# Pelecard physical EMV and Payper contract handoff — terminal 2

**Superseded implementation status:** The hosted route is now connected to the cashier flow on this branch. See `2026-11-15-cash-physical-activation-handoff.md` for the current migration, configuration, and acceptance procedure. The analysis and provider questions below remain useful, but its earlier “not connected” statement describes commit `673125e` only.

Baseline: `b243aac` on `integration/physical-schedule-collection-20261115` (includes production `4d509b0`). This branch is source-only. No production migration, configuration, charge, document, or deployment was performed.

## Physical decision and release boundary

The authoritative Hebrew IFrame20 manual, printed pages 5–6 and 17, defines a hosted flow: initialize `PaymentGW/init`, display the returned URL, and let the cashier press the hosted PINPAD button when `EmvPinpad=True`; `ShopNo` selects the register. Initialization alone does not charge the device. The Payper example on pages 26–27 sends `PayperParameters` with the hosted request. Pelecard support explicitly directs this route for physical invoice issuance. The direct `DebitRegularType` example in the Services REST manual contains card details and does not establish that our direct empty-card J4 supports embedded Payper for this merchant.

The branch adds a strict hosted EMV request builder, safe initialization transport, and separate payment/document response classifiers. They are deliberately not connected to `app/api/pelecard-physical.js`, the cashier screen, or a dispatch gate. The existing direct J4 worker is preserved. Its financial gate must stay OFF. The supported hosted route would not need the five-minute local worker for charge dispatch; it does need durable hosted-session storage, server-side callback handling, read-only payment recovery, and invoice evidence persistence before activation. No one-click direct terminal charge is established by the hosted manual. The cashier's supported interaction is to open the hosted page and press its PINPAD button. Do not script that click.

The existing physical order reservation locks the order and freezes balance, billing, VAT, and items. The standalone POS reservation freezes server-priced items and billing; its snapshot now records `vatApplicable: true`, matching the existing POS tax policy. The new builder requires register `004`, preserves the leading zeros, reconciles gross invoice lines to the reserved agorot, and refuses invalid identity or VAT. Physical payment approval is classified separately from Payper document success. A hosted `PayperData.InvoiceStatus` of `000` with a validated number and official URL can describe a document in the immediate hosted result. The direct `CreatePayperInvoice` example uses `Success`; that value is **not** accepted as hosted success. `RawResponse` is parsed only in memory for a numeric `document_system_id` and is never returned or logged.

Services REST printed page 16 documents `GetTransaction` for hosted payment data but its example has `TamalData`, not a guaranteed `PayperData` field. The new lookup projects financial fields and deliberately drops document data. Therefore a lost callback cannot yet automatically reconstruct Payper invoice identity. Do not call `CreatePayperInvoice` to fill that gap; it could duplicate the already-issued invoice. The existing physical ledger hold and manual verified-document RPC remain the recovery route. Email delivery also needs independent provider or mailbox evidence; invoice creation status alone proves no delivery.

To finish the hosted route, terminal 1 should integrate only after the provider confirms callback authenticity and invoice recovery semantics. Add a physical-only hosted session table/migration, one-shot initialization claim, callback verification, payment lookup with UID/register cross-check, document recording in the physical ledger, and cashier redirect/return flow. Keep the existing digital checkout accounting owner and continuous Payper worker unchanged. The physical ledger must stay `source_blocked` until the exact existing document is verified and associated with the payment, sale, and order.

## Cash readiness

Services REST printed page 13 permits `CreatePayperInvoice` with empty `trxRecordId` and `Uid` for a non-card Invoice-Receipt and requires `receipt_lines`; printed pages 32–33 define `Cash`, payment date in `dd-mm-yyyy`, amount in cents, VAT-inclusive invoice unit prices, customer identity/mail, and `send_by_mail`. The request serializer now requires the frozen ledger's `vatApplicable=true`, sends `document_no_vat=false`, and uses the server-frozen gross amount in both the invoice and Cash receipt line. The existing order SQL records the actual full outstanding balance for cashiers, blocks existing or uncertain documents, and allows a separate admin partial payment. The one-shot document reservation and uncertain-result reconciliation remain in place. This is a request-contract review, not production provider acceptance.

**One small genuine scheduled cash acceptance:** The existing read-only production inventory found no small, explicitly test-labeled scheduled taxable order. Before an approved test, designate one genuine small scheduled order and independently verify current balance, `vat_applicable=true`, billing identity/name/email, no unresolved payment, and no existing document requiring review. In the test window, use a fresh request key and collect exactly the full server-reported balance *after actual cash is received*. For a hypothetical ₪118.00 balance and one frozen activity line, the expected provider body is:

```json
{
  "terminalNumber": "<vault terminal>", "user": "<vault user>", "password": "<vault password>",
  "trxRecordId": "", "Uid": "",
  "PayperParameters": { "typeDocument": "Invoice-Receipt", "DataPayper": {
    "document_lang": "hb", "customer_unique_id": "<verified billing ID>",
    "customer_mail": "<verified billing email>", "customer_name": "<verified billing name>",
    "send_by_mail": "true", "document_subject": "<saved receipt number>",
    "document_rounded": "false", "document_no_vat": "false",
    "invoice_lines": [{ "description": "<frozen activity and order description>",
      "quantity": "1", "price_per_unit": "11800", "include_vat": "true" }],
    "receipt_lines": [{ "payment_type": "Cash", "date": "<actual dd-mm-yyyy payment date>", "amount": "11800" }]
  } }
}
```

The amount is illustrative; the approved test must use the selected order's server-calculated amount and actual date. Expected accounting: one cash payment and sale for the collected balance, one official Payper Invoice-Receipt attached to that payment and order, no second document on repeated status requests, and separate verification of email receipt. If the response is ambiguous, stop and reconcile the existing obligation. Keep cash dispatch OFF until test-specific approval.

## Cheque contract

Services REST printed page 33 spells `receipt_lines.payment_type` as `Cheque`; the provider-facing serializer now sends that exact value while the internal method stays `check`. The received date remains the payment date, and the later due date remains preserved in the frozen check record and remarks, consistent with the accountant's Invoice-Receipt upon receipt policy. The manual does not define structured fields for check number, bank, branch, account, or due date. Generic remarks are not confirmed sufficient. `PAYPER_CHECK_DETAILS_CONTRACT_CONFIRMED` is a new additional default-OFF gate; keep it false, along with the existing check dispatch gate, until the response below is obtained and tested.

## Questions for Pelecard/Payper

1. Does this merchant's direct empty-card PINPAD J4 accept `PayperParameters` and issue one Invoice-Receipt? Provide an exact sanitized request/response and any supported one-click PINPAD trigger. Until then use the hosted button path.
2. In hosted `EmvPinpad=True`, what exact server-side callback contains `PayperData`, and how should its source and integrity be authenticated? Does `ConfirmationKey` cover invoice fields?
3. Does `GetTransaction` return `PayperData` for *all* physical hosted EMV transactions? If not, which documented read-only lookup retrieves the already-issued invoice number, URL, `document_system_id`, and failure state after a lost callback?
4. Which `InvoiceStatus` values mean success for the hosted callback, `GetTransaction`, and direct REST respectively? Confirm whether `000` and `Success` differ by endpoint.
5. Is `document_system_id` available as a stable first-class response field, or only inside `RawResponse`? How can email delivery be verified independently?
6. For `Cheque`, what documented receipt-line keys carry check number, bank, branch, account, and due date? Is the payment `date` the receipt date for a postdated check, and are remarks acceptable only as supplemental text?

## Proposed physical controlled test after integration and approval

1. Keep direct worker dispatch OFF; enable only the new hosted gates for enabled register `004` in the approved window. Confirm other registers disabled.
2. Select one designated small taxable scheduled order and one standalone POS cart. Verify billing, VAT, amounts, absence of existing documents, and order locks before either attempt.
3. Reserve one intent, initialize one hosted session, display its Pelecard URL, and have the cashier press the provider's PINPAD button. Perform one genuine card-present payment only with transaction-specific approval.
4. Verify the provider transaction ID, UID, register `004`, agorot, currency, approval, sale, and remaining order balance. Independently verify one official Invoice-Receipt number, URL, system ID if supplied, and email delivery.
5. Replay the callback and status lookup without any second charge or document. Rehearse a synthetic lost callback separately in isolated tests; on a live missing document, use read-only retrieval or manual verified-document reconciliation, never a new charge or `CreatePayperInvoice`.

No live step in this document is authorization to execute it now.
