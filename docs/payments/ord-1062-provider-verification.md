# ORD-1062 provider verification — read only, not performed

This checklist is for the existing ILS 1.00 attempt only. Do not run
`DebitRegularType`, `CreatePayperInvoice`, a refund, a reversal, or a retry.
Keep the CT20 004 lock until the acquirer outcome and document history are
confirmed. Store responses in the restricted audit ticket; redact credentials,
PAN, track data, and signed document tokens before sharing them.

## Pelecard

Use the merchant's authorized **read-only** Services API credentials for
merchant terminal `2814926015`. The exact lookup implemented by this project
is a POST to `https://gateway21.pelecard.biz/services/GetTransDetailsEMV`,
with `Content-Type: application/x-www-form-urlencoded; charset=UTF-8` and a
raw JSON body:

```json
{
  "terminalNumber": "2814926015",
  "user": "<authorized merchant API user>",
  "password": "<authorized merchant API password>",
  "debitTrxId": "",
  "Uid": "26111814405328149265672",
  "UserKey": "",
  "AuthNo": "",
  "token": ""
}
```

The operation is a details lookup, not a financial send. Never paste live
credentials into a ticket, shell history, or chat. If the portal is used
instead, search by UID `26111814405328149265672`, transaction
`3199515577`, or authorization `0031683` on 18 November 2026 and export the
merchant's transaction detail and settlement/reversal history.

Require a single matching approved debit: transaction `3199515577`, UID
`26111814405328149265672`, approval `0031683`, 100 agorot, currency ILS
(`1` in the Services API), merchant terminal `2814926015`, CT20 register
`004` (`termNo`), and the expected transaction time. Capture `StatusCode`,
`ShvaResult`, `ShvaResultEmv` and the current provider lifecycle status.
Query the merchant portal or settlement report **separately** for capture or
settlement eligibility, batch inclusion, voids, cancellations, reversals,
refunds and duplicate debits around the same time, amount, terminal, UID,
authorization and order reference. `GetTransDetailsEMV` alone may not expose
all of those lifecycle facts. If any field is absent, record it as unverified,
not as a match. A zero-row full-UUID `CheckGoodParamXEMV` lookup is expected
for this legacy attempt and does not negate the recorded J4 response.

## Payper

In the authorized merchant account, open official Invoice-Receipt number
`200006`, system ID `3650292` (18 November 2026). Export its official detail
and issuance/audit history. Verify type Invoice-Receipt, final issued state,
ILS 1.00 gross, customer and order details, issue time, payment method and
provider transaction/reference. Search all documents for transaction
`3199515577`, UID `26111814405328149265672`, ORD-1062, the customer and
ILS 1.00 around the issue time; verify there is exactly one original document
and identify any credit/cancellation/replacement document. Confirm whether
Payper's source metadata actually links 200006 to this Pelecard debit. The
public document page proves only that the document is viewable with this
number and amount; it does not show the source transaction or issuance count.

Inspect Payper's outbound email event for document 200006: intended
recipient, send time, provider message ID and delivery/bounce state. A sent
event proves dispatch, not inbox delivery. If Payper has no delivery event,
record email status as unknown. Do not resend as part of verification.

## Release of the correction gate

Attach timestamped Pelecard transaction and lifecycle evidence, Payper
document/search/email evidence, and a fresh database snapshot to the audit
ticket. If either provider has no authoritative evidence for uniqueness or
payment-document association, leave the financial correction and CT20 lock
on hold. Only an explicitly approved operator may run the separate controlled
reconciliation procedure.
