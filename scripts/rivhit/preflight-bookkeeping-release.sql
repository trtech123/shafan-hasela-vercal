-- Production read-only preflight. Inspect result before any approved migration.
SELECT
  current_database() AS database_name,
  to_regclass('public.rivhit_bookkeeping_sources') IS NULL AS sources_absent,
  to_regclass('public.rivhit_bookkeeping_legs') IS NULL AS legs_absent,
  to_regprocedure('public.claim_rivhit_bookkeeping_leg(uuid,text,text,text)') IS NULL AS claim_absent,
  to_regprocedure('public.complete_rivhit_bookkeeping_leg(uuid,uuid,integer,integer,integer)') IS NULL AS complete_absent,
  to_regprocedure('public.hold_rivhit_bookkeeping_leg(uuid,uuid,text)') IS NULL AS hold_absent,
  to_regclass('public.physical_terminal_devices') IS NOT NULL AS physical_settings_present,
  to_regclass('public.physical_payment_intents') IS NOT NULL AS physical_intents_present,
  to_regprocedure('public.guard_order_delete()') IS NOT NULL AS safe_delete_present,
  to_regprocedure('public.guard_order_archive_change()') IS NOT NULL AS archive_guard_present,
  to_regnamespace('supabase_migrations') IS NOT NULL AS supabase_migration_schema_present;
