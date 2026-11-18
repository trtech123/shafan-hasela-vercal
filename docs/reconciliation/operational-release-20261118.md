# Operational restoration release group — 2026-11-18

## Source boundary

This isolated candidate descends from production commit `73690eee338b400bd9310e8fb283806852f43f29` through customer-management commit `c4ed2a6c4c90223b200953c1089c64c1b4c9e527`. It restores customer management, administrator club attendance, manual club sessions, instructor attendance, and explicit administrator-managed user/instructor links. It contains no signature, quotation delivery, voucher, Pelecard administration or chatbot document UI from the full restoration candidate.

The protected cashier, order, scheduling, cash, hosted Pelecard, Direct J4, Payper and Vercel deployment files remain at their deployed versions. No migrations, Edge deployments, customer communications or financial actions are part of this release group.

## Production dependency audit (read-only)

- `customers` has role-scoped authenticated SELECT/INSERT/UPDATE RLS for administrator, operations and cashier. `archive_customer(uuid,integer)` is available as invoker-security RPC and requires a version argument. Customer data is not exposed to instructors by the application.
- `get_club_attendance_history`, `materialize_club_sessions`, `create_manual_club_session`, `mark_club_attendance`, `get_instructor_club_sessions`, `get_instructor_club_roster`, `get_instructor_user_links` and `set_instructor_user_link` exist with the expected argument signatures. They are SECURITY DEFINER RPCs, so their internal authorization checks are critical. Roster and audit tables expose administrator SELECT policies; the user-link table has administrator SELECT only.
- The deployed `create-user` Edge source already permits the `instructor` role and checks that the caller profile is administrator before using its service-role client. An instructor must still be linked explicitly to an instructor record; no identity link is inferred from name or email.
- These observations are structural evidence. Role-based controlled acceptance is still required before Production approval. No historical migration is to be replayed.

## Rollout boundary

The operational candidate can be previewed independently. A controlled Production rollout should recheck the live application SHA, Supabase RPC/RLS contracts and role behavior, then deploy the exact candidate using the approved manual procedure. Administrator, operations, cashier and instructor accounts must be checked against their permitted screens without creating financial records. If any production dependency differs, stop the rollout. The full restoration candidate is not a prerequisite for this group.

## Local verification

- Operational role, customer, instructor-link and attendance suite: 6 files, 53 tests passed.
- Protected order, POS, hosted/physical payment and Payper regression: 10 files, 71 tests passed. No live payment or accounting call was made.
- ESLint, production Vite build and `git diff --check` passed after two narrow pre-existing lint fixes in `Leads` (unused import) and `Templates` (hook order).
- The Production schema/role checks above were read-only. They do not replace controlled role acceptance with authenticated users in Preview.
