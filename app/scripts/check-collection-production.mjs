import { createPhysicalDatabase } from '../server/pelecard-physical/database.js';

const db = createPhysicalDatabase(process.env);
const result = await db.query(`
  SELECT
    current_setting('server_version_num')::integer AS server_version,
    to_regclass('public.payper_noncard_payments') IS NOT NULL AS check_migration_present,
    to_regprocedure('public.reserve_physical_order_payment(uuid,uuid,text,uuid,integer)') IS NOT NULL AS physical_migration_present,
    to_regclass('public.physical_payment_intents') IS NOT NULL AS physical_intents_present,
    to_regclass('public.payper_manual_document_audit') IS NOT NULL AS physical_reconciliation_present,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname='payment_transactions_provider_check') AS payment_provider_constraint_present,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname='orders_payment_status_check') AS order_status_constraint_present,
    (SELECT count(*)::integer FROM public.physical_terminal_devices WHERE enabled) AS enabled_device_count,
    (SELECT count(*)::integer FROM public.physical_terminal_devices WHERE enabled AND register_number='004') AS register_004_count,
    (SELECT enabled FROM public.payper_dispatch_control LIMIT 1) AS payper_enabled,
    (SELECT dispatch_mode FROM public.payper_dispatch_control LIMIT 1) AS payper_mode
`);
console.log(JSON.stringify(result.rows[0]));
