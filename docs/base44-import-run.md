# Base44 → Supabase Data Migration — Run Record

**Date:** 2026-05-28
**Outcome:** ✅ Successful cutover **+ browser-verified** on the deployed Vercel app (2026-05-28). Auth users + `profiles` untouched. Main screens render the real data correctly.

## What was applied
1. Migrations applied by user via Supabase SQL Editor:
   - `supabase/migrations/007_add_legacy_ids.sql` (additive: `legacy_id` on 9 tables + `legacy_assigned_to` on tasks/maintenance + unique indexes)
   - `supabase/migrations/008_add_activity_category_mazon.sql` (widens `activities.category` CHECK to include `מזון`)
2. `scripts/backup-tables.mjs` — read-only snapshot of current DB.
3. `scripts/import-base44.mjs --commit --clear-seed` — cleared seed business rows (where `legacy_id IS NULL`), then upserted real Base44 data.
4. `scripts/verify-import.mjs` — read-only post-checks.

## Backup path
```
C:\Users\Daniel\Desktop\shafan-hasela-main\backups\2026-05-28T05-55-36-107Z
```
Contains 10 JSON files (one per table), 67 rows total of pre-cutover state.

## Row counts — before vs after

| Table              | Before | After | Source rows | Notes |
|---|---:|---:|---:|---|
| profiles           | 3 | **3** | — | **untouched** |
| activities         | 8 | 15 | 15 | all imported (incl. 3 `מזון`) |
| instructors        | 5 | 2 | 2 | |
| leads              | 6 | 35 | 36 | 1 skipped (`"ליד חדש"` placeholder) |
| quotes             | 5 | 14 | 14 | |
| orders             | 15 | 4 | 4 | confirmed full export |
| tasks              | 6 | 6 | 6 | |
| maintenance_tasks  | 5 | 1 | 1 | |
| sales              | 12 | 6 | 6 | |
| pricing_sheets     | 2 | 0 | 3 | all 3 empty templates skipped |

## Decisions applied (per user approval)
- **Preserve original numbers:** `ORD-…`/`Q…`/`R…` carried through (verified: all 6 sales receipt_numbers begin with `R`).
- **`created_by` = null** everywhere (Base44 user IDs not mappable to `auth.users`).
- **Free-text `assigned_to` staged** in `legacy_assigned_to`; FK `assigned_to` = null.
  - tasks: 6/6 with `legacy_assigned_to` set (all = `"נורית"`); 6/6 `assigned_to` NULL.
  - maintenance: 1/1 with `legacy_assigned_to` set (`"נוגי"`); 1/1 `assigned_to` NULL.
- **`מזון` category** added to CHECK + imported: 3 activities.
- **Lead empty-name fallback** = `company || phone || "ליד ללא שם"`. Applied to 6 leads:
  - 1 → literal `"ליד ללא שם"` (no company, no phone)
  - 5 → resolved to company or phone (verified by total leads = 35 and `"ליד ללא שם"` literal count = 1)

## Skipped rows (intentional, approved)
- 1 lead: the `"ליד חדש"` placeholder record.
- 3 pricing sheets: all were empty templates (no row data).
- Any `is_sample = true` rows (none observed in this export).

## Relation remap — all resolved
- `activities.legacy_id` populated on all 15 rows; `instructors.legacy_id` on both.
- **Orders → Activities:** 4/4 `activity_id` resolved.
- **Orders → Instructors:** 3/4 `instructor_id` resolved (the 4th order had empty source `instructor` → NULL, expected).
- **Quotes nested `selected_activities[].activity_id`:** **18/18 resolved** to existing activities (the key nested-remap case).
- **Pricing `lead_id` / `quote_id`:** N/A — all source rows had empty refs (and all source rows were empty templates anyway, so 0 imported).
- **Lineage** (`quotes.converted_to_order_id`, `orders.quote_id`): all NULL — no explicit links existed in the source data.

## ID-remap method
**Option A — `legacy_id` staging columns** (additive, idempotent on re-run via `ON CONFLICT (legacy_id)`).
- legacy_id coverage after import: **100%** on all imported tables (15/15, 2/2, 35/35, 14/14, 4/4, 6/6, 1/1, 6/6).

## Auth / profiles
- `profiles` count before: 3 → after: 3 (admin@test.com, admin1@test.com, admin2@test.com). No INSERT/UPDATE/DELETE issued against `profiles` or `auth.*`.

## Warnings
- One transient `fetch` connect-timeout (~10s) on the first verify run; cleared on retry. No data effect.
- The pre-cutover `Before` counts were higher than the original seed baselines (e.g. orders 15, sales 12) — the app was actively used after deployment. All such rows are preserved in the backup; the cleared-and-replaced cutover was per the agreed plan.

## Files created/used in this cutover
- `supabase/migrations/007_add_legacy_ids.sql`
- `supabase/migrations/008_add_activity_category_mazon.sql`
- `scripts/backup-tables.mjs`
- `scripts/import-base44.mjs` (default = dry-run; `--commit --clear-seed` ran the cutover)
- `scripts/verify-import.mjs`
- `backups/2026-05-28T05-55-36-107Z/` (10 JSON files, 67 rows)

## Follow-ups not done in this run
- **Frontend:** add `מזון` to the Activities category dropdown + color map (`app/src/components/activities/ActivityFormDialog.jsx`, `app/src/pages/Activities.jsx`) so the 3 catering activities are editable in the UI. *(Out of scope for this data run.)*
- **Storage:** `images`/`image_url` still point to `base44.app` CDN URLs. They display fine while Base44 keeps hosting them; re-uploading to the Supabase `activity-images` bucket would remove the residual Base44 dependency. *(Deferred.)*
- **Lineage:** lead→quote→order links remain NULL (no source data). Fuzzy-match-by-name could populate them, but is risky and was not requested.
