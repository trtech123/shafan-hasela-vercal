# NEW CLAUDE WINDOW — START PROMPT (paste this)

You are continuing work on **Shafan Hasela / Adventure Ops Pro**. Read `PROGRESS.md` (root) first, then `CLAUDE.md`. This block is the quick-start.

## Project overview
Hebrew RTL operations app for an Israeli adventure-activities business (sites: עכו / טבריה / נוף הגליל / שטח, plus ויה פרטה for leads). Original Base44 MVP was recovered onto a Supabase backend. Now in post-MVP feature work, gated stage-by-stage.

## Infra / deployment
- Repo root: `C:\Users\nadav\OneDrive\Desktop\dev-projs\shafan-hasela\shafan-hasela-vercal` (Windows/PowerShell; Bash also available).
- Frontend: `app/` (Vite + React, JS). Dev `npm run dev --prefix app`; build `npm run build --prefix app`.
- GitHub: `origin` = `https://github.com/trtech123/shafan-hasela-vercal.git`, branch `main` (commit directly to main). Vercel auto-deploys on push to main.
- Supabase project ref `divzxsynczeifkpnpupl`. CLI is **`npx supabase`** only (no global; no `functions logs` subcommand → use Dashboard logs). Migrations applied manually in the SQL Editor; latest = `014`.
- Secrets never in repo. Edge Function secrets (`GMAIL_USER`, `GMAIL_APP_PASSWORD`) set via Dashboard. Owner runs `npx supabase` deploys/logins themselves (the agent shell lacks `SUPABASE_ACCESS_TOKEN`).

## Current production state (all shipped + pushed)
- **Order confirmation PDF** (`OrderConfirmationPDF.jsx`): one combined PDF — Section A (confirmation + fixed terms + signature, real local logo `app/public/shafan-logo.jpg`, itemized line, `כולל מע"מ`, mobile contact) + Section B (safety/health declaration). Download + WhatsApp-text + email.
- **Email delivery** (Edge Function `send-order-doc`): client PDF → base64 → JWT-secured function → **Gmail SMTP via `npm:nodemailer`**, sender `שפן הסלע <Info.shafan@gmail.com>`, recipient `order.client_email`. Working in production.
- **Roles/permissions**: roles `admin` / `operations`(אחמ"ש) / `cashier`(קופאי) / `instructor`(compat). Menu: admin=all; אחמ"ש=schedule+cashregister+orders+maintenance; קופאי=schedule+cashregister+orders. RLS via `is_cashier()` (orders + sales). For the business, מדריך = אחמ"ש = `operations`.
- **Internal order notes**: `orders.internal_notes` — staff-only, shown in OrderForm/Orders/Schedule, **never** in PDF/email/WhatsApp.
- **Site-opening prompt**: `נוהל פתיחת אתר` modal, every login, **אחמ"ש only** (owner's choice), two Google-Form buttons.

## Completed stages
Base44→Supabase recovery (all 7 phases) → data cutover → quick-win UI → availability blocking → Israeli holidays → leads enhancements → order-confirmation PDF (Phase B) → Gmail SMTP email (Phase C) → permissions/cashier + internal notes (Phase D). All in `PROGRESS.md`.

## Pending / next
- **NEXT: Stage 3 — admin user-management screen** (not started): service-role Edge Function `create-user` (admin-gated) + `app/src/pages/Users.jsx` (email/password/full_name/role) + `/users` route + admin nav. Until then, create users via Dashboard (trigger seeds `instructor`; promote via SQL).
- **Deferred bugfix:** PDF/email client-machine non-determinism (html2canvas fonts/canvas/DPI) — see memory `pdf-email-reliability-bug`. Owner commit `b791ad9` may already address part of it — review first.
- WhatsApp document send (Green API); verified Resend domain (optional); DB sent-tracking.

## Important business rules / constraints
- Hebrew RTL throughout — never translate UI strings to English.
- `orders.notes` is **customer-facing** (prints in PDF); `orders.internal_notes` is **staff-only** — keep separate.
- Never put secrets in repo/PROGRESS/CLAUDE or inline on CLI commands.
- Phases are gated: do ONE stage, run build, report, wait for approval. Never chain stages or commit/push without being asked.
- `supabase/.temp/` is git-ignored (CLI cache).

## Working state checks to run first
- `git status -sb` and `git log --oneline -10`.
- Read `PROGRESS.md` top (active phase) + the Phase D section.

## Next recommended task
Confirm the owner wants **Stage 3 (admin user management)**; if yes, start with the read-only/plan then the Edge Function `create-user`, gated.
