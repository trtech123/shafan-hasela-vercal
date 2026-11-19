# Group A Production backup preflight — 2026-11-19

No app deployment, migration, Edge deployment, account creation, test data, provider call, or financial mutation was performed in this preflight.

## Timeline

- Original ORD-1062 CT20 payment: approximately 2026-11-18 14:40 Israel time = 12:40 UTC, according to the release coordinator's clarification. It predates the scheduled backup.
- Latest visible Supabase scheduled physical backup: **2026-11-18 17:34 UTC** = 19:34 Israel time. Supabase Dashboard displayed a Restore control, but no restoration rehearsal has been performed. PITR is not enabled. Storage bytes are excluded from database backups.
- The separate payment coordinator reported completion of the ORD-1062 reconciliation at approximately **2026-11-19 14:02 UTC**. Its read-only post-commit audit is held in its separate workstream. We did not change or directly inspect the payment record.

## Independent aggregate read-only evidence

A separate Supabase SQL Editor tab ran only `SELECT` queries against schema metadata and aggregate timestamps, comparing to `2026-11-18 17:34:00+00`. The post-backup aggregate results were:

| Table | Created after backup | Updated after backup | Latest relevant timestamp (UTC) |
|---|---:|---:|---|
| `orders` | 0 | 1 | 2026-11-19 14:02:10.215923 |
| `payment_transactions` | 0 | 1 | 2026-11-19 14:02:10.215923 |
| `physical_payment_intents` | 0 | 1 | 2026-11-19 14:02:10.345226 |
| `payment_transaction_events` | 2 | — | 2026-11-19 14:02:10.215923 |
| `payper_document_ledger` | 1 | 1 | 2026-11-19 14:02:10.350554 |
| `accounting_documents` | 0 | 0 | — |
| `manual_order_payments` | 0 | — | — |
| `payper_noncard_payments` | 0 | — | 2026-11-16 19:34:56.089406 |
| `pelecard_live_audit` | 0 | — | 2026-11-16 14:10:59.251696 |
| `immediate_accounting_payment_evidence` | 0 | — | — |

These aggregate results prove the 18 November physical backup is **not a recovery point for the current financial state**. A Production restore to it would omit the 19 November reconciliation. They do not establish that every financial table is unchanged otherwise, nor that the backup is actually restorable. Do not run a restore as a test in Production.

## Newer backup options examined

- [Supabase's current backup documentation](https://supabase.com/docs/guides/platform/backups) and the project's Dashboard show scheduled daily physical backups and restoration, but no supported on-demand physical-backup action was found for this project. The [current Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags) lists `backups list` and `backups restore`, not `backups create`.
- Supabase documents a [manual logical `db dump`/`pg_dump` option](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). This machine currently has no `supabase`, Docker, `pg_dump`, `pg_restore`, or `psql` executable on PATH, and no database connection credential is present in its task environment. Installing tools and obtaining a database password solely to make an unverified dump would add operational and data-handling risk. A partial SQL Editor export is not an adequate whole-database backup.
- PITR is an add-on and is not authorized. Creating a second Supabase project for a restoration rehearsal is also outside the user's instruction. Storage objects need separate protection if a future release writes files; Group A does not propose Storage writes.

## Gate and smallest practical path

**STOP Group A deployment and Production writes now.** Wait for the next scheduled physical backup, expected near 2026-11-19 17:34 UTC from the observed daily cadence, but verify its actual completed timestamp and Restore availability in the Dashboard. Confirm it is later than the 19 November reconciliation and re-run aggregate `SELECT` checks immediately before deployment to identify subsequent critical changes. Treat the visible Restore control as availability evidence, not proof from a restoration drill. Preserve the immutable payment audit separately and keep the prior READY Vercel deployment ID for application rollback; never use a whole-database restore for routine Group A cleanup.

Once a sufficiently current backup is available and the protected live application source is rechecked, the user's existing Group A approval remains in force for the isolated operational application deployment and marked synthetic acceptance. No signatures, delivery, vouchers, Pelecard administration, or payment-workstream changes are included.
