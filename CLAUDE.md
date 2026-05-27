# CLAUDE.md — Project Guidance for Future Claude Sessions

> **First action every session:** read `PROGRESS.md` to see the active phase, what's done, and what's pending. Then read this file for the operating rules. Then `audit.md` only if you need historical context.

---

## What this project is

**Shafan Hasela** is a Hebrew RTL operations app for an Israeli adventure-activities business. The original MVP was built on **Base44** (a low-code platform) and runs at app ID `69ca2dc3748aeb9c23109245`. Codex exported the Base44 app as a Vite + React project into `adventure-ops-pro/` (since renamed to **`app/`** in Phase 7). We are now recovering that MVP off Base44 onto a **Supabase** backend (`divzxsynczeifkpnpupl`).

This is **MVP recovery work, local-only**. Not a greenfield build. The Base44 export is the source of truth for screens, components, business flows, and entity schemas — never re-architect them.

---

## Current goal

Get to a complete, working local MVP that behaves like the original Base44 app:

- Every screen opens without runtime errors.
- Every core screen shows realistic data (seeded if no real export exists).
- CRUD works on every sidebar page.
- Cross-screen sync works (Lead → Quote → Order, Activity → catalogs, Tasks/Maintenance → Schedule, Sale → DailySalesReport).
- **Zero** Base44 imports remain in the running frontend.

**Out of scope** (do not work on these): payments / Salika, AI chatbot, WhatsApp bot, production deployment, advanced Supabase tuning (storage policies, index optimization), real `sendQuoteEmail` Edge Function. The email button stays disabled with a Hebrew `אימייל לא זמין כרגע — בבנייה` tooltip.

---

## Where to look first

| Need to understand… | Read this |
|---|---|
| What phase we're in, what's next | `PROGRESS.md` (root) |
| Operating rules + don'ts | This file |
| Why the project is in this state | `audit.md` (root) — created 2026-05-21 |
| Original screen designs + entity shapes | `reference/base44/` — **historical reference only, do not modify** |
| Active frontend code | `app/src/` — all frontend work happens here |
| Supabase schema | `supabase/migrations/001`–`006` (root `supabase/`) |
| The original full plan | `C:\Users\nadav\.claude\plans\claude-planning-prompt-sleepy-moler.md` |

---

## Folder layout

Phase 7 restructure is **complete**. Final structure:
```
shafan-hasela/
├── CLAUDE.md                            ← this file
├── PROGRESS.md                          ← session-to-session state
├── audit.md                             ← historical audit
├── .env.local                           ← service-role key (NEVER bundle, NEVER commit)
├── scripts/                             ← run-seed.mjs (Node seed runner)
├── supabase/
│   └── migrations/                      ← 001–006 (canonical, single home)
├── reference/base44/                    ← Base44 export, HISTORICAL REFERENCE ONLY (do not modify)
│   ├── entities/                        ← canonical entity schemas (Activity, Order, etc.)
│   └── functions/                       ← sendQuoteEmail (Deno) — not in use
└── app/                                 ← the active Vite frontend (was adventure-ops-pro/)
    ├── .env                             ← VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY only
    ├── src/                             ← active frontend code — all work happens here
    └── package.json
```

- **`app/`** is the active frontend (renamed from `adventure-ops-pro/` in Phase 7). **All active frontend work happens inside `app/`.**
- **`reference/base44/`** (moved from `adventure-ops-pro/base44/`) is read-only historical reference for the original Base44 screens + entity schemas.
- **Dev command:** `npm run dev --prefix app`.

---

## Important files

**Reference (do not modify):**
- `reference/base44/entities/*.jsonc` — canonical entity schemas. Compare against Supabase migrations before any field-name decision.
- `reference/base44/functions/sendQuoteEmail/entry.ts` — original email function. Future Edge Function port lives here.
- `audit.md` — frozen snapshot from 2026-05-21.

**Always-read at session start:**
- `PROGRESS.md` — drives every session.

**Active app code (all under `app/`):**
- `app/src/App.jsx` — routes.
- `app/src/components/Layout.jsx` — sidebar + role gating.
- `app/src/lib/AuthContext.jsx` — auth + role resolution.
- `app/src/api/supabaseClient.js` — the configured client; **always import from here, do not re-create**.
- (`app/src/api/base44Client.js` — the Base44 SDK shim — was deleted in Phase 6; the SDK is fully unplugged.)

**Schema:**
- `supabase/migrations/001_schema.sql` — 10 business tables.
- `supabase/migrations/002_functions.sql` — `get_user_role()`, `is_admin()`, `is_admin_or_ops()`, `get_my_instructor_id()`, `handle_new_user()` trigger, compute triggers, views `dashboard_stats` / `instructor_schedule` / `sales_summary`. **Prefer these helpers + views over re-implementing in JS.**
- `supabase/migrations/003_rls.sql` — RLS for all 10 tables across `admin` / `operations` / `instructor` roles.
- `supabase/migrations/004_storage.sql` — buckets `activity-images` (public, 5 MB) + `documents` (private, 10 MB).
- `supabase/migrations/006_fix_leads_status.sql` — proves enum drift is real; expect more enum-drift fixes as `007_*.sql`, `008_*.sql`.

---

## Operating rules (enforced every phase)

### Rule A — Screen Action Map before any screen migration
Before changing a page's code, write a short Action Map for it (into `PROGRESS.md` under that phase, or `docs/screens/<screen>.md`):
- Visible buttons / actions
- Forms / dialogs (and the fields each collects)
- Data loaded (tables / views / filters / joins)
- Data created / updated / deleted (target table + fields)
- Cross-screen sync (which other screens must reflect each change)
- Acceptance criteria (concrete, testable)

The Action Map is what you test against at the phase exit.

### Rule B — Validate Supabase migrations against three sources, not just themselves
The existing `001`–`006` are a strong starting point, **not** unquestionable truth. Before relying on any table:
1. Check `reference/base44/entities/<Entity>.jsonc` for the original field set + enums.
2. Check current frontend usage in `*.jsx` files.
3. Check known mismatches (see "Known mismatches" below).

If you find a real mismatch, prefer a new numbered migration (`007_*.sql`) over editing `001` in place. **Never silently change frontend code to match a wrong schema** — fix the schema or fix the UI consciously, and record the decision in `PROGRESS.md`.

### Rule C — Stop after each phase and report
Phases are **explicitly gated**. After finishing a phase:
1. Update `PROGRESS.md`.
2. Report: what changed, files changed, what was tested, what's still broken, next recommended phase.
3. **Wait for user approval before starting the next phase.** Never chain phases.

### Rule D — Definition of "MVP done"
See "Current goal" above. The rule is binary — if any sidebar page crashes or any Base44 import remains, MVP is not done.

---

## Don'ts

- **Don't** treat the existing Supabase migrations as gospel without applying Rule B.
- **Don't** modify anything inside `reference/base44/`. It's the historical reference.
- **Don't** relocate `app/` or `reference/base44/` — the Phase 7 restructure is complete and final.
- **Don't** put the service-role key (or any non-`VITE_*` secret) back into `app/.env`. The key lives in `shafan-hasela/.env.local` (root, outside Vite's reach).
- **Don't** put any secret, API key, JWT, or service-role token into `PROGRESS.md`, `CLAUDE.md`, or anything that might be committed.
- **Don't** chain phases without an explicit user "go".
- **Don't** create new abstractions / helper layers / "service" wrappers around `supabase.from(...)` calls. Keep the migration straightforward: replace `base44.entities.X.list()` with `supabase.from('x').select(...)` at the call site. No premature architecture.
- **Don't** delete `audit.md`, `reference/base44/`, `PROGRESS.md`, this file, or the `.env.local`.
- **Don't** generate `order_number` / `quote_number` / `receipt_number` in JS. The DB has `*_seq` sequences via `001_schema.sql` — let them populate via DEFAULTs.
- **Don't** compute `total_price` or `final_price` in JS. The DB has `compute_order_total()` and `compute_quote_final_price()` triggers from `002_functions.sql`.
- **Don't** build the `sendQuoteEmail` Edge Function. Disable the button with the Hebrew tooltip and move on.
- **Don't** add storage policy tuning, advanced indexes, or other Supabase deep-dive work unless explicitly asked.
- **Don't** translate the Hebrew UI strings to English.

---

## Known mismatches and recurring pitfalls

These have bitten the previous session; check before they bite again.

- **Field-name shape:** Base44 `Order.activity` (string) ↔ Supabase `orders.activity_id` (uuid FK). Same for `Order.instructor` ↔ `orders.instructor_id`. Migrating a screen requires renaming the field at every read/write site.
- **Site enum drift:** Base44 uses `טברייה` and `ויה פרטה`. Supabase + the current UI use `טבריה` and `נוף הגליל`. `006` fixed lead status, **not** sites. Audit before Phases 1, 4, 6 — if old strings appear anywhere, ship a `007_fix_site_enums.sql`.
- **Role enum mapping:** Supabase enum is `admin | operations | instructor`. Hebrew UI uses `admin | אחמ"ש | מדריך`. `Layout.jsx` maps between them. The single existing `profiles` row's role is unknown — if RLS blocks reads in Phase 1, promote it to `admin`.
- **`Quote.selected_activities` shape:** JSONB column holds an array of objects with `activity_id`, `activity_name`, `price_per_person`, `duration_hours`, `image_url`. Don't reshape it without checking every consumer.
- **Tasks / Maintenance write-path is broken right now.** Schedule reads from Supabase but Tasks/Maintenance pages still write to Base44 → the calendar's task/maintenance lanes will be empty until Phase 4.
- **Mojibake risk.** Some Hebrew strings appeared encoding-corrupted in audit output. When editing a file with Hebrew, confirm the result renders correctly in the browser, not just in the editor.
- **Lint baseline:** 9 files have unused-import warnings. They are cosmetic — don't chase them outside Phase 6.

---

## How to resume from `PROGRESS.md`

1. Read `PROGRESS.md` end-to-end. The "Phases" table shows the active phase. The "Phase N completion log" sections show what was done.
2. Find the most recent "Next recommended phase".
3. Confirm the user wants to proceed with that phase (don't assume).
4. Before any screen work, write the Screen Action Map (Rule A).
5. Before relying on any Supabase table, validate against `reference/base44/entities/` + frontend usage (Rule B).
6. Do the work.
7. Update `PROGRESS.md` (add a `Phase N completion log` entry).
8. Report back per Rule C. Stop.

---

## Verification quick reference

- **Boot:** `npm run dev --prefix app` then check `curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:5173/` returns `HTTP 200`.
- **Migrations applied?** Use the Supabase MCP tools or the dashboard. `006` should have constrained `leads.status` to `('פתוח', 'נשלח', 'נסגר', 'לא רלוונטי')`.
- **Base44 cleanup check (Phase 6):** grep the `app/src/` tree for `@base44`, `base44.entities`, `base44Client`, `base44.functions`, `base44.integrations` — all five should return zero matches.
- **Storage check:** the Supabase dashboard shows `activity-images` and `documents` buckets.

---

## Tooling notes

- This is a **Windows / PowerShell** environment. Bash is available via the Bash tool; PowerShell available too. There is **no git repo yet** — `git init` is a reasonable suggestion once Phase 0 lands.
- Vite default port: `5173`.
- The Supabase project is real. Schema/RLS/storage are deployed. Business tables are empty (except `profiles` = 1 row) as of audit time. Re-verify counts before assuming.
