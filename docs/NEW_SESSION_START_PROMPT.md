# NEW CLAUDE WINDOW — START PROMPT (paste this)

You are continuing work on **Shafan Hasela / Adventure Ops Pro**. Read `PROGRESS.md` (root) first, then `CLAUDE.md`. This block is the quick-start.

## Project overview
Hebrew RTL operations app for an Israeli adventure-activities business. Original Base44 MVP recovered onto a Supabase backend; now in post-MVP feature work, gated stage-by-stage.

## Infra / deployment
- Repo root: `C:\Users\nadav\OneDrive\Desktop\dev-projs\shafan-hasela\shafan-hasela-vercal` (Windows/PowerShell; Bash tool = real bash).
- Frontend: `app/` (Vite + React, JS). Dev `npm run dev --prefix app`; build `npx vite build` in `app/`.
- GitHub: `origin` = `trtech123/shafan-hasela-vercal`, branch `main` (commit direct to main). Vercel auto-deploys on push.
- Supabase ref `divzxsynczeifkpnpupl`. CLI = `npx supabase` only. **Migrations applied manually by the owner in the SQL Editor; latest = `020`.** Edge Function secrets via Dashboard. Owner runs deploys/migrations themselves (agent shell lacks `SUPABASE_ACCESS_TOKEN`).
- Secrets never in repo.

## Operating rhythm (important — follow exactly)
- **One feature per task, gated.** For each: read-only review → implement → `npx vite build` (expect EXIT=0) → report files changed + verify checklist.
- **If a migration is needed: STOP before push.** Give the owner the SQL + verification queries. They apply it, then say "commit and push" → you commit (one feature per commit) + push + report `git status -sb` + latest commit.
- **If no migration: build then commit + push** (still per the task's instruction).
- Migrations **must be idempotent**: `CREATE TABLE IF NOT EXISTS`, `DROP TRIGGER/POLICY IF EXISTS` before CREATE, seeds `ON CONFLICT DO NOTHING`. (019 failed once without this.)
- **Commit messages via Bash tool**: use multiple `-m` flags. NEVER `@'...'@` (that's PowerShell; bash injects a literal `@`).
- Verification I can do = build EXIT=0 + dev boot HTTP 200. Interactive click-through + migration apply = owner's.

## Current production state (all shipped + pushed, latest commit `37734d9`)
- **Roles**: admin / operations(אחמ"ש) / cashier(קופאי) / instructor(compat). Admin-only pages redirect non-admins. RLS via `is_admin()`/`is_admin_or_ops()`/`is_cashier()`.
- **Admin screens**: `/users` (create via `create-user` Edge Fn, delete via `delete-user`, inline role edit, self-demotion blocked), `/products` (CRUD + image, sites), `/templates` (editable message bodies — storage+editor only, NOT wired to sending). See memory `admin-screens`.
- **Cash register** (`/cashregister`): check payment, split payments, discounts, link-sale-to-order. All in `sales` JSONB columns (`payment_details`, `discount`, `order_id`+`linked_order_info`); `sales.total`=final. Surfaces on receipt + DailySalesReport + CSV. See memory `pos-cash-register`.
- **Sites**: עכו/טבריה/נוף הגליל/שטח/פודטראק/קפה אקסטרים (+ויה פרטה on leads).
- **Order PDF + Gmail SMTP email** (`send-order-doc`, `Info.shafan@gmail.com`), **internal order notes**, **site-opening prompt** (אחמ"ש every login), **instructor invites** (per-activity + new daily summary `InstructorDailyDialog`).

## Pending / next (each its own gated task — confirm before starting)
- **Open follow-ups:** wire Task 12 templates into actual sending (placeholder substitution); add a Schedule-side entry for the instructor daily summary (Schedule loads orders+profiles but not the `instructors` table).
- **Postponed — do NOT start without explicit ask:** external ticketing/Carousel API, payment gateway, WhatsApp PDF (file) delivery.
- **Deferred:** verified Resend domain, DB email sent-tracking.

## Business rules / constraints
- Hebrew RTL throughout — never translate UI strings.
- `orders.notes` customer-facing; `orders.internal_notes` staff-only — keep separate, never in PDF/email/WhatsApp.
- Never put secrets in repo/PROGRESS/CLAUDE or inline on CLI.

## First steps in a new window
- `git status -sb` + `git log --oneline -10`. Read `PROGRESS.md` top (Phase F section) + the relevant memory files.
- Confirm which task the owner wants next; do the read-only review first.
