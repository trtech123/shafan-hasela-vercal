# Nurit document delivery release preparation — 2026-11-20

## Protected baseline and scope

The Vercel Production alias was checked read-only on 2026-11-20: deployment `dpl_B9uaMSKzVYSnuxXpuJXPi7Lawty6` is READY and still serves application SHA `e29fedd5b0270704dbe93b9e5fae7f81477ce631`. The later checkout-safety change is not in that deployed application. This candidate starts at the deployed SHA and changes quotation delivery only. It does not import the payment workstream, alter the webhook, run migrations, or change provider settings.

The live `send-quote-email` contract accepts a saved quotation revision, UUID request ID, quote ID, revision ID and PDF bytes. The old UI passed an email, subject and HTML body; this cannot satisfy the active contract. For saved quotes, the candidate uses the restored versioned delivery panel, server authorization, saved-revision recipient, durable delivery attempts, explicit manual resend and conservative handling of unknown outcomes. An unversioned historical quote must be saved to create a revision before sending. The incompatible legacy email and text-only WhatsApp controls are removed from this PDF view; download remains available. The client role allowlist matches the Edge allowlist (admin/operations).

## Controlled nonfinancial fixtures (prepare after release approval)

No Production fixture was written in this preparation. The two required records must be created through the authorized UI after the exact application release and backup preflight, with a visibly synthetic label such as `בדיקת מסמכים — לא לקוח` and a unique `NURIT-DOC-TEST-20261120` marker in the notes. The only real contact fields are the email and mobile number supplied by the requester in this chat; enter them at test time, never commit them to Git. Do not use `QUO-1027` or another customer's record.

1. Create one order with status unpaid, no payment attempt or invoice, and the approved test email/mobile. Choose a non-conflicting test date, no instructor, and a clearly synthetic activity/description. Verify that creating it does not send a notification or reserve a real customer slot. Record its assigned `ORD` number and UUID privately in the release log.
2. Create one quotation with the same synthetic marker and approved contact fields. Save it once to create a `quotation_revision_id`; do not convert it to an order. Record its `QUO` number, UUID and revision UUID privately.
3. Check order/quote snapshots and destination immediately before sending. The quotation Edge provider takes the recipient from the saved revision, not from arbitrary client input. If the saved revision has the wrong email, correct and save a new revision before any send.
4. With separate approval for actual messages, send exactly one versioned quotation PDF email and one order confirmation email through the separately released signature-document flow. Verify inbox attachment contents, destination, saved attempt state and provider ID. If a response is lost or state is `dispatched`/`uncertain`, inspect the attempt and provider before considering a manual resend; never click Send again as a blind retry.
5. Test authorized history visibility and deny an instructor/unauthorized user. Do not send WhatsApp until the coexistence transition and sender routing are separately approved and tested. Do not create accounting documents or collect payment.

Cleanup: retain the test documents and delivery evidence if sent, and archive the records using the normal application procedure only after confirming no financial/accounting links and capturing the test result. Never hard-delete sent evidence. If no send occurred and no dependencies exist, use the existing safe delete/archive path after a read-only dependency check.

## Gates

- Application release: fresh Production source, schema/RPC/RLS and backup check, approved exact commit, manual Vercel deployment, READY alias, read-only UI smoke. No Edge deployment is included unless packaging parity is reverified and separately approved.
- Quotation email acceptance: approved fixture and destination, provider capability, one approved actual email. No delivery claim is complete on local tests alone.
- Order confirmation email acceptance: separate signature release, private PDF and Edge parity checks, one approved actual email.
- WhatsApp acceptance: distinct Meta coexistence and dual-number routing release; keep the current API number active.

Rollback: reassign the previous READY application deployment. Do not roll back the database or delete delivery attempts. Keep uncertain attempts blocked while investigating provider delivery.
