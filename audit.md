# Project Audit

Date: 2026-05-21

Scope: repository audit for resetting project direction after Base44 export and partial Supabase migration.

No app code changes were made during the audit. The audit used file inspection, a read-only lint command, and read-only Supabase table-count queries.

## 1. Project Folder Structure

### Real Vite app root

The real Vite app root is:

```text
C:\Users\nadav\OneDrive\Desktop\dev-projs\shafan-hasela\adventure-ops-pro
```

Evidence:

- `adventure-ops-pro/package.json`
- `adventure-ops-pro/vite.config.js`
- `adventure-ops-pro/index.html`
- `adventure-ops-pro/src/App.jsx`

The parent folder `shafan-hasela` is not the Vite app root.

### Duplicate `.env` files

There are two `.env` files:

- `shafan-hasela/.env`
- `shafan-hasela/adventure-ops-pro/.env`

Both contain the same Supabase project URL / anon key shape.

Important risk: both also contain `SUPABASE_SERVICE_ROLE_KEY`. That key should not live in a frontend app folder long-term.

### Duplicate Supabase migrations folders

There are two migrations folders:

- `shafan-hasela/supabase/migrations`
- `shafan-hasela/adventure-ops-pro/supabase/migrations`

### Where migrations 001-006 exist

- `001_schema.sql` through `005_normalization_notes.sql` are in:

```text
shafan-hasela/supabase/migrations
```

- `006_fix_leads_status.sql` is in:

```text
shafan-hasela/adventure-ops-pro/supabase/migrations
```

This is a real folder-confusion risk.

## 2. Current Migration Status

### Pages/components already using Supabase

- `src/pages/Login.jsx`
- `src/lib/AuthContext.jsx`
- `src/pages/Dashboard.jsx`
- `src/pages/Orders.jsx`
- `src/components/orders/OrderFormDialog.jsx`
- `src/pages/Schedule.jsx`
- `src/pages/Quotes.jsx`
- `src/components/quotes/QuoteFormDialog.jsx`
- `src/components/quotes/QuotePDFDocument.jsx`
- `src/pages/Leads.jsx`

### Pages/components still using Base44

- `src/pages/Activities.jsx`
- `src/components/activities/ActivityFormDialog.jsx`
- `src/pages/Instructors.jsx`
- `src/components/instructors/InstructorFormDialog.jsx`
- `src/pages/Tasks.jsx`
- `src/components/tasks/TaskFormDialog.jsx`
- `src/pages/Maintenance.jsx`
- `src/pages/Pricing.jsx`
- `src/components/pricing/LinkToLeadQuoteDialog.jsx`
- `src/pages/CashRegister.jsx`
- `src/pages/DailySalesReport.jsx`
- `src/components/cashregister/ReceiptScreen.jsx`
- `src/lib/PageNotFound.jsx`
- `src/api/base44Client.js`

### Base44 integrations still present

- `base44.entities.*` for Activity, Instructor, Task, MaintenanceTask, PricingSheet, Sale
- `base44.integrations.Core.UploadFile` in activity image upload
- `base44.functions.invoke("sendQuoteEmail")` in cash-register receipt email
- `base44/functions/sendQuoteEmail/entry.ts`
- `@base44/sdk` and `@base44/vite-plugin` are still installed/configured

### Files changed so far

There is no `.git` repo in either `shafan-hasela` or `adventure-ops-pro`, so changed files cannot be listed authoritatively from version control.

Based on Supabase references, the migrated/touched areas appear to be:

- `src/api/supabaseClient.js`
- `src/lib/AuthContext.jsx`
- `src/pages/Login.jsx`
- `src/pages/Dashboard.jsx`
- `src/pages/Orders.jsx`
- `src/pages/Schedule.jsx`
- `src/pages/Quotes.jsx`
- `src/pages/Leads.jsx`
- `src/components/orders/OrderFormDialog.jsx`
- `src/components/quotes/QuoteFormDialog.jsx`
- `src/components/quotes/QuotePDFDocument.jsx`
- migration files `001` through `006`

## 3. Current Frontend Status

### Pages likely rendering structurally after Supabase auth

- Login
- Dashboard
- Orders
- Schedule
- Quotes
- Leads

These are Supabase-backed and should render empty states because the business tables are empty.

### Broken or partially migrated pages

- Activities: still Base44, including upload
- Instructors: still Base44
- Tasks: still Base44
- Maintenance: still Base44
- Pricing: still Base44
- Cash Register: still Base44 for activities/sales
- Daily Sales Report: still Base44
- Quote email sending: partially migrated, expects missing Supabase Edge Function `send-quote-email`
- Lead parsing: migrated away from Base44 LLM to a local parser, but marked as TODO for Edge Function quality

### Visual/functionality parity with Base44 MVP

Cannot be fully verified without the original Base44 running view or screenshots.

Clear parity gaps exist because several MVP pages still call Base44 while Supabase-authenticated app routing is now in place.

Current app will look sparse compared with the Base44 MVP because Supabase contains no business records.

Known parity concerns:

- Dashboard has extra login-instruction content and depends on empty Supabase tables.
- Activities/images, instructors, pricing, sales, tasks, and maintenance cannot match Base44 data-driven views until migrated and seeded.
- Several Hebrew strings in inspected files appear mojibake/encoding-corrupted in source output, which may affect visual parity if rendered that way.

### Lint status

Command run:

```text
npm.cmd run lint
```

Result: failed on unused imports only, not syntax errors.

Unused import errors were reported in:

- `src/components/Layout.jsx`
- `src/components/activities/ActivityFormDialog.jsx`
- `src/components/cashregister/PaymentScreen.jsx`
- `src/components/quotes/QuoteFormDialog.jsx`
- `src/pages/Dashboard.jsx`
- `src/pages/Instructors.jsx`
- `src/pages/Leads.jsx`
- `src/pages/Pricing.jsx`
- `src/pages/Quotes.jsx`

This does not prove every page renders, but no syntax-level crash was found by lint.

## 4. Data Status

### Does the ZIP/export contain real Base44 records or only entity schemas?

The local Base44 export contains entity schemas, not real records.

Found:

- `base44/entities/*.jsonc` schemas
- `base44/config.jsonc`
- `base44/.app.jsonc`
- `base44/functions/sendQuoteEmail/entry.ts`

Not found:

- No CSV seed files
- No JSON data export records
- No SQL seed inserts for business data
- No ZIP file visible in the inspected project tree

### Seed/demo data

No seed/demo data was found in the local repository.

The only `INSERT` statements found are for:

- Creating profiles from Supabase auth trigger
- Creating Supabase storage buckets

There are no inserts for business records like activities, instructors, orders, quotes, leads, tasks, maintenance tasks, sales, or pricing sheets.

### Live Supabase table counts

Read-only Supabase count queries returned:

| Table | Count |
| --- | ---: |
| `profiles` | 1 |
| `activities` | 0 |
| `instructors` | 0 |
| `quotes` | 0 |
| `orders` | 0 |
| `leads` | 0 |
| `tasks` | 0 |
| `maintenance_tasks` | 0 |
| `sales` | 0 |
| `pricing_sheets` | 0 |

### Data required to make the MVP look like Base44

Required MVP data:

- Activities with names, categories, descriptions, prices, durations, max participants, images
- Instructors with contact info, specialties, status
- Orders with clients, activity dates, sites, participants, payment/status fields
- Quotes with selected activities JSON, pricing, statuses
- Leads pipeline records
- Tasks and maintenance tasks
- Pricing sheets with categories/rows
- Sales receipts/items
- Storage assets for activity images, or preserved Base44 media URLs
- At least one admin/operations profile configured correctly

## 5. Risk List

### High risks

- Folder confusion: app root is `adventure-ops-pro`, but migrations `001-005` are outside it and `006` is inside it.
- Missing migration application risk: depending on which folder Supabase CLI reads, migration `006` may be skipped or `001-005` may be skipped.
- Missing data: all business tables are empty, so migrated pages cannot visually match the MVP.
- Unfinished Base44 dependencies: many core pages still call Base44 and likely depend on missing Base44 app params/token.
- Service role key in `.env`: dangerous if exposed to frontend tooling or committed later.

### Medium risks

- RLS issues: policies require authenticated users and role-based profiles. Only one profile exists. Admin/ops access may block inserts/selects if role setup is wrong.
- Role mapping mismatch: DB uses `admin`, `operations`, `instructor`; UI maps `operations` to Hebrew display role. This must stay consistent.
- Field mismatches: Base44 schemas use fields like `activity`/`instructor` related entities, while Supabase schema uses `activity_id`/`instructor_id`.
- Lead status mismatch already required migration `006`, proving UI/schema enum drift is real.
- Storage migration incomplete: bucket policies exist in SQL, but `ActivityFormDialog` still uses Base44 upload.

### Frontend parity risks

- Empty Supabase tables make dashboards, lists, schedules, quotes, and orders look incomplete.
- Activities/Instructors/Pricing/Cash Register/Sales/Tasks/Maintenance are still not migrated.
- Quote email Supabase function is referenced but not present in local `supabase/functions`.
- Cash-register receipt email still uses Base44 function.
- No real Base44 data export means parity must be recreated from screenshots/manual seed data unless a real data export is obtained.

