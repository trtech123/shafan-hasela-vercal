# Order archiving: production deployment and recovery runbook

Prepared for project `divzxsynczeifkpnpupl`. This is a plan, not
authorization to change production. The integration branch is
`fix/order-archive-final-20261111`, based on the existing archive implementation
`bef3c04`. On 2026-11-11, a clean build of `6e6caa9` with the two Payper
document components from `3d454eb` produced `index-Gfn_5jpH.js`, byte-for-byte
identical to the public production bundle. Those Payper component versions are
retained in this branch. Recheck the live bundle and deployment source before
release. Apply only
`supabase/migrations/202611030007_order_archiving.sql`; the production CLI
migration ledger is absent and later Payper migrations are already installed.
Never use `db push` or repair the ledger for this release.

## Recovery decision before the window

The owner has declined paid PITR for this release and accepted the remaining
recovery risk. Confirm a fresh completed daily backup close to the release
window and record its completion time. If no fresh completed backup exists,
reschedule. A logical dump near release narrows the gap to its snapshot time
but does not protect later writes. Transactions after the latest backup may
be unrecoverable after catastrophic database loss.

A database restore is an emergency recovery step. Restoring an older backup
replaces later writes and can disagree with completed provider payments or
issued invoices. Never perform it automatically for an application regression.

## Prepare and quiesce

1. Reserve a short, low-traffic window with the order-entry, cashier and
   accounting operators. Preserve the current Vercel deployment identifier and
   the live values of the payment-intake controls without copying credentials
   into the release record. Reconfirm the production application baseline,
   catalog markers, fresh completed backup, and any
   outstanding payment/issuance work using read-only checks.
2. Stop starting **new** order edits, checkouts, POS payments and manual
   accounting actions at the business intake. Allow already-started Pelecard
   callbacks, verification and Payper issuance/recovery to finish. The two
   active Cron jobs (Payper 17, Pelecard 18) stay installed; do not rotate Vault
   secrets or blindly replay an uncertain payment/document request. If intake
   cannot be paused or pending work cannot be observed, reschedule. A staff
   instruction or UI page alone is not a technical write barrier: existing
   clients can still call Supabase. Do not claim a global write freeze.
3. The archive migration's transactional DDL locks the affected tables while
   it executes. Use a short session lock timeout (for example 5 seconds) and
   bounded statement timeout (for example 2 minutes); a lock or statement
   timeout aborts the release, rather than waiting indefinitely or forcing a
   payment request to time out. Existing committed transactions are retained.
   No separate global database write blocker is installed because it could
   reject provider callbacks and create financial reconciliation work.

There is no existing application-wide maintenance gate that blocks all direct
Supabase writes. The order and POS Edge initiation switches can pause *new*
Pelecard sessions, but changing them requires separate production approval and
must not block verification or callbacks for existing sessions. If the release
requires a strict zero-write window across all business tables, this runbook
cannot provide it without additional engineering and a separate rehearsal.
The recommended short transactional migration instead preserves committed
writes and fails closed on lock contention. Pause the business intake and
monitor the financial paths; do not turn off the recovery jobs by default.

## Apply and verify (only after explicit deployment approval)

1. Apply the reviewed archive SQL exactly once, in its existing `BEGIN` /
   `COMMIT` transaction, through an approved direct SQL execution channel.
   Check that the tool submitted the complete file. Do not run an entire
   migration directory, `db push`, or the manual rollback script.
2. Confirm the archive columns, actor constraint, indexes, two RPC signatures,
   triggers and view output signatures through read-only catalog checks. Check
   that the migration committed fully and that the two existing Cron jobs and
   Payper/Pelecard controls retained their prior state. An error, timeout,
   incomplete migration or unexpected payment change stops deployment.
3. Deploy only the matching application commit. Check authenticated admin and
   non-admin navigation, active and archive lists, Dashboard and instructor
   schedule, without initiating a real charge, invoice or unsolicited message.
   Test an actual archive/restore transition only on a separately approved
   nonfinancial test order. Monitor existing payment completion and document
   queues; reconcile any uncertain provider outcome before retrying it.
4. Reopen new business intake after the app and read-only financial health
   checks pass. Record the applied file checksum, application deployment and
   backup completion time in the operator release record, without customer data or secrets.

## Failure and rollback

- SQL failure before `COMMIT`: verify transaction rollback, retain the old app,
  reopen intake only when payment processing is healthy. No physical restore.
- Application regression after schema commit: restore the previous app
  deployment first. Leave the additive schema and historical archive state
  intact. The old app remains compatible with nullable archive columns; do
  not drop columns while any order is archived. Keep Pelecard/Payper gates and
  Cron state as they were, unless a separate payment incident demands action.
- Catastrophic database loss: coordinate with the payment and accounting
  operators, use the latest valid completed backup, and compare provider and
  invoice records around the recovery boundary. A restore loses later writes
  and may require provider reconciliation. Do not replay an uncertain charge
  or document issuance.

## Restore rehearsal is a separate risk

Do not use Supabase's physical Restore to new project as an isolation test in
the present configuration. Supabase copies `pg_cron`, `pg_net` and the Vault
encryption root key, and copied jobs start immediately. Production Jobs 17 and
18 use Vault URLs/tokens to POST every minute; a clone could invoke production
Payper or Pelecard workers. A manual logical restore into a network-isolated
environment without Cron, Vault secrets or external Edge routes is the safe
rehearsal option, but it needs a separate scoped plan and does not replace the
accepted recovery gap for live production writes. No restore rehearsal is required to roll
back a failed transactional archive migration.

Sources: [Supabase backups](https://supabase.com/docs/guides/platform/backups),
[restore to a new project](https://supabase.com/docs/guides/platform/clone-project).
