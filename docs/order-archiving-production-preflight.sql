-- Run in the production Supabase SQL Editor with administrative read access.
-- SELECT-only catalog inspection. Share results without customer rows or secrets.

-- 1. Confirm the migration order and whether archiving is already installed.
SELECT version
FROM supabase_migrations.schema_migrations
WHERE version >= '202611030001'
ORDER BY version;

-- 2. Required relations. Any NULL relation blocks the migration.
WITH required(name) AS (VALUES
  ('orders'), ('profiles'), ('leads'), ('quotes'), ('tasks'), ('activities'),
  ('instructors'), ('payment_transactions'), ('sales'),
  ('manual_order_payments'), ('immediate_accounting_preparations'),
  ('immediate_accounting_payment_evidence'), ('payper_document_ledger'),
  ('payper_payment_billing_snapshots'), ('pelecard_live_attempts'),
  ('pelecard_controlled_live_control'), ('hakafa_vouchers'),
  ('accounting_documents'), ('accounting_events'), ('blocked_slots'),
  ('customer_snapshots'), ('dashboard_stats'), ('instructor_schedule')
)
SELECT name, to_regclass('public.' || name) AS actual_relation
FROM required ORDER BY name;

-- 3. Columns used by the new functions and view definitions.
-- Any row with actual_type NULL needs investigation.
WITH required(relation_name, column_name) AS (VALUES
  ('orders','id'), ('orders','order_number'), ('orders','created_at'),
  ('orders','updated_at'), ('orders','created_by'), ('orders','status'),
  ('orders','payment_status'), ('orders','activity_date'), ('orders','quote_id'),
  ('orders','instructor_id'), ('orders','instructor_notified'),
  ('orders','site'), ('orders','start_time'), ('orders','end_time'),
  ('orders','total_price'), ('orders','activity_id'),
  ('orders','num_participants'), ('orders','client_name'), ('orders','organization'),
  ('profiles','id'), ('quotes','id'), ('quotes','status'),
  ('quotes','converted_to_order_id'), ('leads','status'),
  ('tasks','status'), ('tasks','due_date'), ('activities','id'),
  ('activities','name'), ('activities','duration_hours'),
  ('instructors','id'), ('instructors','full_name'),
  ('instructors','phone'), ('instructors','email'),
  ('payment_transactions','order_id'), ('payment_transactions','checkout_snapshot'),
  ('sales','order_id'), ('sales','linked_order_info'),
  ('manual_order_payments','order_id'),
  ('immediate_accounting_preparations','order_id'),
  ('immediate_accounting_payment_evidence','order_id'),
  ('payper_document_ledger','order_id'),
  ('payper_payment_billing_snapshots','order_id'),
  ('pelecard_live_attempts','order_id'),
  ('pelecard_controlled_live_control','order_id'),
  ('hakafa_vouchers','order_id'), ('customer_snapshots','order_id'),
  ('accounting_documents','source_type'), ('accounting_documents','source_id'),
  ('accounting_events','source_type'), ('accounting_events','source_id'),
  ('blocked_slots','source_order_id'), ('blocked_slots','block_date'),
  ('blocked_slots','site'), ('blocked_slots','start_time'),
  ('blocked_slots','end_time')
)
SELECT r.relation_name, r.column_name,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS actual_type
FROM required r
LEFT JOIN pg_catalog.pg_class c
  ON c.oid = pg_catalog.to_regclass('public.' || r.relation_name)
LEFT JOIN pg_catalog.pg_attribute a
  ON a.attrelid = c.oid AND a.attname = r.column_name AND NOT a.attisdropped
ORDER BY r.relation_name, r.column_name;

-- 4. Existing triggers and their functions on affected tables.
SELECT c.oid::regclass AS relation_name, t.tgname,
       pg_catalog.pg_get_triggerdef(t.oid, true) AS trigger_definition,
       p.oid::regprocedure AS function_name
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public' AND NOT t.tgisinternal
  AND c.relname IN ('orders','payment_transactions','sales',
    'manual_order_payments','immediate_accounting_preparations',
    'immediate_accounting_payment_evidence','payper_document_ledger',
    'payper_payment_billing_snapshots','pelecard_live_attempts',
    'pelecard_controlled_live_control','hakafa_vouchers',
    'customer_snapshots','accounting_documents','accounting_events',
    'quotes','blocked_slots')
ORDER BY relation_name, t.tgname;

-- 5. Existing constraints and foreign keys, including delete behavior.
SELECT c.conrelid::regclass AS relation_name, c.conname, c.contype,
       pg_catalog.pg_get_constraintdef(c.oid, true) AS definition
FROM pg_catalog.pg_constraint c
WHERE c.conrelid IN (
  SELECT oid FROM pg_catalog.pg_class
  WHERE relnamespace = 'public'::regnamespace
    AND relname IN ('orders','profiles','payment_transactions','sales',
      'manual_order_payments','immediate_accounting_preparations',
      'immediate_accounting_payment_evidence','payper_document_ledger',
      'payper_payment_billing_snapshots','pelecard_live_attempts',
      'pelecard_controlled_live_control','hakafa_vouchers',
      'customer_snapshots','accounting_documents','accounting_events',
      'quotes','blocked_slots')
)
ORDER BY relation_name, c.conname;

-- 6. RLS settings, policies and existing grants on operational tables.
SELECT c.oid::regclass AS relation_name, c.relrowsecurity, c.relforcerowsecurity,
       pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
       pg_catalog.has_table_privilege('authenticated', c.oid, 'UPDATE') AS authenticated_update
FROM pg_catalog.pg_class c
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relname IN ('orders','profiles','payment_transactions','sales',
    'quotes','blocked_slots','accounting_documents','accounting_events')
ORDER BY relation_name;

SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('orders','profiles','payment_transactions','sales',
    'quotes','blocked_slots','accounting_documents','accounting_events')
ORDER BY tablename, policyname;

-- 7. Function identity, owner privileges and search path.
SELECT p.oid::regprocedure AS function_name, p.prosecdef AS security_definer,
       p.proconfig AS function_settings,
       pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AS authenticated_execute
FROM pg_catalog.pg_proc p
WHERE p.oid IN ('auth.uid()'::regprocedure, 'public.is_admin()'::regprocedure)
   OR (p.pronamespace = 'public'::regnamespace AND p.proname IN
     ('archive_order','restore_order','guard_order_archive_change',
      'reject_order_hard_delete','guard_archived_order_financial_link',
      'guard_archived_order_sale_link','guard_archived_order_number_link',
      'guard_archived_order_accounting_source','guard_archived_order_quote_link',
      'guard_archived_order_block_link'))
ORDER BY function_name;

-- 8. Existing view shapes and potential object-name collisions.
SELECT c.oid::regclass AS view_name,
       pg_catalog.pg_get_viewdef(c.oid, true) AS view_definition
FROM pg_catalog.pg_class c
WHERE c.oid IN ('public.dashboard_stats'::regclass,
                'public.instructor_schedule'::regclass);

SELECT pg_catalog.to_regclass('public.orders_active_created_idx') AS active_index,
       pg_catalog.to_regclass('public.orders_archived_created_idx') AS archive_index,
       pg_catalog.to_regprocedure('public.archive_order(uuid,boolean)') AS archive_rpc,
       pg_catalog.to_regprocedure('public.restore_order(uuid)') AS restore_rpc,
       EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
         WHERE attrelid = 'public.orders'::regclass AND attname = 'archived_at'
           AND NOT attisdropped) AS archived_at_exists,
       EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
         WHERE conrelid = 'public.orders'::regclass
           AND conname = 'orders_archive_actor_check') AS archive_constraint_exists;
