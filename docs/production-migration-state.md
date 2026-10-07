# Production migration state

Historical baseline verified: 2026-09-10. Reconciliation inventory checked: 2026-10-07.

Production Supabase project `shafan-hasela` (`divzxsynczeifkpnpupl`) has migrations 021 through 028 applied in order:

- `021_pelecard_payment_ledger.sql`
- `022_rivhit_accounting.sql`
- `023_clubs_and_recurring_billing.sql`
- `024_protect_profile_role.sql`
- `025_pelecard_payment_workflow.sql`
- `026_chatbot_runtime.sql`
- `027_payment_accounting_orchestration.sql`
- `028_clubs_operational_rules.sql`

This historical project was migrated through the Supabase SQL Editor and does not expose a `supabase_migrations.schema_migrations` ledger. Do not invent or recreate that internal ledger. Before applying a future migration, inspect the live schema markers and this record rather than assuming an absent migration-history row means the SQL was not applied.

Migration 028 initially failed and rolled back because its source referenced a nonexistent `public.set_updated_at()` helper. Production was then successfully migrated with the existing canonical helper, `public.update_updated_at()`. The committed migration now contains that exact compatibility correction. Migration 028 must not be rerun against Production.

Post-application verification confirmed:

- the 021–028 tables, views, triggers, constraints, RLS policies, and RPCs resolve;
- the profile-role protection trigger is enabled;
- 17 release tables have RLS enabled and 30 release-table policies exist;
- Clubs payer fields, fixed day-15 constraints, provider-authority constraint, attendance operations view, cancellation function, and failed-payment follow-up trigger exist;
- the December cancellation boundary resolves to 2027-01-01 for December 10 and 2027-02-01 for December 11;
- chatbot conversations and handoffs resolve;
- the payment/accounting outbox resolves;
- application-time counts immediately after rollout were zero accounting events, zero accounting documents, and zero failed-payment follow-ups.

No historical payment/accounting backfill, provider request, customer message, real payment, recurring charge, refund, cancellation, or Rivhit document was created while applying or verifying these migrations.

## Clubs attendance rollout ? 2026-10-05

Applied exactly once, in order, to divzxsynczeifkpnpupl:

- 202610050001_clubs_attendance.sql ? verified 2026-10-05T20:01:53.125Z; SHA256 69486c3a411ce971bf804127bc9ad6f9940e4d10d0e82e2d0b1d5ad80d454ca9.
- 202610050002_instructor_attendance.sql ? verified 2026-10-05T20:03:41.779Z; SHA256 a78dc879efbb53ced086f760f6badde5441f28eb048514aeb4b11aa5f21a42b2.

Existing project convention preserved: no internal migration ledger was created. Gate future execution on the release record and live schema markers. Both migrations are already installed and must not be rerun.
All new operational/link/audit tables were empty after rollout; existing financial and Clubs data fingerprints were unchanged. See docs/releases/clubs-attendance-20261005-rollout.json for exact evidence and deployment identity.

## Manual club sessions - 2026-10-06

Applied exactly once to `divzxsynczeifkpnpupl`:

- `202610060001_manual_club_session.sql`; verified `2026-10-06T11:49:50.245Z`.
- SHA256: `912832971c9e83d9ef7b65f827053208a73fbdfd4362a9962790fad67d40d6ae`.
- Live marker: `public.create_manual_club_session(uuid,date,time,time,uuid,text)`.

This migration is installed and must not be rerun. The existing no-internal-ledger convention is unchanged. Only an additive admin-authorized RPC was installed; existing attendance functions and all monitored operational/financial table fingerprints remained unchanged. No production session or attendance record was created during verification.

Source commit: `25d33655b265a06eb89a96ada983a861260b33f4`.
Production deployment: `dpl_5WtSueoErqvGhFWztJ4B2Pr68nYV`, replacing `dpl_Di8vkxx243HJ276ctBHGiNS3Ujsy`.
See `docs/releases/clubs-manual-session-20261006-rollout.json` and the matching source manifest for verification evidence, unchanged baseline failures, and exact release scope.

## Completed-session attendance corrections - 2026-10-06

Applied exactly once to `divzxsynczeifkpnpupl`:

- `202610060002_completed_attendance_correction.sql`, verified `2026-10-06T15:01:42.449Z`.
- SHA256: `a15b1493194ef74bbb4915d1fdfd6e369c494df18e4d728da8f2e71c46755c7b`.
- Replaces only `mark_club_attendance(uuid,uuid,text,integer,text)`: completed sessions require an admin and a non-whitespace correction reason. Instructor completed-session writes are denied. Cancelled/future restrictions, session locking, optimistic version checks, and append-only audit insertion are preserved.

No tables, existing attendance/audit records, or financial data were changed. Function privileges and every other inspected Clubs/instructor function were unchanged. This migration is installed; do not blindly replay it. The project still uses schema markers and release records rather than an internal migration ledger.

Source commit: `a4385a29510efe3bac5aabff85d270fd24d1e204`.
Deployment: `dpl_6XPouByDuARH9GzBkTe4cxGxr1vo`, replacing `dpl_5WtSueoErqvGhFWztJ4B2Pr68nYV`. Three intentional deployed source changes; 182 unrelated source files preserved byte-for-byte. Release-branch Git auto-deployment is disabled; the deployed artifact preserves the original production Vercel configuration.
Evidence: `docs/releases/clubs-completed-correction-20261006-rollout.json` and matching manifest. Production smoke was read-only; the user retains manual correction QA.

## Canonical source inventory - 2026-10-07 (no migration application)

Restored missing historical source files 030-042 and 044-050 from committed verified production release history. All their declared public function/relation markers exist in the current production schema. Files 029 and 043 are not asserted as installed and were not invented/imported. The project still has no internal migration ledger; do not replay historical migrations to populate one.

The complete 52-file migration set, including the four Attendance migrations above, passed disposable local rehearsal. This is validation only: no SQL migration, test user, financial record or attendance mutation was applied to production. See `docs/releases/production-main-20261007.md` and its provenance/validation records.
