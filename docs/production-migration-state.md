# Production migration state

Last verified: 2026-09-10

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
