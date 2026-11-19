# Nurit document delivery release preparation — 2026-11-20

> Historical preparation note for the original isolated branch. The updated live baseline, verified UUIDs and release gates are in `nurit-documents-signatures-live-preflight-20261120.md`.

## Protected baseline and scope

The Vercel Production alias was checked read-only on 2026-11-20: deployment `dpl_B9uaMSKzVYSnuxXpuJXPi7Lawty6` is READY and still serves application SHA `e29fedd5b0270704dbe93b9e5fae7f81477ce631`. The later checkout-safety change is not in that deployed application. This candidate starts at the deployed SHA and changes quotation delivery only. It does not import the payment workstream, alter the webhook, run migrations, or change provider settings.

The live `send-quote-email` contract accepts a saved quotation revision, UUID request ID, quote ID, revision ID and PDF bytes. The old UI passed an email, subject and HTML body; this cannot satisfy the active contract. For saved quotes, the candidate uses the restored versioned delivery panel, server authorization, saved-revision recipient, durable delivery attempts, explicit manual resend and conservative handling of unknown outcomes. An unversioned historical quote must be saved to create a revision before sending. The incompatible legacy email and text-only WhatsApp controls are removed from this PDF view; download remains available. The client role allowlist matches the Edge allowlist (admin/operations).

## Controlled nonfinancial fixtures

On 2026-11-20, the requester-authorized Production UI created two visibly synthetic records with only the requester-provided email and mobile number as contact details. Those private contact values are deliberately omitted from Git. No message, payment, accounting document, conversion, or signature request was initiated. Do not use `QUO-1027` or another customer's record.

- `ORD-1065`: synthetic document-test label and internal warning, 2030-01-01, one participant, no instructor, total ₪0, collection unavailable. This is an uncollected test order but has no positive balance. If acceptance specifically needs an unpaid positive balance, assess and approve that change separately before editing it.
- `QUO-1029`: synthetic document-test label and notes, 2030-01-01, one participant, one catalog item, total ₪5, saved as a draft; not sent or converted.

The UI confirmed both saves. Their database UUIDs and the quotation revision ID have not yet been captured or independently verified. Fetch those read-only during the release preflight; do not infer revision creation solely from the save toast.

1. Fetch `ORD-1065` and `QUO-1029` UUIDs, the quotation revision UUID, saved snapshots, recipient and any linked records read-only. Confirm there is no payment attempt, invoice, real booking or outbound notification on either record. If the quotation has no saved revision, save once through the approved UI before sending.
2. Check order/quote snapshots and destination immediately before sending. The quotation Edge provider takes the recipient from the saved revision, not from arbitrary client input. If the saved revision has the wrong email, correct and save a new revision before any send.
3. With separate approval for actual messages, send exactly one versioned quotation PDF email and one order confirmation email through the separately released signature-document flow. Verify inbox attachment contents, destination, saved attempt state and provider ID. If a response is lost or state is `dispatched`/`uncertain`, inspect the attempt and provider before considering a manual resend; never click Send again as a blind retry.
4. Test authorized history visibility and deny an instructor/unauthorized user. Do not send WhatsApp until the coexistence transition and sender routing are separately approved and tested. Do not create accounting documents or collect payment.

Cleanup: retain the test documents and delivery evidence if sent, and archive the records using the normal application procedure only after confirming no financial/accounting links and capturing the test result. Never hard-delete sent evidence. If no send occurred and no dependencies exist, use the existing safe delete/archive path after a read-only dependency check.

## Gates

- Application release: fresh Production source, schema/RPC/RLS and backup check, approved exact commit, manual Vercel deployment, READY alias, read-only UI smoke. No Edge deployment is included unless packaging parity is reverified and separately approved.
- Quotation email acceptance: approved fixture and destination, provider capability, one approved actual email. No delivery claim is complete on local tests alone.
- Order confirmation email acceptance: separate signature release, private PDF and Edge parity checks, one approved actual email.
- WhatsApp acceptance: distinct Meta coexistence and dual-number routing release; keep the current API number active.

Rollback: reassign the previous READY application deployment. Do not roll back the database or delete delivery attempts. Keep uncertain attempts blocked while investigating provider delivery.
