-- Read-only production inspection. Run against the intended Supabase project
-- before approving migration 202611170003. Do not infer application state from
-- supabase_migrations.schema_migrations on this historical project.
BEGIN READ ONLY;

-- Expected before migration: client_name and client_phone both attnotnull=true.
-- Expected after migration: both false. Email and customer_id stay nullable.
SELECT a.attname, a.attnotnull, pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type
FROM pg_catalog.pg_attribute a
WHERE a.attrelid='public.orders'::regclass
  AND a.attname IN ('client_name','client_phone','client_email','customer_id',
                    'customer_snapshot_id','activity_date','num_participants')
  AND a.attnum>0 AND NOT a.attisdropped
ORDER BY a.attname;

-- Review every order constraint and enabled application trigger for unexpected
-- additional customer-field requirements before executing the migration.
SELECT c.conname, pg_catalog.pg_get_constraintdef(c.oid) AS definition
FROM pg_catalog.pg_constraint c
WHERE c.conrelid='public.orders'::regclass
ORDER BY c.conname;

SELECT t.tgname,t.tgenabled,pg_catalog.pg_get_triggerdef(t.oid) AS definition
FROM pg_catalog.pg_trigger t
WHERE t.tgrelid='public.orders'::regclass AND NOT t.tgisinternal
ORDER BY t.tgname;

-- Verify the order form, customer snapshot, and payment guard RPCs are present.
SELECT p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
  ('save_order_form','link_order_customer','digital_order_payment_issues',
   'reserve_pos_pelecard','record_payper_order_collection',
   'guard_order_customer_snapshot')
ORDER BY p.proname,p.oid;

-- Record financial row counts before and immediately after the metadata-only
-- migration. A concurrent business write can change a count; investigate any
-- unexplained difference rather than attributing it to this migration.
SELECT 'orders' AS source,count(*) AS rows FROM public.orders
UNION ALL SELECT 'sales',count(*) FROM public.sales
UNION ALL SELECT 'payment_transactions',count(*) FROM public.payment_transactions
UNION ALL SELECT 'payper_document_ledger',count(*) FROM public.payper_document_ledger
ORDER BY source;

ROLLBACK;
