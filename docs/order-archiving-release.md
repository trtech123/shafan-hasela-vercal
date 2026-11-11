# Order archiving release notes

## Eligibility and effects

Only an existing administrator may archive or restore. Archiving sets
`archived_at` and `archived_by`; restoration clears them. The existing order
update trigger also refreshes `updated_at` in both operations. Neither operation
cancels an order or alters its payment status, quotation, scheduling, payment,
sales, invoice or accounting history.

The database accepts a cancelled (`בוטל`) or pending approval (`ממתין לאישור`)
order only if its payment status is `לא שולם` and it has no financial dependency:
payment transaction, manual payment, sale, Pelecard attempt/control, Payper
ledger/billing snapshot, immediate accounting preparation/evidence, voucher,
accounting document or event. Payment and sale rows linked only by order number
also block archiving. A positive order amount is allowed. Cancelled
orders cannot have a future order-linked scheduling block. Pending approval
orders additionally cannot have a quotation conversion link, assigned or
notified instructor, any order-linked scheduling block, or an existing customer
confirmation revision or delivery attempt. The administrator
must explicitly confirm that no external customer confirmation or commitment
remains outstanding. A request without this confirmation is rejected by the
database. Existing financial and historical records remain unchanged.

Distinct Hebrew messages explain each rejection. The archive dialog remains
open on failure, and repeat clicks cannot start a second request. Successful
archive and restore operations notify the order list, schedule and dashboard.
Archived
orders are absent from the active Orders list, Schedule, Dashboard operational
metrics, the `dashboard_stats` and `instructor_schedule` database views, POS
order search and order conflict lookup. They remain available in
the admin archive and in historical financial queries. Archived order PDFs
remain downloadable, while the archive PDF view does not offer new email or
WhatsApp confirmation actions. Restoring a future,
non-cancelled order checks site/time availability under table locks; incomplete
scheduling details or a conflict require manual review before restoration.

## Database boundary

The archive RPC locks the order row and rechecks all eligibility conditions in
the update trigger. New payment, sale, voucher, accounting, quote conversion,
customer snapshot and scheduling links acquire a share lock on the same order
row and reject archived orders. This serializes their creation with archiving.
Legacy payment and sale records identified by order number have the same guard.
Existing payment reconciliation and accounting processing are not rewritten.
Orders with an initiated or otherwise unresolved payment attempt are blocked
from archiving. Direct order deletion is rejected to protect dependent records;
the application has no other order deletion path.

Authorization uses the existing `public.is_admin()` profile rule. The archive
RPC uses caller privileges. The restore RPC and link guards use
`SECURITY DEFINER` only where cross-table reads or restore locking require it;
they have explicit authorization where callable, empty `search_path` and
restricted `EXECUTE` grants. The archive guard uses fixed SQL strings only to
inspect optional confirmation tables that may not exist on every installation.

## Release order and prerequisites

The operational deployment procedure and recovery decision are in
`docs/order-archiving-deployment-runbook.md`. Its recovery and payment-intake
gates must be satisfied before step 2 below. A completed daily backup alone
does not preserve writes made after that backup.

1. Reconfirm the production application source (the public bundle on
   2026-11-11 matched a clean `6e6caa9` build with the two Payper document
   components from `3d454eb`) and the installed schema
   markers, including those for the newer Payper migrations
   `202611080001_payper_audited_manual_hold.sql` and
   `202611080002_payper_stale_canary_retirement.sql`. Production has no
   `supabase_migrations.schema_migrations` ledger as of the 2026-11-09 preflight;
   ledger absence does not imply that SQL Editor migrations were not applied.
   Use `docs/order-archiving-production-preflight.sql` and the actual catalog
   and operator records. Do not run `db push`, replay older migrations, or
   create or repair a ledger. The archive migration's version precedes the
   newer Payper versions, so the approved deployment method must target only
   the reviewed archive SQL. Recheck a completed backup near the release window.
   A physical restore to a new project is not an isolated rehearsal while the
   Payper and Pelecard `pg_cron` jobs remain active: a copy can immediately call
   production endpoints using Vault credentials.
2. In an approved maintenance window, apply
   `supabase/migrations/202611030007_order_archiving.sql` to production. It adds
   nullable columns, indexes, functions and triggers, and updates two
   operational views; it does not backfill or modify existing orders.
   Use a short session lock timeout (for example 5 seconds) and a bounded
   statement timeout (for example 2 minutes). The migration is transactional:
   any timeout or SQL error must stop the release and roll back the transaction.
   `ALTER TABLE orders` briefly requires an exclusive lock; index creation and
   trigger installation also take table locks on the affected relations.
3. Confirm `archive_order(uuid,boolean)` and `restore_order(uuid)` exist; reload
   the PostgREST schema cache if RPC discovery lags.
4. Deploy the matching application commit. The migration must come first
   because active order queries filter on `archived_at`.
5. Perform an authorized end-to-end test with an appropriate test order.

## Rollback

Roll back the application before the schema. The manual rollback script is
`supabase/rollbacks/202611030007_order_archiving.sql`. It refuses to drop the
archive columns while any order remains archived, since that would erase
archive state. Restore those orders deliberately, or retain the additive
schema while reverting the application. Restoration changes visibility only;
the original order status, payments and relationships are preserved. If the
transactional migration fails, confirm its rollback and keep the old app; do
not restore an older physical backup over transactions recorded since then.
Without PITR, a completed daily backup cannot recover later transactions if
the live database becomes unavailable.

## Verification limits

The SQL rehearsal uses a disposable PostgreSQL database and synthetic records.
It checks authorization, cancelled and pending eligibility, financial and
operational blocks, forbidden new links, duplicate archive, restore conflicts,
hard-delete rejection and unchanged related rows. UI and build tests do not
replace an authorized staging or production end-to-end test. Current production
eligibility counts must be rechecked before deployment; no production data was
modified during this work.
