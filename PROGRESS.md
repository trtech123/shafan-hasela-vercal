# PROGRESS — Shafan Hasela / Adventure Ops Pro

> Single source of truth for the Base44 → Supabase MVP recovery.
> Update at the **end of every phase** before reporting to the user.
> **Never** put secrets, API keys, JWTs, or service-role tokens in this file.

Last updated: 2026-05-27
Active phase: **Phase 7 — Folder restructure** — ✅ done. `adventure-ops-pro/` → `app/`, `base44/` → `reference/base44/`. Dev server boots from `app/`. **All 7 phases complete; the local MVP recovery is done.** Phases 4–6 verified in browser; Phase 6 + 7 pending your final smoke test.

> ⚠️ **Path change for future sessions:** the frontend now lives in **`app/`**, not `adventure-ops-pro/`. Boot with `npm run dev --prefix app`. Reference schemas are at `reference/base44/`. `CLAUDE.md` + older completion-log links below still say `adventure-ops-pro/` (historical) — read them as `app/`.

---

## Phases

| # | Phase | Status |
|---|---|---|
| 0 | Stabilize folder layout (consolidate migrations + env hygiene) | ✅ done |
| 1 | Seed enough demo data so migrated screens show content | ✅ done |
| 2 | Migrate Activities (incl. image upload → Supabase Storage) | ✅ done |
| 3 | Migrate Instructors | ✅ done |
| 4 | Migrate Tasks + Maintenance (fixes Schedule's empty lanes) | ✅ done (browser-verified) |
| 5 | Migrate CashRegister + DailySalesReport (email button stays disabled) | ✅ done (browser-verified) |
| 6 | Migrate Pricing + Base44 SDK unplug | ✅ code done — pending browser verify |
| 7 | Final folder restructure (`adventure-ops-pro/` → `app/`, `base44/` → `reference/`) | ✅ done |

---

## Page migration status

| Page | Route | Status | Notes |
|---|---|---|---|
| Login | `/login` | ✅ Supabase | Working |
| Dashboard | `/` | ✅ Supabase + seeded | 8 orders this month, KPIs populated |
| Orders | `/orders` | ✅ Supabase + seeded | 8 rows, mix of statuses/payment states |
| Quotes | `/quotes` | ✅ Supabase + seeded | 4 rows across statuses (טיוטה/נשלחה/ממתינה לאישור/אושרה) |
| Leads | `/leads` | ✅ Supabase + seeded | 5 rows |
| Schedule | `/schedule` | ✅ Supabase | Now also loads `profiles` for `assigned_to` name lookup; user-created tasks/maintenance now appear in their lanes |
| Activities | `/activities` | ✅ Supabase + Storage | 6 seeded rows; image upload writes to `activity-images` bucket |
| Instructors | `/instructors` | ✅ Supabase | 4 seeded rows; CRUD + specialty multi-select |
| Tasks | `/tasks` | ✅ Supabase | CRUD + toggleDone; `assigned_to` is a profile picker; browser-verified |
| Maintenance | `/maintenance` | ✅ Supabase | CRUD + status cycle; `assigned_to` is a profile picker; site gated client-side; browser-verified |
| CashRegister | `/cashregister` | ✅ Supabase | Grid reads Supabase `activities`; sale INSERT lets DB generate `RCP-` receipt number; email button disabled; browser-verified |
| DailySalesReport | `/sales-report` | ✅ Supabase | Reads `sales`; client-side week/day/method aggregation + CSV export unchanged; browser-verified |
| Pricing | `/pricing` | ✅ Supabase (pending browser verify) | `pricing_sheets` CRUD; lead/quote link FKs normalized to null; categories JSONB unchanged |

---

## Supabase / data status

- **Project ref:** `divzxsynczeifkpnpupl` (public-info; key in `.env`)
- **Canonical migrations folder:** `shafan-hasela/supabase/migrations/`
- **Migrations present:** `001_schema.sql`, `002_functions.sql`, `003_rls.sql`, `004_storage.sql`, `005_normalization_notes.sql`, `006_fix_leads_status.sql`
- **Storage buckets:** `activity-images` (public, 5 MB), `documents` (private, 10 MB)
- **Seed file:** [supabase/seed.sql](supabase/seed.sql) (canonical, idempotent) + [scripts/run-seed.mjs](scripts/run-seed.mjs) (Node runner via PostgREST)
- **Row counts (after Phase 1 seed, 2026-05-24):**
  | table | rows |
  |---|---:|
  | profiles | 1 (`admin@test.com`, role=**admin**) |
  | activities | 6 |
  | instructors | 4 |
  | leads | 5 |
  | quotes | 4 |
  | orders | 8 (spread across current month) |
  | tasks | 5 |
  | maintenance_tasks | 4 (one per site) |
  | sales | 7 (last 7 days) |
  | pricing_sheets | 1 (linked to NorthTech quote) |
- **Migration 006 applied?** **YES** (confirmed by probe insert)

---

## Env / secrets hygiene

- **Frontend `.env`:** `adventure-ops-pro/.env` — contains only `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.
- **Local secrets file:** `shafan-hasela/.env.local` — outside the Vite project; holds the service-role key for one-off seed/admin scripts only.
- **Removed:** duplicate root `shafan-hasela/.env` (deleted in Phase 0).
- **Removed:** `SUPABASE_SERVICE_ROLE_KEY` from frontend `.env` (parked in `.env.local`).
- **`.gitignore`** in `adventure-ops-pro/` already excludes `.env` and `.env.*`. Root has no `.gitignore` yet (no git repo).

---

## Known bugs / issues / TODOs

- [x] ~~Single existing `profiles` row's role is unknown — RLS may block reads. Verify and promote to `admin` in Phase 1.~~ Done in Phase 1: promoted `admin@test.com` from `instructor` → `admin`.
- [x] ~~**Browser console noise (deferred to Phase 6):** Base44 SDK still emits `GET /api/apps/null/entities/User/me → 404`, `Base44 SDK Error 404`, and analytics-batch 404s. Sources: `@base44/vite-plugin` in [vite.config.js](adventure-ops-pro/vite.config.js) injects sandbox/HMR/analytics scripts that auto-fetch a User from a `null` app id, plus [base44Client.js](adventure-ops-pro/src/api/base44Client.js) still imported by 7 unmigrated pages (Instructors, Tasks, Maintenance, Pricing, CashRegister, DailySalesReport, PageNotFound) and 4 dialogs (InstructorFormDialog, TaskFormDialog, LinkToLeadQuoteDialog, ReceiptScreen). All resolve in Phase 6 when the SDK + plugin get removed. (Updated after Phase 4: Instructors/InstructorFormDialog removed in Phase 3; Tasks, Maintenance, TaskFormDialog removed in Phase 4. Remaining genuine SDK importers per the phase plan after Phase 5: Pricing, PageNotFound + LinkToLeadQuoteDialog.)~~ **Resolved in Phase 6** — all three migrated, `base44Client.js` deleted, and `@base44/vite-plugin` removed from `vite.config.js` (which is what produced the `/api/apps/null` + analytics 404s). `src/` exit grep for all 5 Base44 patterns = 0. (`@base44/sdk` + `@base44/vite-plugin` remain declared in `package.json` — unused, outside `src/`; pruning deferred to avoid lockfile drift without `npm install`.)
- [x] ~~Schedule reads Supabase `tasks` + `maintenance_tasks`, but Tasks/Maintenance pages still write Base44 → calendar lanes always show 0 until Phase 4.~~ **Resolved in Phase 4** — both pages now write Supabase; user-created rows appear in Schedule's task (pink) + maintenance (yellow) lanes.
- [ ] Site enum drift between Base44 (`טברייה`, `ויה פרטה`) and Supabase + UI (`טבריה`, `נוף הגליל`). Audit again before Phases 1, 4, 6.
- [ ] `sendQuoteEmail` Supabase Edge Function not implemented — receipt + quote email buttons will stay disabled with `אימייל לא זמין כרגע — בבנייה` tooltip (decision: defer to post-MVP).
- [ ] Lead text-parsing uses local regex; original TODO suggested upgrading to an Edge Function with Claude API. Acceptable for MVP.
- [ ] 9 files have ESLint unused-import warnings (cosmetic) — clean in Phase 6.
- [ ] Mojibake suspected in some inspected Hebrew source strings — verify at dev-server render time.
- [ ] No git repo yet. Consider `git init` early so future changes are reviewable.

---

## Open decisions

- **Phase 7 timing.** Folder rename (`adventure-ops-pro/` → `app/`) happens only after Phase 6 verifies zero Base44 imports. Do not rename mid-flight.
- **Real Base44 data export.** No CSV/JSON export found locally. MVP will use hand-authored idempotent seed data unless a real export surfaces.

---

## Operating rules (enforced every phase)

- **Rule A — Screen Action Map.** Before migrating any screen, write its action map (buttons, forms, data loaded, data written, cross-screen sync, acceptance criteria).
- **Rule B — Validate migrations against three sources.** Base44 entity schema + current frontend field usage + known mismatches (e.g. `activity` vs `activity_id`).
- **Rule C — Stop after each phase and report.** Never chain phases without user approval.
- **Rule D — MVP done means** all sidebar screens open, all core screens show realistic data, CRUD + cross-screen sync work, zero Base44 imports remain.

---

## Phase 7 completion log

**Date:** 2026-05-27

**Goal:** the one-shot folder move (only after Phase 6 verified zero Base44 imports).

**New structure (root `shafan-hasela-main/`):**
```
├── CLAUDE.md, PROGRESS.md, audit.md, .gitignore
├── scripts/run-seed.mjs
├── supabase/migrations/
├── reference/base44/        ← was app/base44 (entities + functions; read-only reference)
└── app/                     ← was adventure-ops-pro/ (the Vite frontend)
```

**Actions taken**
1. Moved `adventure-ops-pro/base44/` → `reference/base44/` (created `reference/`). Reference schemas (`entities/`, `functions/`) intact; nothing in `src/` imported from there, so safe.
2. Renamed `adventure-ops-pro/` → `app/` (with `node_modules`, `.env`, all config — same-volume metadata rename).
3. [scripts/run-seed.mjs](scripts/run-seed.mjs) — updated the one hardcoded path `…/adventure-ops-pro/.env` → `…/app/.env` (only functional reference to the old name; everything else inside the app uses relative paths).

**Lock troubleshooting (the move was not clean on the first try)**
- The `base44 → reference/` move succeeded immediately, but renaming `adventure-ops-pro → app` failed repeatedly with "being used by another process."
- Ruled out (all confirmed gone): the killed Vite dev server, `node.exe`/`esbuild.exe`, two leftover session watcher shells, and PyCharm (`pycharm64.exe`) — user closed it.
- Windows **Restart Manager** reported **no file-level locker** → indicated a process with its **current working directory inside the folder** (RM doesn't track cwd handles).
- Culprit class: a **File Explorer / terminal window** sitting in the folder (two `cmd.exe` windows were open, children of `explorer.exe`). After the user closed the offending window(s), the rename succeeded on the first retry.
- **Lesson for next time:** before a Phase-7-style directory rename, stop the dev server AND make sure no Explorer/terminal window is parked inside the target folder. RM = `(no lockers reported)` + rename failure ⇒ suspect a cwd/Explorer handle, not a file lock.

**What was tested**
- ✅ `app/` exists with `src/`, `node_modules/`, `vite.config.js`, `.env`; `adventure-ops-pro/` gone; `reference/base44/entities/` present.
- ✅ No `adventure-ops-pro` references remain in `app/` or `scripts/`.
- ✅ Dev server **restarted from `app/`** (`npm run dev --prefix app`) — boots clean (no errors in the Vite log); `HTTP 200` on `/`, `main.jsx`, `App.jsx`, and `@/`-aliased pages (Pricing, CashRegister, Tasks). The explicit `@`→`./src` alias survived the move.

**What is NOT tested (your final smoke pass)**
- Open the app in the browser from the new location and click through every sidebar route once (same as the Phase 6 smoke test) to confirm no `@/…` resolve errors and that the `/api/apps/null` console noise stays gone.

**Follow-ups / notes**
- **`CLAUDE.md` still references `adventure-ops-pro/`** (folder layout, "where to look", and the boot command `cd adventure-ops-pro && npm run dev`). It anticipated this rename (it has a "Target after Phase 7" section). Recommend updating CLAUDE.md's current-structure + boot command to `app/` so future sessions aren't misled — say the word and I'll do it.
- Older completion-log links in this file still point to `adventure-ops-pro/...` (historical record; the files are now under `app/...`).
- Dead code still present (harmless, not imported): `app/src/lib/app-params.js` (orphaned when `base44Client.js` was deleted). Can delete in a cleanup pass.
- `@base44/sdk` + `@base44/vite-plugin` remain declared in `app/package.json` (unused; pruning deferred to avoid lockfile drift without `npm install`).

**MVP status:** ✅ **Complete.** All sidebar screens run on Supabase, zero Base44 imports in `app/src/`, folder structure finalized. Out-of-scope items (payments/Salika, AI chatbot, WhatsApp, real `sendQuoteEmail`, production deploy) remain intentionally undone.

---

## Phase 6 completion log

**Date:** 2026-05-27

**Decisions applied:** F=(a) removed the PageNotFound `base44.auth.me()` check + the English "Admin Note" builder artifact; G=removed `@base44/vite-plugin`; H=left `@base44` deps in `package.json` (unused, lockfile untouched); I=reworded the Leads.jsx stale comment; J=light lint cleanup only (dropped a dead `useCallback` import in Pricing.jsx).

**Actions taken**
1. [Pricing.jsx](adventure-ops-pro/src/pages/Pricing.jsx) — `base44.entities.PricingSheet.*` → `supabase.from('pricing_sheets')`. `loadSheets` ordered by `created_at` DESC; `selectSheet` now a direct `.eq('id',…).single()`; `createNew`/`save` use `.insert/.update(...).select().single()` so the returned row feeds `setSheet`. **Save uses an explicit normalized payload** (no `...sheet` spread): `lead_id`/`quote_id` → `|| null` (the UUID-FK empty-string fix — `handleLink` + "נקה קישור" can set `""`), other empties → null, `categories || []`. Error toasts throughout; `save` wrapped in `try/finally`.
2. [LinkToLeadQuoteDialog.jsx](adventure-ops-pro/src/components/pricing/LinkToLeadQuoteDialog.jsx) — `Lead.list`/`Quote.list` → `supabase.from('leads'/'quotes').select('*').order('created_at',…).limit(100)`, destructured with error logging.
3. [PageNotFound.jsx](adventure-ops-pro/src/lib/PageNotFound.jsx) — removed `base44` + `@tanstack/react-query` imports, the `useQuery`/`auth.me()` call, and the admin-note block (Base44 builder artifact). Pure presentational 404 now.
4. [Leads.jsx](adventure-ops-pro/src/pages/Leads.jsx) — reworded the L55 comment so it no longer contains the literal `base44.integrations…` (exit-grep hygiene; no behavior change).
5. **Deleted** [base44Client.js](adventure-ops-pro/src/api/base44Client.js) — the SDK shim. `src/api/` now holds only `supabaseClient.js`. (`app-params` was imported only by the shim, so it's now dead too.)
6. [vite.config.js](adventure-ops-pro/vite.config.js) — removed the `@base44/vite-plugin` import + plugin entry. **Then added `resolve.alias['@'] → ./src` explicitly** via `fileURLToPath(new URL('./src', import.meta.url))` — the plugin had been silently providing that alias, and removing it broke every `@/…` import (`Failed to resolve import "@/App.jsx"`). Caught on dev-server restart.

**What was tested**
- ✅ `grep -i` over `adventure-ops-pro/src/` for `@base44`, `base44.entities`, `base44Client`, `base44.functions`, `base44.integrations` → **all zero** (Rule D "MVP done": no Base44 imports remain in the running frontend).
- ✅ Dev server **restarted** with the plugin-free config and boots clean — no pre-transform/resolve errors in the Vite log.
- ✅ `HTTP 200` on `/`, `/src/main.jsx`, `/src/App.jsx`, `/src/pages/Pricing.jsx`, `/src/components/pricing/LinkToLeadQuoteDialog.jsx`, `/src/lib/PageNotFound.jsx` — all transform.

**What is NOT tested (needs your browser pass — logged in as `admin@test.com`)**
- AC 1–5: `/pricing` loads the seeded sheet; create / edit+save (totals persist) / link a lead+quote (FK persists) / "נקה קישור" → save → no 400 / delete.
- AC 6: a bad URL renders PageNotFound with no console error.
- AC 7 (**important**): every sidebar route still opens after the Vite-plugin removal, and the old `/api/apps/null` + analytics 404 console noise is **gone**.

**Risks / notes**
- The Vite-plugin removal was the one app-wide change; mitigated by the explicit `@` alias. If any route white-screens, check the browser console for an unresolved `@/…` import.
- `@base44/*` packages remain in `package.json`/lockfile (unused). Prune later alongside a proper `npm install` (out of scope this session — Git/npm restricted).

**PROGRESS.md updated?** Yes (this log, Action Map status block, phase table, page-status row, Known-bugs console-noise + importer items flipped to resolved).

**MVP status:** All sidebar screens are now on Supabase; zero Base44 imports in `src/`. Pending your browser verification of Pricing + the post-unplug smoke test, **Phase 7 (folder restructure: `adventure-ops-pro/` → `app/`, `base44/` → `reference/`) is the only remaining phase.** Do not start it without an explicit "go" (Rule C).

---

## Phase 6 — Pricing migration + Base44 SDK unplug — Screen Action Map (drafted 2026-05-27)

> **Status:** ✅ Implemented 2026-05-27 (user gave "go for code"; F=(a) remove auth check, G=remove plugin, H/I/J=defaults). See the **Phase 6 completion log** above. **Key surprise:** removing the Vite plugin also removed the `@` path alias — had to declare it explicitly in `vite.config.js`.
> This is the final functional phase. Two parts: (1) migrate the last Base44-backed screen (Pricing + its link dialog + the 404 page); (2) unplug the SDK entirely (delete the shim, clean a stale comment, drop the Vite plugin).

**Definitive remaining Base44 footprint** (from precise grep — `import.*base44Client` / `from '@base44` / `base44.(entities|functions|integrations|auth)`):
| Location | Usage | Action |
|---|---|---|
| [Pricing.jsx](adventure-ops-pro/src/pages/Pricing.jsx) | `PricingSheet.list ×2 / create / update / delete` | → `supabase.from('pricing_sheets')` |
| [LinkToLeadQuoteDialog.jsx](adventure-ops-pro/src/components/pricing/LinkToLeadQuoteDialog.jsx) | `Lead.list`, `Quote.list` | → `supabase.from('leads' / 'quotes')` |
| [PageNotFound.jsx](adventure-ops-pro/src/lib/PageNotFound.jsx) | `base44.auth.me()` | → Decision F |
| [base44Client.js](adventure-ops-pro/src/api/base44Client.js) | the SDK shim (imports `@base44/sdk`, `@/lib/app-params`) | **DELETE** (only the 3 files above import it; `app-params` is imported only by it) |
| [Leads.jsx](adventure-ops-pro/src/pages/Leads.jsx) L55 | stale **comment** containing the literal `base44.integrations.Core.InvokeLLM` | reword so the exit grep is clean |
| [vite.config.js](adventure-ops-pro/vite.config.js) | `@base44/vite-plugin` (HMR/analytics/sandbox injectors → the `/api/apps/null` 404 console noise) | remove → Decision G |
| `package.json` | `@base44/sdk`, `@base44/vite-plugin` deps | Decision H (recommend defer — outside the `src/` exit grep) |

`Login.jsx` / `Layout.jsx` / `QuotePDFDocument.jsx` matched only the broad keyword grep — **no real SDK import/call** (verified). No action.

### Visible buttons / actions (Pricing)
- Sidebar: `גיליון חדש` (create), sheet list (select), per-row trash (delete).
- Header: title input, `קשר לליד / הצעה` (opens LinkToLeadQuoteDialog), `num_participants` input, `שמור` (save → recompute totals + UPDATE).
- Body: add/edit/delete categories (via `PricingCategory` child — **not in scope**, pure local state over `sheet.categories`), notes textarea.
- LinkToLeadQuoteDialog: lead/quote tabs, search, pick → `onLink`, `נקה קישור` (clear → id null).

### Data loaded / written
- Load list: `SELECT * FROM pricing_sheets ORDER BY created_at DESC LIMIT 100`.
- Select one: `SELECT * FROM pricing_sheets WHERE id = ? ` (single).
- Create: `INSERT { title, categories, num_participants } ... .select().single()` (need the returned row — code does `setSheet(created)`).
- Update: `UPDATE ... .eq('id', …).select().single()` with an **explicit** payload (recompute totals; normalize FK empties — see below).
- Delete: `DELETE WHERE id = ?`.
- Dialog: `SELECT * FROM leads ORDER BY created_at DESC LIMIT 100` + same for `quotes`.

### Rule B — schema validation (pricing_sheets)
- `001_schema.sql` `pricing_sheets` columns == `base44/entities/PricingSheet.jsonc` properties == current UI fields: `title*`, `lead_id`, `lead_name`, `quote_id`, `quote_number`, `num_participants`, `categories` (JSONB), `total_cost/sell/profit`, `margin_pct`, `notes`. **No field-name drift.**
- `categories` JSONB shape `[{id,name,rows:[{id,description,cost,quantity,total_cost,sell_price,total_sell,profit,margin_pct,notes}]}]` matches across all three sources — **no reshape**; `PricingCategory` keeps managing it.
- `leads.company` (L203) + `leads.full_name` exist → dialog subtitle renders. `quotes.event_date` used for the optional quote subtitle (display-only; `select('*')` is safe even if absent).
- **RLS** (`003_rls.sql`): `pricing: admin/ops` read/insert/update + `admin delete`. Admin login → full CRUD. **No migration needed.**
- Base44 `.create/.update` returned the row; Supabase requires `.select().single()` to replicate (`setSheet`/`setSheets` depend on it).

### Empty-string / null normalization rules (Pricing save)
The bug class from Phases 3–5 reappears here. `handleLink` sets `lead_id: id || ""` / `quote_id: id || ""`, and `נקה קישור` passes `id: null` → also becomes `""`. Both are **UUID FK** columns that reject `""`. So the save payload must be explicit (no `...sheet` spread) and coerce:
| Field | Column | Rule |
|---|---|---|
| `lead_id` | UUID FK nullable | `sheet.lead_id || null` |
| `quote_id` | UUID FK nullable | `sheet.quote_id || null` |
| `lead_name` | TEXT | `sheet.lead_name || null` |
| `quote_number` | TEXT | `sheet.quote_number || null` |
| `num_participants` | INTEGER | `sheet.num_participants ?? null` |
| `notes` | TEXT | `sheet.notes || null` |
| `categories` | JSONB NOT NULL | `sheet.categories || []` |
| `title` | TEXT NOT NULL | sent as-is (always has a value) |
| `total_cost/sell/profit`, `margin_pct` | NUMERIC | recomputed numbers |
Do **not** spread the whole `sheet` (it carries `id`/`created_at`/`created_by`/`updated_at` and possibly stale fields). `created_by` left untouched (NULL on insert, unchanged on update).

### Open decisions (need your call before code)
- **F — PageNotFound auth check. (Recommended: remove it.)** It calls `base44.auth.me()` only to show an English "Admin Note" that says *"the AI hasn't implemented this page yet — ask it in the chat"* — a Base44-builder artifact, irrelevant to this app and untranslated. Option (a, recommended): delete the `useQuery` + `base44.auth.me()` + the Admin-Note block (simplest, removes the dependency cleanly). Option (b): rewire to `useAuth()` (`user.role === 'admin'`) to keep the note. 
- **G — Vite plugin removal. (Recommended: remove.)** Drop `@base44/vite-plugin` from `vite.config.js`. This is what eliminates the long-standing `/api/apps/null/entities/User/me 404` + analytics-404 console noise. Legacy SDK imports are gated off (`BASE44_LEGACY_SDK_IMPORTS` unset), so nothing real depends on it. **Requires a dev-server restart to verify boot** — the one app-wide change in this phase. Revert = re-add one import + plugin entry.
- **H — package.json deps. (Recommended: defer.)** Leave `@base44/sdk` + `@base44/vite-plugin` declared (now unused). Pruning them without running `npm install` would desync the lockfile, and Git/npm are off-limits this session. They sit outside `src/`, so the exit grep stays clean regardless.
- **I — Leads.jsx comment (needed for exit grep).** Reword the L55 comment so it no longer contains the literal `base44.integrations...` string. No behavior change.
- **J — lint cleanup. (Recommended: light touch.)** Remove only the now-dead imports in files I edit. Defer the broader pre-existing 9-file unused-import warnings unless you want them swept now.

### Risks / pitfalls
- **Vite plugin removal (G)** is the only app-wide change — after it, restart Vite and click through every route to confirm boot + no white screen.
- **Empty-string UUID** on Pricing save (normalized above).
- **`base44Client.js` deletion** is safe only after all 3 importers are migrated — must do migrations first, delete last, then confirm no dangling imports anywhere.
- **`.select().single()`** required on insert/update or `setSheet(created/updated)` sets `undefined` and the editor blanks.
- Mojibake: Pricing + dialog are Hebrew-heavy — confirm render after edits.
- Exit grep is scoped to `adventure-ops-pro/src/` (per CLAUDE.md) — `vite.config.js`/`package.json` are outside it.

### Acceptance criteria (test after code lands)
1. `/pricing` opens; the 1 seeded sheet loads in the sidebar; selecting it shows its categories/rows and computed totals.
2. `גיליון חדש` → new sheet INSERTed, appears at top, becomes active and editable.
3. Edit categories/rows + participants → `שמור` recomputes totals and UPDATEs; reselecting the sheet shows persisted values.
4. `קשר לליד / הצעה` → pick a lead and a quote (real UUIDs) → save persists `lead_id`/`quote_id`; the badges show name/number. `נקה קישור` → save → FK becomes NULL, **no 400**.
5. Delete a sheet → it disappears; active selection clears if it was open.
6. Visiting a bad route renders PageNotFound with **no** Base44 error in console.
7. Dev server boots after the Vite-plugin removal; the `/api/apps/null` + analytics 404 console noise is **gone**; all sidebar routes still open.
8. `grep -i` over `adventure-ops-pro/src/` for `@base44`, `base44.entities`, `base44Client`, `base44.functions`, `base44.integrations` → **all zero**.
9. `base44Client.js` deleted; `npm run dev` shows no unresolved-import errors.

### Next step
Awaiting explicit **"go for code"** + your calls on F/G (H/I/J = recommended defaults unless you object). Then: migrate the 3 files → delete the shim → clean the Leads comment → (G) remove the Vite plugin → restart Vite → verify (grep + boot) → update PROGRESS.md with a Phase 6 completion log → stop for browser verification (Rule C).

---

## Phase 5 completion log

**Date:** 2026-05-27

**Decisions applied:** A = DB-generated `RCP-<seq>` receipt number (read back after insert); A2 = on insert failure, still show the receipt with a local `R<6 digits>` fallback + Hebrew error toast; B = raw `sales` table with existing client-side aggregation; C = email button disabled with the Hebrew "בבנייה" tooltip; D = activities grid reads Supabase; E = `created_by` omitted → NULL.

**Actions taken**
1. [CashRegister.jsx](adventure-ops-pro/src/pages/CashRegister.jsx)
   - `base44.entities.Activity.list()` → `supabase.from('activities').select('*').eq('status','פעיל')` (resolves the Phase-2 catalog mismatch; new activities now appear in the register). `.then` chain → `async load()`; preserved the `?prefill=` Schedule deep-link verbatim. Error toast on fetch failure.
   - `base44.entities.Sale.create(...)` → `supabase.from('sales').insert({ items, total, method, sale_date }).select().single()`. **No `receipt_number` in the payload** — DB DEFAULT generates `RCP-<seq>`; the returned row's `receipt_number` is what the receipt shows. On insert error: console + Hebrew toast + local `R<6 digits>` fallback number so the POS flow never hard-crashes mid-sale. `total` still sent (no DB trigger backs it).
2. [ReceiptScreen.jsx](adventure-ops-pro/src/components/cashregister/ReceiptScreen.jsx)
   - Removed `base44` import and the entire `handleSendEmail` (`base44.functions.invoke("sendQuoteEmail")`) path, plus the now-unused `email`/`sending`/`sent` state and `useState` import.
   - Email `<Input>` + `שלח` `<Button>` are now `disabled`, wrapped in a `div` carrying `title="אימייל לא זמין כרגע — בבנייה"` (matches the codebase's native-`title` tooltip convention). Print + "מכירה חדשה" unchanged.
3. [DailySalesReport.jsx](adventure-ops-pro/src/pages/DailySalesReport.jsx)
   - `base44.entities.Sale.list("-sale_date", 500)` → `supabase.from('sales').select('*').order('sale_date',{ascending:false}).limit(500)`. All week/day/method aggregation, bar chart, and CSV export logic untouched. Error toast on fetch failure.

**What was tested**
- ✅ `grep -i base44` on `CashRegister.jsx`, `ReceiptScreen.jsx`, `DailySalesReport.jsx` → **0 matches**.
- ✅ Vite dev server serves `HTTP 200` on `/` and on all three edited modules (they transform without parse/compile errors).
- ✅ Acceptance criterion #8 (no Base44 refs) verified by grep.

**What is NOT tested (needs your browser pass — logged in as `admin@test.com`)**
- AC 1: `/cashregister` grid shows Supabase active activities.
- AC 2–3: complete a sale → row INSERTed into `sales` with a `RCP-…` number, and the **receipt shows that same `RCP-…` number** (note the format change from the old `R123456`).
- AC 4: Schedule "גבייה בקופה" deep-link → prefilled item → completing it writes a sale.
- AC 5: email input + `שלח` are disabled with the "בבנייה" tooltip; Print + מכירה חדשה work.
- AC 6–7: `/sales-report` reflects the new sale (cards, chart, breakdown, day detail) and the Excel/CSV export includes it.

**Known limitations carried forward**
- Receipt-number format changed `R123456` → `RCP-1000…` (intended, per Decision A).
- Base44 SDK 404 console noise (global Vite plugin + remaining importers) — unchanged, Phase 6.

**PROGRESS.md updated?** Yes (this log, Action Map status block, phase table, page-status rows, Known-bugs importer note).

**Next recommended phase:** Phase 6 — Pricing migration + final Base44 SDK unplug (remove `base44Client.js`, the `@base44/vite-plugin`, and the remaining importers: Pricing, PageNotFound, LinkToLeadQuoteDialog). **Do not start without an explicit "go"** (Rule C).

---

## Phase 5 — CashRegister + DailySalesReport — Screen Action Map (drafted 2026-05-27)

> **Status:** ✅ Implemented 2026-05-27 (user gave "go for code"; decisions A/A2/B/C/D = recommended, E = omit created_by). See the **Phase 5 completion log** above for what shipped + what needs browser verification.
> Scope = the POS sale-write path + the weekly sales report. The `Sale` entity is the only backend touched.

**Files in scope**
- [adventure-ops-pro/src/pages/CashRegister.jsx](adventure-ops-pro/src/pages/CashRegister.jsx) — Base44 `Activity.list` + `Sale.create`.
- [adventure-ops-pro/src/components/cashregister/ReceiptScreen.jsx](adventure-ops-pro/src/components/cashregister/ReceiptScreen.jsx) — Base44 `functions.invoke("sendQuoteEmail")` (the email button).
- [adventure-ops-pro/src/pages/DailySalesReport.jsx](adventure-ops-pro/src/pages/DailySalesReport.jsx) — Base44 `Sale.list`.

**NOT in scope (pure UI, no backend calls — leave untouched):** `PaymentScreen.jsx`, `Cart.jsx`, `ActivityGrid.jsx`.

### Visible buttons / actions
**CashRegister** (full-screen POS, 3 sub-screens: `menu` | `payment` | `receipt`)
- ActivityGrid tile click → `addToCart` (local state).
- Cart: qty ±, custom price edit, remove, `onCheckout` → `payment` screen.
- PaymentScreen: pick one of 5 methods (`מזומן / אשראי / העברה / אפליקציה / חשבונית`) → `handlePaymentConfirm(method)` → **writes a Sale** → `receipt` screen.
- Schedule deep-link: `?prefill=<json>` → pre-loads one cart item and jumps straight to `payment` (the "גבייה בקופה" button on Schedule).
- ReceiptScreen: `הדפס קבלה` (print, client-only), email input + `שלח` (→ **to be disabled**), `מכירה חדשה` (reset).

**DailySalesReport** (read-only analytics)
- Week navigation (prev/next, next disabled at current week).
- Summary cards (weekly revenue / count / avg), bar chart, daily table, method breakdown / per-day detail toggle.
- `ייצוא לאקסל` → client-side CSV export (no backend).

### Data loaded
- CashRegister: **activities** (`SELECT * FROM activities WHERE status='פעיל'`) for the grid. *(Currently Base44 — this is the Phase-2 "catalog mismatch" gap; swapping it makes newly-created activities show in the register.)*
- DailySalesReport: **sales** (`SELECT * FROM sales ORDER BY sale_date DESC LIMIT 500`). Client-side derives week/day/method aggregates + Excel.

### Data created / updated / deleted
- CashRegister `handlePaymentConfirm`: **INSERT** into `public.sales` `{ items, total, method, sale_date }`. **No receipt_number in the payload** — DB DEFAULT generates it (see Decision A). Insert is the only write. No update/delete in scope (sales are immutable by design — `003_rls.sql` has no UPDATE policy).

### Cross-screen sync
- A completed sale → appears in DailySalesReport (same `sales` table) on its `sale_date`; counts toward Dashboard's sales KPIs if/when those read `sales` (Dashboard already on Supabase).
- Activities grid now shares the Supabase `activities` catalog with Activities/Orders/Quotes/Schedule → newly-added activities appear in the register without code change.

### Rule B — schema validation (sales)

| Source | Shape |
|---|---|
| `001_schema.sql` `sales` | `id uuid`, `receipt_number TEXT UNIQUE NOT NULL DEFAULT ('RCP-' \|\| nextval('receipt_number_seq'))`, `items JSONB NOT NULL DEFAULT '[]'`, `total NUMERIC(10,2) NOT NULL`, `method TEXT NOT NULL` (**no CHECK** — free text), `sale_date DATE NOT NULL DEFAULT CURRENT_DATE`, `created_by uuid FK profiles`, timestamps |
| Base44 `Sale.jsonc` | `receipt_number`, `items[{id,name,qty,customPrice}]`, `total`, `method`, `sale_date`. Required: `total`, `method`, `sale_date` |
| Current UI write (CashRegister) | sends `{ receipt_number(JS-gen), items[{id,name,qty,customPrice}], total, method, sale_date }` |
| Current UI read (DailySalesReport) | reads `s.id`, `s.sale_date`, `s.total`, `s.method`, `s.receipt_number`, `s.items[{name,qty}]` |

- **`items` JSONB shape `[{id,name,qty,customPrice}]` matches** across all three sources — no reshape needed.
- **`method` values** (`מזומן/אשראי/העברה/אפליקציה/חשבונית`) — no DB CHECK, so no enum-drift risk; PaymentScreen keys == DailySalesReport `METHOD_COLORS` keys. ✅
- **`sales_summary` view** (`002`) exists (daily `receipt_count`, `daily_total`, `receipts` json) but is **not** a good fit for DailySalesReport: it groups by day only (no week nav), and its `receipts` json omits `id` (used as a React key) and per-row `method` is present but the report also needs raw rows for the Excel detail + method breakdown. → keep client-side aggregation (Decision B).
- **No `compute_sale_total` trigger** exists (unlike orders/quotes). `sales.total` MUST be sent by the client. Keep the existing JS `total = Σ(customPrice·qty)`. (The CLAUDE.md "don't compute totals in JS" rule applies to orders/quotes, which DO have triggers — not to sales.)
- **RLS** (`003_rls.sql`): `sales: admin/ops read` + `admin/ops insert`, no UPDATE, `admin delete`. We log in as admin → INSERT + SELECT both allowed. **No migration / RLS patch needed.**

### Open decisions (need your call before code)

- **A — receipt_number source. (Recommended: let the DB generate it.)** Today CashRegister builds `R<6 digits>` in JS and sends it. CLAUDE.md mandates letting the DB sequence DEFAULT populate `receipt_number` (format `RCP-1000`, `RCP-1001`, …). Implementation: stop sending `receipt_number`; do `insert(...).select().single()` and use the **returned** `receipt_number` on the receipt. **User-visible effect: receipt numbers change format from `R123456` → `RCP-1000`.** OK to proceed?
  - **A2 — insert-failure behavior.** The write is currently fire-and-forget. Once we await it: if the INSERT errors (e.g. RLS), should we **(i, recommended)** still show the receipt with a local fallback number + a Hebrew error toast (cashier already took the money), or **(ii)** block the receipt and force a retry?
- **B — DailySalesReport data source. (Recommended: raw `sales` table, keep all client aggregation.)** Straight call-site swap, smallest diff. Alternative (the `sales_summary` view) would require rewriting the report and loses `id`/Excel detail — not recommended.
- **C — email button (mandated by CLAUDE.md, confirming).** Remove the `base44.functions.invoke("sendQuoteEmail")` path in ReceiptScreen; **disable** the email input + `שלח` button with the Hebrew tooltip `אימייל לא זמין כרגע — בבנייה`. Print + New Sale stay functional.
- **D — Activities catalog (mandated direction, confirming).** Swap CashRegister's `base44.entities.Activity.list()` → `supabase.from('activities').select('*')` filtered to `status='פעיל'`; preserve the `?prefill=` Schedule deep-link. Resolves the Phase-2 catalog mismatch.
- **E — created_by (minor). (Recommended: omit → NULL.)** Base44 didn't set it; column is nullable. Could populate from `supabase.auth.getUser()` for audit, but that's a nice-to-have. Propose omit for MVP parity.

### Risks / pitfalls
- Receipt-number **format change** (R… → RCP-…) is user-facing — flagged in Decision A.
- Await-on-insert changes a fire-and-forget call into one that can throw → must handle errors so the POS flow never hard-crashes mid-sale (Decision A2).
- Don't drop `total` from the payload (no DB trigger backs it).
- ReceiptScreen still imports `base44` only for the email invoke — removing the email path must remove the import too (else Phase 6 grep fails).
- Mojibake: ReceiptScreen + report contain Hebrew + `₪`; confirm render after edit.

### Acceptance criteria (test after code lands)
1. `/cashregister` opens; the grid shows the **Supabase** active activities (incl. any created since Phase 2).
2. Add items, adjust qty/price, checkout, pick a method → receipt screen shows, and a row is **INSERTed into `sales`** with DB-generated `RCP-…` number, correct `items`/`total`/`method`/`sale_date`.
3. The receipt screen displays the **same** `RCP-…` number that's stored in the DB.
4. Schedule "גבייה בקופה" deep-link still pre-loads the item and jumps to payment; completing it writes a sale.
5. Email input + `שלח` are **disabled** with the Hebrew "בבנייה" tooltip; Print + מכירה חדשה still work.
6. `/sales-report` opens; the new sale appears in the current week (revenue, count, method breakdown, day detail, bar chart all reflect it).
7. Excel export still produces a valid Hebrew CSV including the new sale.
8. `grep -i base44` on `CashRegister.jsx`, `ReceiptScreen.jsx`, `DailySalesReport.jsx` → **0 matches**.
9. No new ESLint errors; app boots (`HTTP 200`).

### Next step
Awaiting explicit **"go for code"** + your answers to Decisions A/A2 (and confirmation of B–E). Then implement, verify (grep + boot), update PROGRESS.md with a Phase 5 completion log, and stop for browser verification (Rule C).

---

## Phase 4 completion log

**Date:** 2026-05-27

**Pre-flight (Rule B + RLS gate)**
- Read [`003_rls.sql`](supabase/migrations/003_rls.sql) `profiles` policies: `profiles: admin read all` → `USING (public.is_admin())`. The admin we log in as **can** read all profiles, so the picker populates. **No `007` RLS patch needed** for the admin MVP path. Caveat (non-blocking, noted for later): `operations` role only has `profiles: read own`, so an ops user would see only themselves in the picker.
- Confirmed `001_schema.sql`: `tasks.assigned_to` + `maintenance_tasks.assigned_to` are `UUID REFERENCES profiles(id) ON DELETE SET NULL` → Option A (keep UUID FK, swap to picker) is correct, no migration.
- Confirmed `profiles` columns: `id, email, full_name, role` → picker query `select('id, full_name, email')` is valid.
- Schema-drift fix landed: `tasks.category` CHECK uses `אדמיניסטרציה` (two yods); TaskFormDialog used `אדמינסטרציה` (one yod). Edited the UI string to match the schema (single-char fix, no migration). All other Tasks/Maintenance enums already matched.

**Actions taken (Option A — UUID FK + profile picker)**
1. [TaskFormDialog.jsx](adventure-ops-pro/src/components/tasks/TaskFormDialog.jsx) — `base44.entities.Task.create/update` → `supabase.from('tasks').insert/update`. Added `toast` + `try/finally`. Explicit normalized payload (`due_date`/`due_time`/`category` → `|| null`; `assigned_to` sentinel → null). `assigned_to` free-text Input → Radix `<Select>` over `profiles` with `NO_ASSIGNEE="__none__"` sentinel + "ללא אחראי". Existing-row load coerces `assigned_to ?? NO_ASSIGNEE` and slices `due_time` to `HH:MM` (Postgres TIME returns `HH:MM:SS`). New `profiles` prop.
2. [Tasks.jsx](adventure-ops-pro/src/pages/Tasks.jsx) — `base44.entities.Task.list/delete/update` → Supabase. `loadData` now `Promise.all([tasks, profiles])`. Added `profileById` map + `getProfileName()`. Search now matches the assignee's `full_name` (not the raw UUID). 👤 chip shows the profile name. `toggleDone`/`handleDelete` get error toasts. Passes `profiles` to the dialog.
3. [Maintenance.jsx](adventure-ops-pro/src/pages/Maintenance.jsx) — `base44.entities.MaintenanceTask.*` → Supabase (`.order('created_at', …)`; Base44 used `-created_date`). `load` now `Promise.all([maintenance_tasks, profiles])`. `openEdit` maps fields explicitly (incl. `assigned_to ?? NO_ASSIGNEE`). `handleSubmit` gates on `form.site` truthy (NOT NULL CHECK, Select has no `required`) with a Hebrew toast, then normalizes payload. `assigned_to` Input → profile `<Select>`. 👤 chip shows profile name. Error toasts on delete/status-cycle.
4. [Schedule.jsx](adventure-ops-pro/src/pages/Schedule.jsx) — already Supabase; added `profiles` to its `Promise.all`, added `getProfileName()`, and swapped the two 👤 display sites (task L~382, maintenance L~411) from raw `assigned_to` UUID to the profile name.

**What was tested**
- ✅ `grep -i base44` on `Tasks.jsx`, `Maintenance.jsx`, `TaskFormDialog.jsx`, `Schedule.jsx` → **0 matches**.
- ✅ Vite dev server boots; `HTTP 200` on `/` and on all four edited modules (`/src/pages/Tasks.jsx`, `/src/pages/Maintenance.jsx`, `/src/pages/Schedule.jsx`, `/src/components/tasks/TaskFormDialog.jsx`) — they transform without parse/compile errors.
- ✅ Acceptance criteria #12 (no Base44 refs) verified by grep.

**What is NOT tested (needs your browser pass — logged in as `admin@test.com`)**
Run acceptance criteria 1–11 from the Action Map below. The high-value ones:
- `/tasks` + `/maintenance` open, seeded rows render (5 tasks DESC by `due_date`; 4 maintenance grouped by site).
- Create a task with only `title` + `due_date` → succeeds. Create one with `assigned_to` = the admin profile → 👤 chip shows the name on Tasks **and** on Schedule. Create one with "ללא אחראי" → DB `assigned_to = NULL`, no chip.
- Edit a task, clear `due_time` → saves with `due_time = NULL`. Same for `assigned_to`.
- `toggleDone` (Tasks) + status-cycle (Maintenance) persist; delete works.
- Maintenance: submitting with **no site** is blocked client-side with the "יש לבחור אתר" toast (not a Supabase 400).
- Create one task + one maintenance row, go to `/schedule` → both appear on their `due_date` in the correct lane with the profile name.

**Known limitations carried forward**
- Only 1 profile (`admin@test.com`) exists, so the picker has a single real option besides "ללא אחראי" — user accepted this as Option A's cost.
- Base44 SDK 404 console noise (global, from the Vite plugin + remaining importers) — unchanged, Phase 6.

**PROGRESS.md updated?** Yes (this log, phase table, page-status rows, Known-bugs entries, Action Map status block).

**Next recommended phase:** Phase 5 — CashRegister + DailySalesReport (Sale entity). **Do not start without an explicit "go"** (Rule C). Per Rule A, Phase 5 begins by writing its Screen Action Map.

---

## Phase 4 — Tasks + Maintenance — Screen Action Map (drafted 2026-05-26)

> **Status:** ✅ Implemented 2026-05-27 (user gave explicit "go"). See the **Phase 4 completion log** above for what shipped and what still needs browser verification.

**Decision recorded — `assigned_to` design (was open per [`project-phase4-assigned-to-decision`](C:\Users\nadav\.claude\projects\c--Users-nadav-OneDrive-Desktop-dev-projs-shafan-hasela\memory\project_phase4_assigned_to_decision.md))**
- Picked: **Option A** — keep `UUID FK` to `profiles`, swap free-text Input → profile picker in both TaskFormDialog + Maintenance.
- Rationale (user): preserve referential integrity now even though only 1 profile (`admin@test.com`) exists today. Picker UX cost is accepted; new profiles can be seeded later.
- Migration 007 is **not** needed for `assigned_to`. (007 may still be needed if RLS check below blocks.)

**Files in scope**
- [adventure-ops-pro/src/pages/Tasks.jsx](adventure-ops-pro/src/pages/Tasks.jsx) — Base44 list/delete/toggleDone
- [adventure-ops-pro/src/components/tasks/TaskFormDialog.jsx](adventure-ops-pro/src/components/tasks/TaskFormDialog.jsx) — Base44 create/update
- [adventure-ops-pro/src/pages/Maintenance.jsx](adventure-ops-pro/src/pages/Maintenance.jsx) — Base44 list/delete/toggleStatus + inline form dialog (single file, no separate dialog component)

### Visible buttons / actions
**Tasks**
- Header `משימה חדשה` (Plus) → open `TaskFormDialog` create.
- Per row icon (Circle/Clock/CheckCircle2/AlertCircle) → `toggleDone`: flips `status` between `פתוחה` and `הושלמה`.
- Per row Pencil → open dialog edit.
- Per row Trash → AlertDialog confirm → delete.
- Free-text search input matches `title` OR `assigned_to` (case-insensitive); status filter (`all / פתוחה / בביצוע / הושלמה / בוטלה`).
- `isOverdue` badge when `status != הושלמה|בוטלה` AND `due_date < today`.

**Maintenance**
- Header `משימה חדשה` (Plus) → open inline `Dialog` create.
- Per card CheckCircle2 → `toggleStatus`: cycles `פתוחה → בטיפול → הושלמה → פתוחה`.
- Per card Pencil / Trash same pattern.
- Site filter + status filter; cards grouped by site (color-coded per `SITE_COLORS`).

### Forms / dialogs
**TaskFormDialog**
- `title*` (text), `description` (textarea)
- `due_date*` (date input, `required`), `due_time` (time input)
- `priority` (select: `נמוכה / בינונית / גבוהה / דחופה`, default `בינונית`)
- `category` (select: `ציוד / תחזוקה / אדמינסטרציה / הכשרה / שיווק / אחר`, default `אחר`) — **see schema drift below**
- `status` (select: `פתוחה / בביצוע / הושלמה / בוטלה`, default `פתוחה`)
- `assigned_to` — **change** from free-text `<Input>` (L101) to Radix `<Select>` over `profiles`, with `NO_ASSIGNEE = "__none__"` sentinel + "ללא אחראי" option.

**Maintenance inline form (Maintenance.jsx)**
- `title*` (text), `site*` (select, not currently `required` — gate manually), `category` (select: `בטיחות / ציוד / מתקנים / ניקיון / כללי`)
- `priority` (select: `גבוהה / בינונית / נמוכה`, default `בינונית`), `status` (select: `פתוחה / בטיפול / הושלמה`, default `פתוחה`)
- `description` (textarea), `due_date` (date)
- `assigned_to` — same change as Tasks: free-text Input (L235) → profile picker.

### Data loaded
- Tasks: `SELECT * FROM tasks ORDER BY due_date DESC LIMIT 200`.
- Maintenance: `SELECT * FROM maintenance_tasks ORDER BY created_at DESC LIMIT 200` (Base44 currently uses `-created_date` → Supabase column is `created_at`).
- **NEW (Option A):** `SELECT id, full_name, email FROM profiles ORDER BY full_name` loaded once per page (Tasks, Maintenance, Schedule). Build `profileById` map for display + search lookups.

### Data created / updated / deleted
- Tasks INSERT/UPDATE/DELETE on `public.tasks`.
- Maintenance INSERT/UPDATE/DELETE on `public.maintenance_tasks`.
- `toggleDone(task)` (Tasks) / `toggleStatus(task)` (Maintenance) — partial UPDATE `{ status }`.
- No file uploads, no JSONB columns.

### Cross-screen sync — Schedule lights up (the whole point of Phase 4)
[Schedule.jsx](adventure-ops-pro/src/pages/Schedule.jsx) already reads `tasks` + `maintenance_tasks` from Supabase ([L52–53](adventure-ops-pro/src/pages/Schedule.jsx#L52-L53)). Seeded rows render today; **user-created** rows will start rendering only after Phase 4. Three downstream display sites currently render `assigned_to` as a plain string — must convert to profile-name lookup once Option A lands:

| File | Line | Current | After Option A |
|---|---|---|---|
| [Tasks.jsx](adventure-ops-pro/src/pages/Tasks.jsx) | [L47](adventure-ops-pro/src/pages/Tasks.jsx#L47) | search uses `t.assigned_to?.toLowerCase()` directly | search uses `profileById[t.assigned_to]?.full_name.toLowerCase()` |
| [Tasks.jsx](adventure-ops-pro/src/pages/Tasks.jsx) | [L132](adventure-ops-pro/src/pages/Tasks.jsx#L132) | `👤 {task.assigned_to}` | `👤 {profileById[task.assigned_to]?.full_name || '—'}` |
| [Maintenance.jsx](adventure-ops-pro/src/pages/Maintenance.jsx) | [L154](adventure-ops-pro/src/pages/Maintenance.jsx#L154) | `👤 {task.assigned_to}` | same lookup |
| [Schedule.jsx](adventure-ops-pro/src/pages/Schedule.jsx) | [L377](adventure-ops-pro/src/pages/Schedule.jsx#L377) | `👤 {task.assigned_to}` | same lookup (requires Schedule to also load profiles) |
| [Schedule.jsx](adventure-ops-pro/src/pages/Schedule.jsx) | [L406](adventure-ops-pro/src/pages/Schedule.jsx#L406) | `👤 {m.assigned_to}` | same |

Schedule already has a `getActivityName(id)` pattern (L74–76) — mirror it as `getProfileName(id)`.

### Rule B — schema drift findings (Tasks + Maintenance)

| # | Source | Value | Action |
|---|---|---|---|
| 1 | `001_schema.sql:240` `tasks.category` CHECK | `אדמיניסטרציה` (א-ד-מ-**י**-נ-**י**-ס-ט-ר-צ-י-ה — two yuds) | **Fix UI in Phase 4** |
| 1 | [TaskFormDialog.jsx:84](adventure-ops-pro/src/components/tasks/TaskFormDialog.jsx#L84) | `אדמינסטרציה` (one yud, missing position 6) | Edit string to match schema |
| 1 | Base44 `Task.jsonc` enum | `אדמינסטרציה` (one yud) | Read-only reference — leave |

**Decision:** schema spelling is the standard Hebrew form. Single-char UI edit, no migration. No existing Supabase task rows use this category (Tasks still on Base44; seeded rows use other categories) → no data migration risk.

Other enum cross-checks (✅ all match between schema, Base44 entity, current UI):
- Tasks: `status` (`פתוחה / בביצוע / הושלמה / בוטלה`), `priority` (`נמוכה / בינונית / גבוהה / דחופה`).
- Maintenance: `status` (`פתוחה / בטיפול / הושלמה`), `priority` (`גבוהה / בינונית / נמוכה`), `category` (`בטיחות / ציוד / מתקנים / ניקיון / כללי`), `site` (`עכו / טבריה / נוף הגליל / שטח` — same as orders, no Lead-style drift).

### Empty-string normalization (preemptive — per [`project-postgres-empty-string`](C:\Users\nadav\.claude\projects\c--Users-nadav-OneDrive-Desktop-dev-projs-shafan-hasela\memory\project_postgres_empty_string.md))

Drop the `...form` spread in both `handleSubmit` paths. List fields explicitly with `|| null` coercion. Same lesson as Bug #3.

**TaskFormDialog handleSubmit** — explicit payload object, normalize:
- `due_date: form.due_date || null` (defense-in-depth; field is `required` but spread is risky)
- `due_time: form.due_time || null` (TIME column rejects `""`)
- `assigned_to: (form.assigned_to && form.assigned_to !== NO_ASSIGNEE) ? form.assigned_to : null` (UUID FK rejects `""` and the sentinel)
- `category`, `priority`, `status` — non-empty defaults, no normalization needed.

**Maintenance handleSubmit** — same treatment:
- `due_date: form.due_date || null` (DATE nullable)
- `category: form.category || null` (nullable CHECK)
- `site` — NOT NULL CHECK; **gate submit** on `form.site` truthy (UI Select has no `required` attribute today)
- `assigned_to`: same sentinel pattern as Tasks
- Other fields: non-empty defaults.

### Option A — profile-picker design notes
- One `loadProfiles()` per page (Tasks, Maintenance, Schedule), cached in component state.
- Picker: Radix `<Select>` with `NO_ASSIGNEE` sentinel constant + "ללא אחראי" item — Bug #1 lesson (Radix forbids empty-string `SelectItem value`).
- Display fallback when `assigned_to` is a UUID with no matching profile (e.g. profile was deleted): show `'—'`, do not crash.
- **Phase-4 pre-flight RLS check:** read [`003_rls.sql`](supabase/migrations/003_rls.sql) and confirm `admin` + `operations` roles get `SELECT` on `public.profiles` for rows other than self. If only self-read is granted, picker shows only the current user → Option A is broken until a small RLS patch (`007_profiles_read.sql`) lands. Do the read first; ship the patch if needed inside the phase.

### Acceptance criteria
1. `/tasks` opens without errors when logged in as `admin@test.com`; 5 seeded task rows render in DESC `due_date` order.
2. `/maintenance` opens; 4 seeded rows render grouped by site with correct color coding.
3. Create new task with only `title` + `due_date` filled → INSERT succeeds, row appears at top, no console errors.
4. Create new task with all fields incl. `assigned_to` = the single admin profile → persists; Tasks list 👤 chip shows the profile's `full_name`; Schedule shows the same name.
5. Create new task with `assigned_to` = "ללא אחראי" (sentinel) → DB row has `assigned_to = NULL`; 👤 chip is absent.
6. Edit existing task: clear `due_time` → save succeeds; DB shows `due_time = NULL`. Repeat for `assigned_to`.
7. `toggleDone` on a task → status flips, re-render is correct, no Base44 noise added.
8. Delete task → confirm → row disappears.
9. Repeat 3–8 for Maintenance (`site` is required — empty-site submit must be blocked client-side, not a Supabase 400).
10. Filters (Tasks status, Maintenance site + status) still work over the new Supabase data.
11. After creating one new task + one new maintenance row, navigate to `/schedule`: both appear on their `due_date` in the correct lane (pink for tasks, yellow for maintenance), and `👤` shows the profile name (not a UUID).
12. `grep -i base44` on `Tasks.jsx`, `TaskFormDialog.jsx`, `Maintenance.jsx` → **0 matches**.
13. No new ESLint errors introduced (warnings tolerable until Phase 6).

### Open risks / unknowns
- Only 1 profile exists → picker has 1 option until more users are seeded. User accepted this as a known Option A cost.
- Profile RLS — must be verified before form code is written (see pre-flight above).
- Schedule profile loading is new fan-out; keep the query small (`id, full_name, email`) to avoid hauling the whole `profiles` row.

---

## Phase 3 — Post-completion bug fix #3 (2026-05-25) — site CHECK empty-string

**Bug reported in browser:**
After the TIME-empty-string fix, saving an order still fails with Supabase 400:
`new row for relation "orders" violates check constraint "orders_site_check"`

**Root cause**
Same bug *class* as #2 (empty string sent to a typed column), different column. [001_schema.sql:117](supabase/migrations/001_schema.sql#L117): `orders.site TEXT CHECK (site IN ('עכו', 'טבריה', 'נוף הגליל', 'שטח'))`. Column is **nullable** — NULL satisfies a Postgres CHECK constraint — but the empty string `""` is not in the allowed set, so it fails the check.

[OrderFormDialog.jsx](adventure-ops-pro/src/components/orders/OrderFormDialog.jsx) drives `site` via toggle buttons (line 270): `onClick={() => handleChange("site", form.site === site ? "" : site)}`. Clicking the currently-selected site deselects it back to `""`. Same for never selecting a site at all (default `""` from `emptyForm`). Either path → `data.site = ""` → constraint violation. Same payload for INSERT and UPDATE.

**Allowed values vs sources cross-check**

| Source | Site values |
|---|---|
| `001_schema.sql` `orders_site_check` / `quotes_site_check` / `maintenance_tasks_site_check` | `עכו`, `טבריה`, `נוף הגליל`, `שטח` |
| `001_schema.sql` `leads_site_check` (different!) | `עכו`, `טבריה`, `שטח`, `ויה פרטה` |
| `OrderFormDialog.SITES` / `QuoteFormDialog.SITES` / `Maintenance.SITES` | `עכו`, `טבריה`, `נוף הגליל`, `שטח` |
| `Leads.jsx` `SITE_OPTIONS` (presumed; matches lead enum) | from lead enum |
| Base44 entity `Order.jsonc` / `Quote.jsonc` enum | `עכו`, `טברייה` (extra yud!), `נוף הגליל`, `שטח` |
| Base44 entity `Lead.jsonc` enum | `עכו`, `טברייה`, `שטח`, `ויה פרטה` |
| Seeded orders/quotes/leads (Phase 1) | UI/Supabase spelling: `טבריה` (one yud) |

So there is a known Base44↔Supabase **spelling drift** on `טברייה`/`טבריה` (extra yud in Base44), but the current frontend, schema, and seed all consistently use `טבריה` (one yud) — that is NOT the source of the bug. The bug is purely the empty-string case.

**Scope across the codebase** — three already-migrated forms send a `site` value to Supabase. All three had the same gap (no `""` → null normalization):

| File | Path that hits Supabase | Affected? |
|---|---|---|
| [OrderFormDialog.jsx](adventure-ops-pro/src/components/orders/OrderFormDialog.jsx) | `handleSubmit` data object | ✅ caused this bug |
| [QuoteFormDialog.jsx](adventure-ops-pro/src/components/quotes/QuoteFormDialog.jsx) | `handleSubmit` `...form` spread (line 99) | ✅ same bug class, would fire identically once user clears site or creates a quote with no site |
| [Leads.jsx](adventure-ops-pro/src/pages/Leads.jsx) | `updateSite(id, "")` from inline select's "—" option (line 376) + `saveEdit(id)` `update(editData)` (line 173) | ✅ same bug class — leads_site_check enum differs but the empty-string path fails the same way |

Maintenance still on Base44 (Phase 4) — will need the same normalization when migrated.

**Fix applied** — same `value || null` pattern as the TIME fix:
1. [OrderFormDialog.jsx](adventure-ops-pro/src/components/orders/OrderFormDialog.jsx) `handleSubmit`: added `site: form.site || null`.
2. [QuoteFormDialog.jsx](adventure-ops-pro/src/components/quotes/QuoteFormDialog.jsx) `handleSubmit`: added `event_date: form.event_date || null` + `site: form.site || null` (event_date also a typed column with the same risk).
3. [Leads.jsx](adventure-ops-pro/src/pages/Leads.jsx):
   - `updateSite(id, site)` — coerce `site || null` before write + local state update.
   - `updateDate(id, event_date)` — same for the DATE column.
   - `saveEdit(id)` — replaced bare `update(editData)` with an explicit `payload` that normalizes `site` and `event_date`.

All edits carry a one-line comment explaining the Postgres empty-string rejection so the pattern is discoverable.

**What was tested**
- ✅ Vite boots; `HTTP 200` on all three edited files (`OrderFormDialog.jsx`, `QuoteFormDialog.jsx`, `Leads.jsx`).
- ✅ `grep -i base44` → 0 active matches on all three (the one Leads.jsx match is a historical comment, no SDK call).
- ✅ Single payload path per form → fixes apply to both INSERT and UPDATE (where relevant).

**Browser verification needed (you)**
- New order **with no site picked** → save succeeds, DB row has `site = NULL`.
- New order **with a site picked** → save succeeds, site persists.
- Edit existing order, toggle the current site off (deselect) → save succeeds, site becomes `NULL`.
- Edit/save the 8 seeded orders (which all have a site) → no regression.
- New quote with no site → save succeeds.
- Inline-edit a lead via the `—` site option → save succeeds, `site = NULL`.
- Inline-edit a lead's date to empty → save succeeds, `event_date = NULL`.

**Files changed:**
- [adventure-ops-pro/src/components/orders/OrderFormDialog.jsx](adventure-ops-pro/src/components/orders/OrderFormDialog.jsx)
- [adventure-ops-pro/src/components/quotes/QuoteFormDialog.jsx](adventure-ops-pro/src/components/quotes/QuoteFormDialog.jsx)
- [adventure-ops-pro/src/pages/Leads.jsx](adventure-ops-pro/src/pages/Leads.jsx)

**Phase 4 prep note**
Tasks/Maintenance migration MUST apply the same `value || null` normalization for: `tasks.due_date` (DATE NOT NULL), `tasks.due_time` (TIME), `maintenance_tasks.due_date` (DATE), `maintenance_tasks.site` (TEXT NOT NULL CHECK). Added to the Phase 4 Action Map TODO.

---

## Phase 3 — Post-completion bug fix #2 (2026-05-25) — TIME empty-string

**Bug reported in browser:**
After the Radix Select fix, OrderFormDialog opens and the form is fillable, but saving returns Supabase 400:
`invalid input syntax for type time: ""`

**Root cause**
[OrderFormDialog.jsx](adventure-ops-pro/src/components/orders/OrderFormDialog.jsx) `handleSubmit` spreads `form` directly into the Supabase payload:
```js
const data = { ...form, activity_id: ..., instructor_id: ..., num_participants: ... };
```
This means every form field reaches the DB as-is. `form.start_time` and `form.end_time` default to `""` (the empty `Select` state) and stay `""` unless the user picks a time slot. Postgres `TIME` columns reject `""` → 400 on both INSERT and UPDATE.

**Column audit vs current normalization (`001_schema.sql` orders table):**

| Column | DB type | Nullable | Previously normalized? | Risk if empty string sent |
|---|---|---|---|---|
| `activity_id` | UUID | yes | ✅ `|| null` | rejected (invalid UUID) — already fixed |
| `instructor_id` | UUID | yes | ✅ sentinel → null | rejected — already fixed |
| `activity_date` | DATE | NO | ❌ | rejected; `required` input prevents in practice but no defense-in-depth |
| `start_time` | TIME | yes | ❌ | **rejected — caused this bug** |
| `end_time` | TIME | yes | ❌ | **rejected — caused this bug** |
| `num_participants` | INT NOT NULL | NO | ✅ `Number() || 0` | always sends 0 fallback |
| `price_per_person` | NUMERIC | yes | ✅ `Number() || 0` | sends 0 (acceptable) |
| `total_price` | NUMERIC | yes | ✅ `Number() || 0` | sends 0 (acceptable) |
| `status` | TEXT CHECK | NO | ✅ default `ממתין לאישור` | never empty |
| `payment_status` | TEXT CHECK | yes | ✅ default `לא שולם` | never empty |
| all `client_*`, `organization`, `billing_*`, `notes` | TEXT | yes | n/a | `""` is valid TEXT — no issue |

So the bug is scoped to `start_time` + `end_time`. Same `data` object is used for both INSERT and UPDATE → both flows affected, both fixed by one change.

**Fix applied** — [adventure-ops-pro/src/components/orders/OrderFormDialog.jsx](adventure-ops-pro/src/components/orders/OrderFormDialog.jsx) `handleSubmit`:
```js
activity_date: form.activity_date || null,  // defense-in-depth (input is required)
start_time:    form.start_time   || null,  // primary fix
end_time:      form.end_time     || null,  // primary fix
```
Comment added explaining the Postgres TIME/DATE empty-string rejection.

**Scope check** — other dialogs (`ActivityFormDialog`, `InstructorFormDialog`, `QuoteFormDialog`, `TaskFormDialog`, `Maintenance.jsx` inline form): no other Vite-loaded form currently sends to a Supabase TIME/DATE/UUID column with the same `...form` spread risk that wasn't already normalized. Re-check during Phase 4 (Tasks/Maintenance touch `due_date` DATE + `due_time` TIME) before migrating those writers.

**What was tested**
- ✅ Vite boots; `HTTP 200` on `/src/components/orders/OrderFormDialog.jsx` after fix.
- ✅ `grep -i base44` on `OrderFormDialog.jsx` → **0 matches** (no Base44 reintroduced).
- ✅ Single payload path → fix covers both INSERT and UPDATE.

**Browser verification needed (you)**
- Create a new order **without** picking start/end times → save succeeds, row appears.
- Create a new order **with** start + end times picked → save succeeds, times persist correctly.
- Edit an existing order, clear the times → save succeeds, DB shows `start_time/end_time = NULL`.
- Edit an existing order with times set, leave them → save succeeds, times unchanged.
- Edit/save the seeded orders (which all have times set) → no regression.

**Files changed:** [adventure-ops-pro/src/components/orders/OrderFormDialog.jsx](adventure-ops-pro/src/components/orders/OrderFormDialog.jsx) only.

**PROGRESS.md updated?** Yes (this section).

---

## Phase 3 — Post-completion bug fix (2026-05-25)

**Bug reported in browser:**
`Uncaught Error: <Select.Item /> must have a value prop that is not an empty string`. Triggered on opening Orders create/edit dialog → entire form fails to render.

**Root cause**
Radix UI `Select` reserves the empty-string `value` to represent the unselected state. Any `<SelectItem value="">` is therefore forbidden. [OrderFormDialog.jsx:202](adventure-ops-pro/src/components/orders/OrderFormDialog.jsx#L202) had `<SelectItem value="">ללא מדריך</SelectItem>` so the instructor picker could render a "no instructor" option. Radix throws as soon as the SelectContent mounts, killing the dialog.

**Scope of bug** — only one site. Codebase-wide grep `SelectItem\s+value\s*=\s*[""']{2}` returned a single match. All other `SelectItem value={x}` use hardcoded enum arrays or uuid IDs — none can ever be empty.

**Fix** — [OrderFormDialog.jsx](adventure-ops-pro/src/components/orders/OrderFormDialog.jsx):
1. Added `NO_INSTRUCTOR = "__none__"` sentinel constant (with comment explaining the Radix constraint).
2. `emptyForm.instructor_id`: `""` → `NO_INSTRUCTOR` so the new-order picker shows "ללא מדריך" selected by default.
3. Order-load mapping: `order.instructor_id || ""` → `order.instructor_id ?? NO_INSTRUCTOR` so existing orders with `instructor_id = NULL` display the same "ללא מדריך" option as selected.
4. `<SelectItem value="">ללא מדריך</SelectItem>` → `<SelectItem value={NO_INSTRUCTOR}>ללא מדריך</SelectItem>`.
5. `handleSubmit` UUID-coercion: `form.instructor_id || null` → `(form.instructor_id && form.instructor_id !== NO_INSTRUCTOR) ? form.instructor_id : null` so the sentinel never leaks to Postgres (`__none__` is not a valid UUID).
6. `activity_id` left as-is — that picker has no "none" option (activity is required for non-task orders); the existing empty-string → null coercion still works because no `SelectItem` carries an empty value for it.

**What was tested**
- ✅ Grep across `src/` for `<SelectItem value="">` → **0 matches** post-fix.
- ✅ Vite boots; `HTTP 200` on `/src/components/orders/OrderFormDialog.jsx` after fix.
- ✅ Phase 2 + 3 file grep `-i base44` on Activities, ActivityFormDialog, Instructors, InstructorFormDialog, OrderFormDialog still **0 matches** — no Base44 reintroduced.

**Not yet verified (browser pass)** — the user is to confirm:
- Clicking "הזמנה חדשה" opens the dialog without the Radix error.
- Editing an existing order opens the dialog and the activity + instructor pickers are populated.
- Picking "ללא מדריך" then saving persists `instructor_id = NULL`.
- Existing orders with `instructor_id = NULL` (e.g. the seeded "מועדון טיפוס תל אביב" or any unassigned one) load with "ללא מדריך" pre-selected in the picker.

**Files changed:** [adventure-ops-pro/src/components/orders/OrderFormDialog.jsx](adventure-ops-pro/src/components/orders/OrderFormDialog.jsx) only.

**PROGRESS.md updated?** Yes (this section).

---

## Phase 3 completion log

**Date:** 2026-05-25

**Rule B validation**
- Cross-checked `instructors` columns (`001_schema.sql`) vs `base44/entities/Instructor.jsonc` vs current UI (`Instructors.jsx`, `InstructorFormDialog.jsx`, `OrderFormDialog.jsx`, `Orders.jsx`, `InstructorEmailDialog.jsx`). Same column names everywhere: `id`, `full_name`, `phone`, `email`, `specialties` (text[]), `notes`, `status`. Required fields (`full_name`, `phone`) consistent with form `required` attributes. Status enum (`פעיל / לא פעיל`) matches CHECK constraint. Specialties enum is enforced in the UI only (Supabase column is plain `text[]`, slightly looser — no drift impact).
- Ordering: Base44 `.list("-created_date")` → Supabase `.order('created_at', { ascending: false })`.
- Downstream consumers already use Supabase ([Orders.jsx:40](adventure-ops-pro/src/pages/Orders.jsx#L40), [OrderFormDialog.jsx:44](adventure-ops-pro/src/components/orders/OrderFormDialog.jsx#L44)) with the same field names. **Zero downstream change required.**
- [InstructorEmailDialog.jsx](adventure-ops-pro/src/components/orders/InstructorEmailDialog.jsx) only reads props (`instructor.full_name/phone/email`); no SDK calls in that file.

**Actions taken**
1. [adventure-ops-pro/src/pages/Instructors.jsx](adventure-ops-pro/src/pages/Instructors.jsx) — replaced `base44.entities.Instructor.list/delete` with `supabase.from('instructors').select/delete`. Added `toast` for error/success on delete + load failures. Removed unused `CheckCircle` icon import.
2. [adventure-ops-pro/src/components/instructors/InstructorFormDialog.jsx](adventure-ops-pro/src/components/instructors/InstructorFormDialog.jsx) — replaced `base44.entities.Instructor.create/update` with `supabase.from('instructors').insert/update`. Added `toast` on save error + success. Wrapped in `try/finally` so `saving` always resets.

**What was tested**
- ✅ Case-insensitive `grep` for `base44` on both files → **0 matches**.
- ✅ Vite dev server boots; `HTTP 200` on `/src/pages/Instructors.jsx` and `/src/components/instructors/InstructorFormDialog.jsx`.
- ✅ Rule A acceptance criteria 1, 8 verified by code review + grep.

**What is NOT tested (manual browser pass)**
- Acceptance criteria 2–7: open `/instructors`, see 4 seeded rows, create a new instructor, edit one, delete one, confirm the new instructor appears in OrderFormDialog's picker and InstructorEmailDialog lookup. Needs logged-in browser.
- RLS write permission for `admin` on `instructors` table (`003_rls.sql` grants admin CRUD; promotion happened in Phase 1, should work).

**What still does not work**
- Base44 SDK 404 console noise — unchanged, Phase 6 target.
- IDE TS-on-JSX diagnostics — pre-existing across codebase, Phase 6 cleanup.

**PROGRESS.md updated?** Yes (Action Map written before code, completion log written after, status row + phase table flipped to ✅).

**Next recommended phase:** Phase 4 — Migrate Tasks + Maintenance. This is the phase that finally lights up Schedule's task/maintenance lanes (Schedule already reads Supabase; writers still hit Base44). Two pages + two dialogs in scope.

---

## Phase 3 — Instructors — Screen Action Map

**Pages:** [/instructors](adventure-ops-pro/src/pages/Instructors.jsx) and its dialog [InstructorFormDialog.jsx](adventure-ops-pro/src/components/instructors/InstructorFormDialog.jsx).

### Visible buttons / actions
- Header `מדריך חדש` button (Plus icon) → opens dialog in create mode.
- Empty-state `הוסיפי מדריך ראשון` button → opens dialog in create mode.
- Per card: Pencil icon → opens dialog in edit mode with that instructor.
- Per card: Trash icon → opens `AlertDialog` "מחיקת מדריך" confirm → on confirm, deletes the row.
- (Header subtitle shows `<N> מדריכים במערכת` — pure render of `instructors.length`, no action.)

### Forms / dialogs
- `InstructorFormDialog`. Fields: `full_name*`, `phone*`, `email`, `specialties` (multi-checkbox: `הפעלת פארק / יום גיבוש / חוג טיפוס / סדנת שטח`), `notes`, `status` (select: `פעיל / לא פעיל`).
- `AlertDialog` for delete confirmation.

### Data loaded
- `SELECT * FROM instructors ORDER BY created_at DESC`.

### Data created / updated / deleted
- **Create:** INSERT into `instructors` with all form fields (`specialties` stays a `text[]`).
- **Update:** UPDATE `instructors` SET ... WHERE id = ?.
- **Delete:** DELETE FROM `instructors` WHERE id = ?.
- No file uploads, no JSONB columns.

### Cross-screen sync (read-only consumers of instructors)
- [Orders.jsx:40](adventure-ops-pro/src/pages/Orders.jsx#L40) — `supabase.from('instructors').select('*')` to back the `InstructorEmailDialog` lookup (`instructors.find(i => i.id === emailOrder?.instructor_id)`).
- [OrderFormDialog.jsx:44](adventure-ops-pro/src/components/orders/OrderFormDialog.jsx#L44) — `supabase.from('instructors').select('*').eq('status', 'פעיל')` to populate the instructor picker for new/edited orders.
- [InstructorEmailDialog.jsx](adventure-ops-pro/src/components/orders/InstructorEmailDialog.jsx) — receives `instructor` as a prop; reads `full_name`, `phone`, `email` only. Already Supabase-compatible.
- All consumers expect fields: `id`, `full_name`, `phone`, `email`, `status`. **Identical to Supabase columns. Zero downstream change needed.**

### Rule B — schema drift check
- Base44 `Instructor` entity (`base44/entities/Instructor.jsonc`) properties: `full_name`, `phone`, `email`, `specialties[]`, `notes`, `status`. Required: `full_name`, `phone`. Status enum: `פעיל / לא פעיל` (default `פעיל`). Specialties enum: `הפעלת פארק / יום גיבוש / חוג טיפוס / סדנת שטח`.
- Supabase `instructors` columns (`001_schema.sql`): same names, same enums (status CHECK constraint matches; specialties stored as `text[]` without enum constraint — slightly looser, no drift impact).
- Ordering: Base44 `.list("-created_date")` → Supabase `.order('created_at', { ascending: false })` (column name differs).
- **No drift found.** Migration is pure SDK swap.

### Acceptance criteria
1. `/instructors` opens without errors when logged in as admin.
2. Page shows the 4 seeded instructors (`דניאל כהן`, `נועה לוי`, `תומר אבני`, `מאיה ברק`); status badge + specialty pills render with correct colors; subtitle shows `4 מדריכים במערכת`.
3. Clicking `מדריך חדש` opens an empty dialog. Submitting valid `full_name` + `phone` persists to `public.instructors` and the new card appears at the top (DESC by `created_at`) without page reload.
4. Editing an instructor via pencil pre-fills all fields including specialties checkboxes, saves with UPDATE, re-renders updated values.
5. Deleting via trash → confirm shows the row disappears. (Note: if the instructor is referenced by orders, `instructor_id` becomes `NULL` per the FK's `ON DELETE SET NULL`; orders remain.)
6. After creating a new active instructor, reload `/orders` → the new instructor appears in the OrderFormDialog instructor picker without code change.
7. After assigning an instructor to an order, clicking the mail icon on the Orders page opens `InstructorEmailDialog` showing the correct instructor name/phone/email.
8. **Zero `base44` references remain** (case-insensitive grep) in `Instructors.jsx` or `InstructorFormDialog.jsx`.

---

## Phase 2 completion log

**Date:** 2026-05-24

**Rule B validation**
- Cross-checked `activities` columns in `001_schema.sql` vs `base44/entities/Activity.jsonc` vs current UI usage. All shared field names align exactly: `name`, `category`, `description`, `duration_hours`, `max_participants`, `price_per_person`, `image_url`, `images` (TEXT[]), `status`.
- Confirmed downstream consumers ([Dashboard.jsx:21](adventure-ops-pro/src/pages/Dashboard.jsx#L21), [Orders.jsx:39](adventure-ops-pro/src/pages/Orders.jsx#L39), [Quotes.jsx:43](adventure-ops-pro/src/pages/Quotes.jsx#L43), [QuoteFormDialog.jsx:29](adventure-ops-pro/src/components/quotes/QuoteFormDialog.jsx#L29), [Schedule.jsx:51](adventure-ops-pro/src/pages/Schedule.jsx#L51)) already call `supabase.from('activities')` with these field names. **Zero downstream change required.**
- [CashRegister.jsx:20](adventure-ops-pro/src/pages/CashRegister.jsx#L20) still on Base44 — known temporary catalog-mismatch, addressed in Phase 5.
- Ordering: `.list("-created_date")` (Base44) → `.order('created_at', { ascending: false })` (Supabase column name differs).

**Actions taken**
1. [adventure-ops-pro/src/pages/Activities.jsx](adventure-ops-pro/src/pages/Activities.jsx) — replaced `base44.entities.Activity.list/delete` with `supabase.from('activities').select/delete`. Added `toast` error/success messages.
2. [adventure-ops-pro/src/components/activities/ActivityFormDialog.jsx](adventure-ops-pro/src/components/activities/ActivityFormDialog.jsx):
   - Replaced `base44.entities.Activity.create/update` with `supabase.from('activities').insert/update`.
   - Replaced `base44.integrations.Core.UploadFile` with `supabase.storage.from('activity-images').upload(...) + getPublicUrl(...)`. Path scheme: `<uuid>-<sanitized-filename>` (flat bucket layout).
   - Added per-file `toast.error` on upload failure (graceful partial success — successful uploads still attach).
   - Added a `sanitizeFileName` helper (strips non-ASCII, caps at 60 chars) so Hebrew/Arabic file names don't break the Storage path.
   - Removed unused `Upload` icon import.

**What was tested**
- ✅ `grep -i base44` returns **zero matches** in both `Activities.jsx` and `ActivityFormDialog.jsx`.
- ✅ Vite dev server boots; `HTTP 200` on `/`, `/src/main.jsx`, `/src/App.jsx`, `/src/pages/Activities.jsx`, `/src/components/activities/ActivityFormDialog.jsx`.
- ✅ Rule A acceptance criteria 1, 2, 9 verified by code review. Criterion 9 (no Base44 refs) verified by grep.

**What is NOT tested (manual browser pass)**
- Acceptance criteria 3–8: actually opening the dialog, creating/editing/deleting an activity, uploading an image, verifying the new activity appears in OrderFormDialog without reload. Needs logged-in browser session.
- Supabase Storage upload happy path — relies on RLS policies in `004_storage.sql` permitting admin to upload to `activity-images`. Admin promotion happened in Phase 1, so this should work; verify by uploading once.
- IDE TS diagnostics fired on the .jsx files (e.g. `useState([])` → `never[]`). These are **pre-existing** noise across the codebase (Orders.jsx, Quotes.jsx etc. have identical patterns) — not introduced by Phase 2. Tracked but not blocking; clean-up belongs in Phase 6.

**What still does not work**
- CashRegister still reads activities from Base44 — addressed in Phase 5. Until then, newly-created activities won't appear in the cash-register grid.
- Image *deletion* from Supabase Storage is not implemented — the per-image `X` button only removes the URL from the activity's `images[]` array; the file stays in the bucket. Tracked as a non-blocking TODO; same behavior as the original Base44 flow effectively (since deletions were also dropped there). Can address in Phase 6 cleanup if desired.

**PROGRESS.md updated?** Yes (Action Map written before code, completion log written after, status table flipped, phase table flipped).

**Next recommended phase:** Phase 3 — Migrate Instructors. Smaller scope (CRUD only, no Storage, no JSONB). Per Rule A, Phase 3 starts with writing the Instructors Screen Action Map.

---

## Phase 2 — Browser verification follow-up (2026-05-24)

**Verified in-browser:** `/activities` opens, 6 seeded activities render, no Activities-side runtime errors.

**Issue 1 — Base44 SDK 404s in console**
- Confirmed via re-grep: `Activities.jsx` and `ActivityFormDialog.jsx` contain **zero** `base44` references (case-insensitive).
- Traced the 404s (`GET /api/apps/null/entities/User/me`, `Base44 SDK Error 404`, analytics-batch 404) to global sources unrelated to Activities:
  - `@base44/vite-plugin` in [vite.config.js](adventure-ops-pro/vite.config.js) injects sandbox + HMR + analytics scripts at dev-server time; analytics tracker fires regardless of which page is loaded.
  - [base44Client.js](adventure-ops-pro/src/api/base44Client.js) constructs the SDK with `appId` from `VITE_BASE44_APP_ID` (unset → `null`). The SDK then issues `GET /api/apps/null/entities/User/me` whenever it gets initialized.
  - 11 importers still pull `base44Client.js`: 7 unmigrated pages (Instructors, Tasks, Maintenance, Pricing, CashRegister, DailySalesReport, PageNotFound) + 4 dialogs (InstructorFormDialog, TaskFormDialog, LinkToLeadQuoteDialog, ReceiptScreen).
- **Verdict:** legacy noise. Not introduced or aggravated by Phase 2. Resolves in Phase 6 when the SDK + Vite plugin get removed. Logged as a checkbox in "Known bugs" above so it's tracked across sessions.

**Issue 2 — `StorageApiError: The object exceeded the maximum allowed size`**
- Root cause: bucket `activity-images` has a 5 MB `file_size_limit` (from [supabase/migrations/004_storage.sql](supabase/migrations/004_storage.sql)). Previous code only handled the server-side rejection in console; no user-facing message.
- Fix in [ActivityFormDialog.jsx](adventure-ops-pro/src/components/activities/ActivityFormDialog.jsx):
  - Added `MAX_IMAGE_BYTES = 5 MB` and `ALLOWED_IMAGE_MIME = {jpeg, png, webp, gif}` constants matching the bucket policy.
  - Added a `formatMB(bytes)` helper.
  - `handleFilesChange` now validates each file BEFORE upload:
    - Wrong MIME type → toast `<name>: סוג קובץ לא נתמך (רק JPEG / PNG / WebP / GIF)`, skip file.
    - Size > 5 MB → toast `<name>: גודל X.XMB חורג מהמותר (עד 5.0MB)`, skip file.
  - If the server still rejects (e.g. policy mismatch), the catch branch now parses the error message and surfaces a Hebrew toast (`חרג מהגודל המותר` / `סוג קובץ נדחה`) instead of failing silently in console.
  - On success: per-file `toast.success` (`תמונה הועלתה` / `N תמונות הועלו`).
  - Hardened the file picker `accept` attribute to `image/jpeg,image/png,image/webp,image/gif` (was `image/*`) so the OS picker filters in line with the bucket policy.

**Boot test after fix:** Vite dev server boots; `HTTP 200` on `/src/pages/Activities.jsx` and `/src/components/activities/ActivityFormDialog.jsx`.

**Still deferred (not fixed in this iteration)**
- Base44 SDK 404 noise — Phase 6.
- Image deletion from the Storage bucket when the user removes a URL from `activities.images[]` — non-blocking; existing behavior unchanged.
- IDE TS-on-JSX diagnostic noise (`useState([])` → `never[]`, implicit-any on JSX props) — Phase 6 cleanup.

---

## Phase 2 — Activities — Screen Action Map

**Pages:** [/activities](adventure-ops-pro/src/pages/Activities.jsx) and its dialog [ActivityFormDialog.jsx](adventure-ops-pro/src/components/activities/ActivityFormDialog.jsx).

### Visible buttons / actions
- Header `פעילות חדשה` button (Plus icon) → opens dialog in create mode.
- Empty-state `הוסיפי פעילות ראשונה` button → opens dialog in create mode.
- Per card: Pencil icon → opens dialog in edit mode with that activity.
- Per card: Trash icon → opens confirm AlertDialog → on confirm, deletes the row.

### Forms / dialogs
- `ActivityFormDialog`. Fields: `name*`, `category*` (select: `הפעלת פארק / יום גיבוש / חוג טיפוס / סדנת שטח`), `description`, `duration_hours*` (number, step 0.5), `max_participants*` (int), `price_per_person*` (int), `images` (multi-upload, first uploaded becomes `image_url` primary), `status` (select: `פעיל / לא פעיל`).
- `AlertDialog` for delete confirmation.

### Data loaded
- `SELECT * FROM activities ORDER BY created_at DESC`.

### Data created / updated / deleted
- **Create:** INSERT into `activities` with all form fields (numeric coercion for `duration_hours`/`max_participants`/`price_per_person`).
- **Update:** UPDATE `activities` SET ... WHERE id = ?.
- **Delete:** DELETE FROM `activities` WHERE id = ?.
- **Image uploads:** upload each file to Supabase Storage bucket `activity-images`, push returned public URL into `form.images[]`, and set `form.image_url` to the first one if not already set.

### Cross-screen sync (read-only consumers of activities)
- [Dashboard.jsx:21](adventure-ops-pro/src/pages/Dashboard.jsx#L21) — `supabase.from('activities').select('*')` to look up activity names for recent orders.
- [Orders.jsx:39](adventure-ops-pro/src/pages/Orders.jsx#L39) — same; powers the Orders table's "activity" column + the picker in OrderFormDialog.
- [Quotes.jsx:43](adventure-ops-pro/src/pages/Quotes.jsx#L43) — same; powers QuoteFormDialog's activity selector and the JSONB `selected_activities` shape.
- [QuoteFormDialog.jsx:29](adventure-ops-pro/src/components/quotes/QuoteFormDialog.jsx#L29) — independent fetch.
- [Schedule.jsx:51](adventure-ops-pro/src/pages/Schedule.jsx#L51) — joins activities to orders for the calendar.
- [CashRegister.jsx:20](adventure-ops-pro/src/pages/CashRegister.jsx#L20) — **still Base44**; addressed in Phase 5. Will be a temporary catalog-mismatch (CashRegister won't see newly-migrated activities until Phase 5).
- All downstream consumers already expect Supabase field names (`id`, `name`, `status`, `category`, `price_per_person`, `duration_hours`, `image_url`). **No downstream change needed.**

### Acceptance criteria (test against after migration)
1. `/activities` opens without errors when logged in as admin.
2. Page shows the 6 seeded activities; status badge + category color render; numeric fields render as `2 שעות`, `עד 30`, `₪60`.
3. Clicking `פעילות חדשה` opens an empty dialog.
4. Submitting a new activity persists to `public.activities` and the new card appears at the top of the list (DESC by `created_at`) without a page reload.
5. Editing an activity via pencil pre-fills the dialog, saves with UPDATE, and re-renders updated values.
6. Deleting an activity via trash → confirm shows the row disappears.
7. Multi-image upload: selecting 2 files uploads both to the `activity-images` Storage bucket; the first uploaded becomes the primary `image_url`; the `הגדר ראשית` swap works; the `X` per-image removal works (doesn't delete from Storage — that's a tracked TODO, not a blocker).
8. After creating a new activity, reload [/orders](adventure-ops-pro/src/pages/Orders.jsx) → the new activity appears in the OrderFormDialog activity picker without code change.
9. **Zero `@base44`/`base44.entities.Activity`/`base44.integrations` references remain** in `Activities.jsx` or `ActivityFormDialog.jsx`.

---

## Phase 1 completion log

**Date:** 2026-05-24

**Rule B validation (before code)**
- Cross-checked Supabase `001_schema.sql` columns vs `base44/entities/*.jsonc` field lists for every table I seeded.
- Confirmed key drifts and used the **Supabase shape**, not the Base44 shape, in the seed:
  - `orders.activity_id`/`instructor_id` (uuid FK) — used activity/instructor lookups by name.
  - Order/quote/maintenance site enums: `עכו / טבריה / נוף הגליל / שטח`.
  - Lead site enum (different!): `עכו / טבריה / שטח / ויה פרטה` — *no* `נוף הגליל`.
  - Quote `selected_activities` JSONB shape: `[{activity_id, activity_name, price_per_person, duration_hours, image_url}]`.
  - Sale `items` JSONB shape: `[{id, name, qty, customPrice}]`.
  - Lead status seed values restricted to `'פתוח'`/`'לא רלוונטי'` (valid in both pre-006 and post-006 constraint) for safety; 006 turned out to be applied so future leads can use `'נשלח'`/`'נסגר'` too.

**Actions taken**
1. Authored [supabase/seed.sql](supabase/seed.sql) — canonical idempotent SQL (uses `WHERE NOT EXISTS` on natural keys; safe to paste into Dashboard SQL Editor as a fallback).
2. Authored [scripts/run-seed.mjs](scripts/run-seed.mjs) — Node + built-in `fetch`, zero npm dependencies. Reads service-role key from `../.env.local`. Promotes profile, probes 006, seeds 9 tables, reports counts.
3. Ran the seed once with `node scripts/run-seed.mjs`. Result: profile promoted, 006 detected as applied, 44 business rows inserted across 9 tables.
4. Started Vite dev server, confirmed `HTTP 200` on `/`, `/src/main.jsx`, `/src/App.jsx`, `/src/pages/Dashboard.jsx`. Stopped server.

**What was tested**
- ✅ Service-role connection works via PostgREST.
- ✅ `profiles` row promoted to `admin`.
- ✅ Migration 006 confirmed applied (probe insert with `status='נשלח'` succeeded).
- ✅ Row counts after seed match expected totals.
- ✅ Vite dev server boots and serves the app + transforms JSX modules without crashing.

**What is NOT tested (needs manual browser pass)**
- Actual screen rendering — Dashboard KPIs, Orders list, Quotes list, Leads list, Schedule calendar with seeded data. Requires a logged-in browser session; can't be automated cheaply.
- RLS read paths from the frontend client (the seed used service-role which bypasses RLS). If the admin promotion is correct, frontend reads should work; verify by login.
- Base44-dependent pages (Activities/Instructors/Tasks/Maintenance/Pricing/CashRegister/DailySalesReport) — still expected to be broken until Phase 2+.

**What still does not work**
- All 7 Base44-backed pages — by design, addressed in Phases 2–6.
- Tasks/Maintenance writes from the UI still go to Base44 (until Phase 4). The seeded `tasks` + `maintenance_tasks` rows in Supabase WILL appear in `Schedule`, but any new task created via `/tasks` won't.

**PROGRESS.md updated?** Yes (this entry + status table + counts + Phase 0 known-issue checkbox).

**Next recommended phase:** Phase 2 — Migrate Activities (highest fan-out: unblocks Orders/Quotes/Schedule/CashRegister catalogs + exercises the `activity-images` Storage bucket). Per Rule A, Phase 2 starts by writing the Activities Screen Action Map.

---

## Phase 0 completion log

**Date:** 2026-05-24

**Actions taken**
1. Moved `adventure-ops-pro/supabase/migrations/006_fix_leads_status.sql` → `shafan-hasela/supabase/migrations/006_fix_leads_status.sql`.
2. Removed empty `adventure-ops-pro/supabase/migrations/` and parent `adventure-ops-pro/supabase/` folders.
3. Stripped `SUPABASE_SERVICE_ROLE_KEY` (and its danger comment) from `adventure-ops-pro/.env`. Frontend env now exposes only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Created `shafan-hasela/.env.local` (root) and parked the service-role key there for future seed scripts.
5. Deleted duplicate root `shafan-hasela/.env`.
6. Created this `PROGRESS.md` at the project root.

**What was tested**
- File-system: 006 present in root migrations folder; old folder removed; root `.env` gone; `.env.local` present; frontend `.env` contains only VITE_* vars.
- Dev-server boot: *(to be verified — see Verification below)*

**What still doesn't work**
- Anything that was broken at audit time. Phase 0 was structural cleanup only — zero behavior change to the running app.

**Next recommended phase:** Phase 1 — Seed demo data (promote profile to `admin` + write idempotent `supabase/seed.sql`).

---

## QA checklist (per phase exit)

- [ ] `npm run dev` boots without console errors.
- [ ] All sidebar nav items open without crashing.
- [ ] CRUD verified on every page touched this phase.
- [ ] Cross-screen sync verified (e.g. new activity appears in OrderFormDialog picker).
- [ ] No new `@base44` imports introduced; pages migrated this phase have zero `@base44` references.
- [ ] `PROGRESS.md` updated (this file).
- [ ] User notified and approval obtained before starting next phase.
