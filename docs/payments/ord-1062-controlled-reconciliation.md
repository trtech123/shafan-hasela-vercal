# ORD-1062: controlled reconciliation proposal (not executed)

This is an approval-gated financial correction. Do not send another J4 debit,
release register 004, call any Payper issuance endpoint, or change the order
status before completing the evidence checks below. Keep the existing intent
and register lock intact until its outcome has been independently confirmed.

## Frozen identifiers and observed Production state (18 November 2026)

| Record | Value |
| --- | --- |
| Order | `ORD-1062`, `91d530c4-f819-4ce8-9c4b-e30010b9a866` |
| Payment and physical intent | `833db2d6-18b1-4d66-bbcd-4360b95a315c` |
| Amount | ILS 1.00 / 100 agorot |
| Register | 004 |
| Pelecard J4 transaction | `3199515577` |
| Pelecard UID | `26111814405328149265672` |
| Pelecard approval | `0031683` |
| Payper first-response invoice number | `200006` |
| Payper system ID | `3650292` |

At observation time, the J4 first response had StatusCode/ShvaResult/
ShvaResultEmv `000`, and its `paramX` was the first 19 characters of the intent
UUID. The payment row remained `initiated`, the intent `uncertain`, the order
balance ILS 1.00, and there was no sale or Payper ledger row. The provider
response reported Payper `Success` and a document URL. This is *provider
response evidence*, not independent provider portal verification or a recorded
sale. Email delivery is not evidenced.

Read-only recheck at `2026-11-18T19:25:34Z` found the same one initiated payment,
uncertain intent, ILS 1.00 order balance, no sale, no Payper ledger row, and no
accounting event/document for this payment. CT20 004 was enabled and assigned
to workstation `GENERAL`; this intent remained the sole unresolved intent
returned for register 004. The database's
`physical_one_unresolved_per_register` unique index enforces at most one such
intent for each register. Global database searches found no other recorded
payment with provider transaction `3199515577`, no sale for this payment ID,
and no Payper ledger document `200006` or system ID `3650292`.

An independent read-only GET of the Payper-hosted document URL returned HTTP
200 and a page containing Invoice-Receipt, number `200006`, and ILS 1.00. The
page did **not** expose the Pelecard transaction ID/UID, issuance history, or
email delivery status. It therefore verifies that the linked Payper page is
viewable and displays the expected document, but does not prove acquirer
settlement, unique issuance, delivery, or exact payment association. The
Pelecard merchant credentials available in Production are masked by Vercel's
sensitive-variable controls and there is no connected read-only Pelecard
portal. Independent Pelecard verification remains mandatory.

## Mandatory read-only checks immediately before correction

1. Capture a timestamped snapshot of the order, payment, intent, sale,
   ledger, existing accounting documents, and all other order payment attempts.
   Check the exact IDs, amount, register, immutable first response, absence of
   a sale, and absence of any other successful charge or invoice. Stop on any
   mismatch or new attempt. Do not infer safety from `unresolved=0` alone.
2. Independently query Pelecard `GetTransDetailsEMV` by the saved UID, or its
   official merchant portal, using a read-only operation. Confirm approval,
   transaction ID, UID, approval code, amount 100, currency ILS, register 004,
   and merchant terminal `2814926015`. Compare the acquirer settlement view
   for reversal/refund/void and duplicates. A zero-row `CheckGoodParamXEMV`
   lookup using the full UUID is expected and is not negative payment evidence.
3. Independently open Payper's official record for system ID `3650292` and
   document `200006`; confirm Invoice-Receipt, success state, ILS 1.00, same
   customer/order, and absence of a second document. Record the canonical URL
   in the secure audit evidence. Verify email delivery only if Payper provides
   a delivery event; otherwise report delivery as unknown.
4. Obtain separate explicit approval for the exact financial correction, with
   the read-only snapshots and provider evidence attached. Apply only through
   an authorized service-role session with an audit ticket and operator ID.

## Approved correction sequence (never run automatically)

Use the existing idempotent, service-role-only RPCs against **the same payment
ID**. Re-read the frozen records under the correction session and stop on any
change. The exact approval payload, after independent Pelecard verification,
is:

```json
{"status":"approved","intentId":"833db2d6-18b1-4d66-bbcd-4360b95a315c","merchantTerminal":"2814926015","register":"004","amountMinor":100,"transactionId":"3199515577","approvalId":"0031683","uid":"26111814405328149265672"}
```

For this order, require **one authorized database transaction** containing a
guarded before-snapshot, the three RPC calls below, and guarded
after-assertions. Commit only if every assertion passes. A failed assertion
must roll back the entire transaction, leaving the original unresolved state.
If the available administration channel cannot execute all steps in one
transaction, stop and prepare a reviewed transactional runner; do not perform
three separate REST RPC calls. The intent, payment and order rows must be
locked during the transaction. The worker cannot observe the intermediate
`approved` state before commit. A lost connection after commit has an unknown
outcome: inspect the database before any repeat attempt.

1. Call `observe_physical_result(payment_id, verified_result_json)` once. It
   records the independently verified approval on the existing intent.
2. Call `finalize_physical_payment(payment_id)` once. Its database transaction
   uses the existing payment, creates or returns the unique sale, updates the
   order balance, and reserves the one-document ledger identity. Require a
   succeeded result and exactly one linked sale. If interrupted, re-read state
   before any continuation; never send J4 again.
3. Call `record_physical_direct_document(payment_id)` once. This links the
   **saved first-response document** to the reserved ledger; it does not
   create or email a Payper document. Require the document number `200006`,
   system ID `3650292`, state `succeeded`, and one ledger row.
4. Capture a timestamped after-snapshot: one successful payment, one sale,
   zero order balance, one linked Payper Invoice-Receipt, no duplicate provider
   charge or document, and an unlocked register only as the natural result of
   completed state. Record the before/after diff in the audit ticket.

If any step fails, stop. Preserve all evidence and existing locks; continue
only after a new read-only assessment of the resulting state. Never
compensate by recharging, issuing a document, manually editing ledger rows, or
unlocking the register.

## Release relationship

The code migration deliberately leaves pre-migration intent
`833db2d6-18b1-4d66-bbcd-4360b95a315c` ineligible for automatic UID
recovery. Releasing new code does not perform this financial correction.
