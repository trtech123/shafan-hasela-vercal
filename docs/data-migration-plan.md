# Base44 → Supabase Data Migration Plan

> **Status:** Plan only — drafted 2026-05-28. **No scripts, migrations, deletions, or imports have been performed.**
> Awaiting the real Base44 export files + answers to the open questions in §13.
> **Decided so far:** Q10 = **Option A — `legacy_id` staging columns** (robust, SQL-verifiable, idempotent on re-run).

---

## 0. The central challenge (read first)
Base44 record IDs and relations are **not UUIDs**. The Base44 app id `69ca2dc3748aeb9c23109245` is 24-char hex (Mongo-style ObjectId), so relation fields like `Order.activity` / `Order.instructor` hold **Base44 IDs that will not fit Supabase `uuid` columns**. Supabase assigns brand-new UUIDs on insert, so the migration hinges on **remapping every Base44 ID → its new Supabase UUID**, including IDs nested inside JSONB.

---

## 1. What to export from Base44
One dataset per entity (10): **Activity, Instructor, Lead, Quote, Order, Task, MaintenanceTask, Sale, PricingSheet, User**.
Each record must include its **Base44 `id`**, all relation fields, and `created_date` / `created_by` if available. `User` is special (see §6).

---

## 2. Entity → table mapping
| Base44 entity | Supabase table | Notes |
|---|---|---|
| Activity | `activities` | 1:1, field names match |
| Instructor | `instructors` | 1:1, `specialties` is `text[]` |
| Lead | `leads` | enum drift on `status` + `site` (see §5) |
| Quote | `quotes` | `selected_activities` JSONB has nested activity IDs to remap |
| Order | `orders` | `activity`→`activity_id`, `instructor`→`instructor_id` (ID remap) |
| Task | `tasks` | `assigned_to` free-text in Base44 vs UUID FK here (see §5 / Q5) |
| MaintenanceTask | `maintenance_tasks` | same `assigned_to` issue |
| Sale | `sales` | `items` JSONB; `receipt_number` |
| PricingSheet | `pricing_sheets` | `lead_id`/`quote_id` remap; `categories` JSONB |
| User | `profiles` | **cannot import directly** — needs `auth.users` (see §6) |

---

## 3. File format
CSV is fine for **flat** entities, but several entities carry arrays/objects that CSV mangles.
- **Prefer JSON (one array file per entity)** — cleanly preserves `images[]`, `specialties[]`, `selected_activities[]`, `items[]`, `categories[]`, and embedded IDs; easiest for a Node importer.
- If only CSV is available: use it for flat entities, but JSONB/array columns must be **JSON-encoded inside the cell** and parsed by the importer (error-prone — JSON strongly preferred for `quotes`, `sales`, `pricing_sheets`, `activities`, `instructors`).
- **Open (Q1):** which export does the Base44 plan actually offer — CSV, JSON, or API?

---

## 4. Field mappings (relational)
| Target column | Source | Action |
|---|---|---|
| `orders.activity_id` | `Order.activity` (Base44 Activity id) | remap → activity UUID |
| `orders.instructor_id` | `Order.instructor` (Base44 Instructor id) | remap → instructor UUID |
| `orders.quote_id` | *(none on Order)* | derive from `Quote.converted_to_order_id` (reverse backfill) |
| `quotes.converted_to_order_id` | `Quote.converted_to_order_id` (Base44 Order id) | remap → order UUID (backfill after orders load) |
| `quotes.selected_activities[].activity_id` | Base44 activity ids **inside JSONB** | **nested remap** → activity UUIDs (frontend looks these up) |
| `leads.converted_to_quote_id` | *(no field in Base44 Lead)* | → `null` (lineage not recoverable) |
| `pricing_sheets.lead_id` | `PricingSheet.lead_id` | remap → lead UUID |
| `pricing_sheets.quote_id` | `PricingSheet.quote_id` | remap → quote UUID |
| `sales.items[].id` | Base44 activity ids inside JSONB | display-only; remap optional (low priority) |
| `*.created_by` | Base44 user | → `null` or admin profile (Q4) |
| `tasks/maintenance.assigned_to` | free-text name | can't map to profile UUID → `null` unless we act (Q5) |

### ID-remap mechanism — **DECIDED: Option A (`legacy_id` staging columns)**
- Add a nullable `legacy_id TEXT` to each business table via one additive migration (`007_add_legacy_ids.sql`).
- Import each row with its Base44 id in `legacy_id`.
- Resolve FKs with SQL joins, e.g.
  `UPDATE orders o SET activity_id = a.id FROM activities a WHERE o.legacy_activity_ref = a.legacy_id;`
- Re-runs are **idempotent** (upsert on `legacy_id`).
- Optional `008_drop_legacy_ids.sql` cleanup after verification.
- (Rejected alternative: in-script in-memory mapping — no schema change but less verifiable / harder to re-run.)

---

## 5. Value normalizations
- **Empty string → `null`** for every typed column (uuid, date, time, numeric, CHECK-constrained text).
- **Site spelling (critical):** real data may contain **`טברייה`** (two yods) → normalize to **`טבריה`**. Valid sets: orders/quotes/maintenance = `עכו/טבריה/נוף הגליל/שטח`; **leads = `עכו/טבריה/שטח/ויה פרטה`** (`ויה פרטה` valid for leads only).
- **Lead status drift:** Base44 = `פתוח/טופל/לא רלוונטי`; Supabase (006) = `פתוח/נשלח/נסגר/לא רלוונטי`. **`טופל` is not allowed** → must map (Q7; suggest `טופל → נסגר`).
- **Dates** → `YYYY-MM-DD` or `null`. **Times** → `HH:MM[:SS]` or `null`.
- **Numerics** → real numbers; empty → `null` (not `0`).
- **Arrays** (`images`, `specialties`) → Postgres `text[]`. **JSONB** (`selected_activities`, `items`, `categories`) → valid JSON, nested IDs remapped.
- **NOT NULL guards:** `orders.activity_date`, `orders.num_participants`, `tasks.due_date`, `maintenance_tasks.site`, `sales.total` — rows missing these are rejected; need a rule (Q8).
- **Human-readable numbers:** `order_number` / `quote_number` / `receipt_number` auto-generate via sequences (`ORD-/QUO-/RCP-`). Decide: preserve original Base44 numbers (insert explicitly + bump sequences past max) or regenerate (Q3).

---

## 6. Users / `created_by` / `assigned_to`
`User` → `profiles`, but `profiles.id` FKs `auth.users` — can't insert profiles without real auth accounts. Recommended for this cutover: **do not import users**; keep the existing admin profile, set `created_by` → `null` (or admin, Q4), and free-text `assigned_to` → `null` (Q5). Real instructor logins are a separate task.

---

## 7. Import order (FK-safe)
1. **activities**, **instructors** (no deps)
2. **leads** (`converted_to_quote_id` = null)
3. **quotes** (`converted_to_order_id` = null for now)
4. **orders** (resolve `activity_id`, `instructor_id`; `quote_id` null for now)
5. **Backfill lineage:** `quotes.converted_to_order_id` + `orders.quote_id`
6. **pricing_sheets** (resolve `lead_id`, `quote_id`)
7. **tasks**, **maintenance_tasks** (`assigned_to` per Q5)
8. **sales** (independent)

(Quotes↔orders is circular → insert both with the back-reference null, then UPDATE.)

---

## 8. Avoiding duplicates with current seed data
DB currently holds Phase-1 seed/demo rows (≈ activities 6, instructors 4, leads 5, quotes 4, orders 8, tasks 5, maintenance 4, sales 7, pricing 1). Plan: **back up → clear seed business rows (keep admin profile) → import real data.** With Option A, the importer upserts on `legacy_id`, so re-runs don't duplicate.

---

## 9. Seed data: back up, then clear (recommended)
1. Export every current table to `backups/<date>/<table>.json` (service-role script) and/or take a Supabase dashboard/PITR snapshot.
2. Delete seed rows child→parent (or `TRUNCATE ... RESTART IDENTITY CASCADE` on the 9 business tables, **excluding `profiles`**).
3. Import real data.
**Nothing deleted until approved (Q6).**

---

## 10. Scripts / SQL to create later (NOT yet)
- `007_add_legacy_ids.sql` (+ later `008_drop_legacy_ids.sql`).
- `scripts/backup-tables.mjs` — dump current tables to `backups/`.
- `scripts/import-base44.mjs` — modeled on `run-seed.mjs` (service-role key from root `.env.local`): load exports, normalize (§5), insert in order (§7), remap IDs (§4), backfill lineage, print counts.
- Verification SQL (§11).

---

## 11. Row-count & integrity verification
- **Counts:** source record count vs `SELECT count(*)` per table (minus intentionally-skipped rows, logged).
- **FK integrity (expect 0):** orders with non-null `activity_id`/`instructor_id`/`quote_id` that don't resolve; pricing_sheets with dangling `lead_id`/`quote_id`.
- **Unmapped refs report:** count Base44 refs with no match (data gaps).
- **JSONB spot-check:** `quotes.selected_activities[].activity_id` all resolve to existing activities.
- **Constraints:** a clean error-free insert proves CHECK/enum/NOT NULL satisfied; log rejected rows.

---

## 12. Visual verification after import
Logged in as admin: Dashboard KPIs reflect real numbers; Orders show real clients **with activity + instructor names resolved**; Quotes show real activities; Leads list; Schedule shows real orders/tasks/maintenance on real dates; Pricing sheets show linked lead/quote badges; Cash Register / Daily Sales show real sales. Watch console for 400s / empty lookups.

---

## 13. Open questions (blocking the build)
- **Q1 — Export format/access:** CSV, JSON, or API? Will you hand me exported files?
- **Q3 — Numbers:** preserve original `order_number`/`quote_number`/`receipt_number` (bump sequences) or regenerate?
- **Q4 — `created_by`:** `null` or attribute to admin profile?
- **Q5 — `assigned_to` (tasks/maintenance):** accept loss (`null`), preserve names (temp text column), or create matching profiles?
- **Q6 — Seed cutover:** OK to back up then clear seed business rows (keep admin profile)?
- **Q7 — Lead status:** map `טופל` → `נסגר` (or other)? Any other legacy status strings?
- **Q8 — Missing required fields:** skip-and-log vs default, for rows missing a NOT NULL field?
- **Q9 — Volume:** rough record counts per entity?
- **Q10 — Remap mechanism:** ✅ **DECIDED — Option A (`legacy_id` staging columns).**

---

## Next step
**Wait for the real Base44 export files** (and answers to Q1/Q6 at minimum). Then build `007_add_legacy_ids.sql` + the backup/import scripts — gated on explicit approval before anything runs.
