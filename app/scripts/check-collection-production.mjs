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
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname='payment_transactions_checkout_snapshot_check') AS checkout_snapshot_constraint_present,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname='payper_reserved_requires_trx_record') AS payper_trx_constraint_present,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname='orders_payment_status_check') AS order_status_constraint_present,
    to_regclass('public.payper_document_ledger_order_unique') IS NOT NULL AS single_document_order_index_present,
    (SELECT count(*)::integer FROM public.payment_transactions WHERE checkout_snapshot IS NULL OR
      public.payment_checkout_snapshot_is_safe(checkout_snapshot) IS NOT TRUE) AS existing_unsafe_checkout_count,
    (SELECT count(*)::integer FROM public.physical_terminal_devices WHERE enabled) AS enabled_device_count,
    (SELECT count(*)::integer FROM public.physical_terminal_devices WHERE enabled AND register_number='004') AS register_004_count,
    (SELECT enabled FROM public.payper_dispatch_control LIMIT 1) AS payper_enabled,
    (SELECT dispatch_mode FROM public.payper_dispatch_control LIMIT 1) AS payper_mode
`);
console.log(JSON.stringify(result.rows[0]));
const columns = await db.query(`WITH required(table_name,column_name) AS (VALUES
  ('orders','archived_at'),('orders','vat_applicable'),('orders','customer_snapshot_id'),
  ('orders','billing_signer_id'),('orders','billing_accounting_email'),('orders','quote_id'),
  ('orders','num_participants'),('orders','price_per_person'),
  ('payment_transactions','checkout_snapshot'),('payment_transactions','idempotency_key'),
  ('payment_transactions','verified_at'),('payment_transactions','provider_transaction_id'),
  ('sales','linked_order_info'),('sales','payment_transaction_id'),
  ('payper_document_ledger','document_origin'),('payper_document_ledger','source_facts'),
  ('physical_payment_intents','provider_uid'),('physical_payment_intents','approval_id'),
  ('physical_terminal_devices','cash_register_code'),('physical_terminal_devices','register_number')
) SELECT r.table_name||'.'||r.column_name AS missing
  FROM required r LEFT JOIN information_schema.columns c
    ON c.table_schema='public' AND c.table_name=r.table_name AND c.column_name=r.column_name
  WHERE c.column_name IS NULL ORDER BY missing`);
console.log(JSON.stringify({ missingRequiredColumns: columns.rows.map(row => row.missing) }));
