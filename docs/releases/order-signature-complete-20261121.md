# Order signature release candidate — 21 November 2026

## Protected baseline and scope

- Live alias `shafan-hasela-vercal.vercel.app` resolves to READY deployment `dpl_Fo2pZqCEcKJwA6AacGzgYFQLPHKo`; its source-equivalent integration base is `cd562439ddc6685a4d0b8b82d4fcbbe5a49f1cf8`. Reconfirm this mapping immediately before release.
- Include the net staff-JWT authentication correction from `58d559cead89fa64ca940cd1232c4230f65610d2`. Never deploy the intermediate service-role-header implementation at `1cd3eef55f1544a945f57cd6202699aefc5f60c6` by itself.
- Include only the order-activity snapshot migration `202611210001_order_confirmation_activity_snapshot.sql`, the PDF model change, and focused tests. No payment, quote, WhatsApp, Payper, Pelecard, or POS changes.

## Historical activity evidence

- Read-only Production query on 21 November: `ORD-1065` (`08116ecb-c3b2-4b17-b969-94ded3963ffe`) has `activity_id=b4a82236-0008-4c9b-a489-d1708b42204a`, currently named `פיצה`; both the order's `quotation_snapshot` and revision 1's frozen quotation snapshot are null. The activity `updated_at` is 16 June 2026, earlier than the order `created_at` on 19 November 2026. This supports using the catalog name for a new revision, subject to fresh preflight. Revision 1 itself remains incorrect and immutable.
- The migration freezes activity name, description, duration and ID at order selection for future orders. Legacy orders receive catalog details only when the catalog row still exists and its `updated_at` is no later than the order's `created_at`. Deleted or subsequently edited legacy activities retain the explicit missing-history notice. Saved quotation lines take precedence.
- A read-only query of every `preparing`/`pending`/`signing` revision on 21 November returned only ORD-1065 revision 1, `pending`, expiring 27 November 2026, with zero delivery attempts. Recheck immediately before migration.
- New data from `order_confirmation_data` changes its `md5` source version where an activity can be recovered. Existing pending signature links for such orders become stale. Audit all pending revisions before applying the migration. The migration does not rewrite prior revisions, delivery attempts, or orders.

## Release gate and sequence — separate approval required

1. Reconfirm live Vercel alias/source, Supabase health and recoverable backup. Read pending signature revisions and delivery attempts; identify any affected orders and stop for review if a real customer has a pending link.
2. Reconfirm the existing `order_confirmation_data` definition, grants, order triggers, `order_signature_action` role checks, private `order-confirmations` bucket and policies. Confirm `send-order-signature` gateway JWT verification remains enabled and record its deployed version for rollback.
3. Apply **only** the reviewed activity-snapshot migration. Verify the new column/trigger/function and a read-only `order_confirmation_data(ORD-1065 UUID)` result with activity `פיצה`; verify prior revision 1 and delivery history are unchanged. Check unrelated order and financial records remain unchanged. Stop on mismatch; do not restore the database automatically.
4. Deploy only `send-order-signature` from the candidate with JWT verification **on**. Then deploy the exact reviewed Vercel app candidate via the controlled manual process. These two changes form one authentication contract. No new service-role credential or environment variable is needed.
5. Check READY and alias. From an authorized staff session, run `POST {}` through `/api/order-confirmation` only as a non-sending probe; expect `400 invalid_request`. Missing/expired session must be denied. Check order, POS, checkout, quotes and customer routes without financial actions. If authentication fails, stop; restore the previous app deployment and previous Edge version together where safe.
6. After separate approval, prepare revision 2 for ORD-1065. The existing `create` RPC supersedes pending revision 1 while keeping its snapshot, PDF and audit history. Inspect revision 2's private PDF locally through the authenticated UI: `פיצה`, correct date/customer/test terms, no missing-history notice. Verify hashes, version and expiry. Do not send or sign revision 1.
7. After separate approval for one email to `ilyasov.daniel1@gmail.com`, submit one delivery request for revision 2. Inspect delivery status and history; never retry on an uncertain result. Ask the user to confirm receipt, link opening and manual signature. After the user signs, verify signed PDF private path, hash, version and audit trail.

## Rollback and limits

- App rollback: restore the prior READY deployment alias. Edge rollback: redeploy the recorded prior function bundle, paired with the prior app. Keep the migration in place; the new column and function do not require immediate reversal. Do not delete or rewrite revision 1 or any signed PDF.
- The migration can change document source versions for existing legacy orders whose historical activity is recoverable. It must be preflighted against pending external signature links before release.
- Local PGlite rehearsal proves parsing and expected insert/change/delete behavior with synthetic data; it is not a Production migration execution test. Production schema compatibility and backup are final gates.
