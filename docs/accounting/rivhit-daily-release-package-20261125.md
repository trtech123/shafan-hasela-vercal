# Rivhit daily release package — 2026-11-25

## Verified baseline and hard gates

The verified integration baseline is READY deployment
`dpl_BToJ7GsqKd7XiJtJmFjwHKN8oH4f`, source
`b06551255aa99537ede32b567c68a1c79e43c3cd`. Recheck the live alias
before deployment. The candidate descends from that source and preserves its
order-signature changes. Production has zero journal sources and entries, and
`capture_enabled=false`, `posting_enabled=false`, `cutover_at=NULL`.
Production does not have the site-aware POS RPC or daily schedule column.
The Production database has no `supabase_migrations.schema_migrations` table;
the Supabase CLI therefore incorrectly lists every repository migration as
pending. Do not use `supabase db push`. Verify the target objects and apply
only the nine numbered SQL files individually, recording their exact checksums
in the release evidence. The existing signature response table and RPC were
confirmed present and are not part of this package.

## Inactive preparation, after separate release approval

1. Recheck the live SHA, recent restorable backup, schema, quotas, and zero
   journal sources/entries. Stop on drift. Never restore the full financial DB
   as an application rollback.
2. Apply `202611250001` through `202611250009` migrations in order. The
   existing Production `202611240001_order_signature_browser_response.sql`
   remains unchanged. Migration 006
   accepts legacy unsited activities only when a new order has an explicit
   site; new activities require a site and classified activities are matched
   exactly. Production currently has
   22 active activities with no saved site: 12 without an order site, 8 with
   one observed site, 2 with conflicting order sites (`ארוחת בוקר`,
   `אקסטרים פרמיום`). No historic activity or financial row is changed by the
   inactive package. Resolve or split shared activities before treating all
   activity catalog records as single-site or enabling automatic posting for
   ambiguous activity lines. The worker records `activity_site_unresolved`
   for these sources and can stage other documents in the same site/method.
3. Deploy the matching `rivhit-journal-readonly`, `rivhit-journal-worker`,
   `pelecard-pos-payment`, and `payper-noncard-collection` Edge Functions,
   then the Vercel application candidate. The latter two accept explicit site
   evidence while retaining their old request contracts for existing clients.
   Keep `RIVHIT_JOURNAL_INGESTION_ENABLED`,
   `RIVHIT_JOURNAL_POSTING_ENABLED`, and `RIVHIT_JOURNAL_CRON_ENABLED` false or
   absent. Keep DB capture/posting false, no cutover, no approved mapping rows.
4. Read back every control, role grant, admin report, and existing checkout
   method. Verify no new journal sources, entries, or provider calls. App
   rollback: prior Vercel alias and prior versions of the four Edge Functions.
   Leave additive tables inert; do not apply a destructive database rollback.

## Accounting approval and financial activation (separate authorization)

The ignored private accountant seed is `.local/accounting/anat-reference-20261124.sql`.
Run `node scripts/rivhit/build-private-daily-mappings.mjs` after management
confirms the two pending site relationships. Pass `--approve-site=פודטראק` and
`--approve-site=שטח` only for relationships explicitly approved. The generator
creates private SQL and server-only JSON with the same mapping fingerprints;
neither file belongs in Git or browser output. Confirm all six groups and all
18 site/method rows against Anat's source workbook and the Production account
catalog before loading them.

For activation, set the approved mappings and worker JSON securely, choose a
future Israel-time cutover after a manual-entry freeze, then enable capture
alone. Inspect the first finalized source and daily reconciliation. Authorize
one controlled live batch; enable posting for that single test, compare the
exact Rivhit read-back row, VAT, batch membership and monthly register totals.
An uncertain response is held for read-back and never sent again. Only after
the live entry and the next automatic future-document cycle are verified may
the minute cron and ongoing daily capture/posting be enabled. The configured
23:00–23:30 Asia/Jerusalem time starts the daily run, not the cutoff. Each
minute through 23:59, newly finalized documents may form a separate batch for
the same site, payment method and mapping; unique source membership and unique
provider references prevent duplicates. A source not verified by local midnight
is reported as overdue and requires manual investigation; it is not silently
reclassified as on-time next-day posting. A document finalized after midnight
belongs to the new day's capture date. Minute cron and provider latency cannot
guarantee completion for a document finalized seconds before midnight, so the
operational rule must stop finalization early enough or accept an explicit SLA
exception. Refunds,
credit notes, partial and split payments remain outside automatic journal
posting until separately approved. Historical document 200002 stays excluded.
