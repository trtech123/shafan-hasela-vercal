# Rivhit daily release package — 2026-11-25

## Verified baseline and hard gates

Live alias `shafan-hasela-vercal.vercel.app` points to READY deployment
`dpl_85q5oaUvY93f4UZD9WYeyHrEvq7B`, source
`1beb28c03d8e686c411ebad61a89dced382773fe`. The candidate descends from
that source. Production has zero journal sources and entries, and
`capture_enabled=false`, `posting_enabled=false`, `cutover_at=NULL`.
Production does not have the site-aware POS RPC or daily schedule column.

## Inactive preparation, after separate release approval

1. Recheck the live SHA, recent restorable backup, schema, quotas, and zero
   journal sources/entries. Stop on drift. Never restore the full financial DB
   as an application rollback.
2. Apply `202611230001_rivhit_journal_activation_guards.sql`,
   `202611230002_rivhit_future_site_evidence.sql`, then the
   `202611240001` through `202611240007` migrations in order. Migration 004
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
3. Deploy only the matching `rivhit-journal-worker` Edge Function and Vercel
   application candidate. Keep `RIVHIT_JOURNAL_INGESTION_ENABLED`,
   `RIVHIT_JOURNAL_POSTING_ENABLED`, and `RIVHIT_JOURNAL_CRON_ENABLED` false or
   absent. Keep DB capture/posting false, no cutover, no approved mapping rows.
4. Read back every control, role grant, admin report, and existing checkout
   method. Verify no new journal sources, entries, or provider calls. App
   rollback: prior Vercel alias and prior Edge worker version. Leave additive
   tables inert; do not apply a destructive database rollback.

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
