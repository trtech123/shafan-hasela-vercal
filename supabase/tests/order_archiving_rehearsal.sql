\set ON_ERROR_STOP on
-- Disposable local PostgreSQL database only. Run in a fresh database and drop it
-- afterward; the migration commits the synthetic setup. Test actions roll back.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, role text NOT NULL);
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '' AS
  $$ SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') $$;
CREATE TABLE public.orders(
  id uuid PRIMARY KEY, order_number text, created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL, payment_status text NOT NULL, activity_date date NOT NULL,
  quote_id uuid, total_price numeric, instructor_id uuid, created_by uuid,
  instructor_notified boolean NOT NULL DEFAULT false,
  site text, start_time time, end_time time, num_participants integer,
  client_name text, organization text, activity_id uuid
);
CREATE TABLE public.leads(status text);
CREATE TABLE public.tasks(status text, due_date date);
CREATE TABLE public.activities(id uuid PRIMARY KEY, name text, duration_hours numeric);
CREATE TABLE public.instructors(id uuid PRIMARY KEY, full_name text, phone text, email text);
CREATE TABLE public.payment_transactions(order_id uuid, checkout_snapshot jsonb);
CREATE TABLE public.sales(order_id uuid, linked_order_info jsonb);
CREATE TABLE public.manual_order_payments(order_id uuid);
CREATE TABLE public.immediate_accounting_preparations(order_id uuid);
CREATE TABLE public.immediate_accounting_payment_evidence(order_id uuid);
CREATE TABLE public.payper_document_ledger(order_id uuid);
CREATE TABLE public.payper_payment_billing_snapshots(order_id uuid);
CREATE TABLE public.pelecard_live_attempts(order_id uuid);
CREATE TABLE public.pelecard_controlled_live_control(order_id uuid);
CREATE TABLE public.customer_snapshots(order_id uuid);
CREATE TABLE public.hakafa_vouchers(order_id uuid);
CREATE TABLE public.accounting_documents(source_type text, source_id text);
CREATE TABLE public.accounting_events(source_type text, source_id text);
CREATE TABLE public.blocked_slots(source_order_id uuid, block_date date, site text, start_time time, end_time time);
CREATE TABLE public.quotes(id uuid PRIMARY KEY, converted_to_order_id uuid, status text);
CREATE TABLE public.order_confirmation_revisions(order_id uuid);
CREATE TABLE public.order_delivery_attempts(order_id uuid);
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT INSERT ON public.sales TO authenticated;
GRANT INSERT ON public.payment_transactions, public.hakafa_vouchers,
  public.manual_order_payments, public.immediate_accounting_preparations,
  public.immediate_accounting_payment_evidence, public.payper_document_ledger,
  public.payper_payment_billing_snapshots, public.pelecard_live_attempts,
  public.customer_snapshots,
  public.accounting_documents, public.accounting_events, public.blocked_slots,
  public.quotes TO authenticated;
GRANT SELECT, DELETE ON public.blocked_slots TO authenticated;
GRANT SELECT ON public.profiles, public.quotes TO authenticated;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_test_read ON public.orders FOR SELECT TO authenticated USING (true);
CREATE POLICY order_test_update ON public.orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY order_test_delete ON public.orders FOR DELETE TO authenticated USING (public.is_admin());
INSERT INTO public.profiles VALUES
  ('10000000-0000-4000-8000-000000000001', 'admin'),
  ('10000000-0000-4000-8000-000000000002', 'operations');
INSERT INTO public.orders(id,status,payment_status,activity_date,quote_id,total_price) VALUES
  ('20000000-0000-4000-8000-000000000001','בוטל','לא שולם',CURRENT_DATE - 1,'30000000-0000-4000-8000-000000000001',0),
  ('20000000-0000-4000-8000-000000000002','מאושר','לא שולם',CURRENT_DATE + 1,NULL,100),
  ('20000000-0000-4000-8000-000000000003','בוטל','אשראי',CURRENT_DATE - 1,NULL,100),
  ('20000000-0000-4000-8000-000000000004','בוטל','לא שולם',CURRENT_DATE - 1,NULL,100),
  ('20000000-0000-4000-8000-000000000005','בוטל','לא שולם',CURRENT_DATE + 1,NULL,0),
  ('20000000-0000-4000-8000-000000000006','בוטל','לא שולם',CURRENT_DATE - 1,NULL,100),
  ('20000000-0000-4000-8000-000000000007','בוטל','לא שולם',CURRENT_DATE - 1,NULL,100),
  ('20000000-0000-4000-8000-000000000008','בוטל','לא שולם',CURRENT_DATE - 1,NULL,100),
  ('20000000-0000-4000-8000-000000000009','בוטל','לא שולם',CURRENT_DATE - 1,NULL,100);
INSERT INTO public.quotes VALUES('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
INSERT INTO public.payment_transactions VALUES('20000000-0000-4000-8000-000000000004');
INSERT INTO public.blocked_slots VALUES('20000000-0000-4000-8000-000000000005',CURRENT_DATE + 1);
INSERT INTO public.sales VALUES('20000000-0000-4000-8000-000000000006');
INSERT INTO public.hakafa_vouchers VALUES('20000000-0000-4000-8000-000000000007');
INSERT INTO public.accounting_documents VALUES('order','20000000-0000-4000-8000-000000000008');
INSERT INTO public.payper_document_ledger VALUES('20000000-0000-4000-8000-000000000009');
\ir ../migrations/202611030007_order_archiving.sql
GRANT SELECT ON public.dashboard_stats, public.instructor_schedule TO authenticated;
BEGIN;
INSERT INTO public.orders(id,status,payment_status,activity_date,total_price) VALUES
  ('20000000-0000-4000-8000-000000000010','בוטל','לא שולם',CURRENT_DATE - 1,0);
INSERT INTO public.orders(id,status,payment_status,activity_date,total_price,site,start_time,end_time,instructor_id,instructor_notified) VALUES
  ('20000000-0000-4000-8000-000000000011','ממתין לאישור','לא שולם',CURRENT_DATE + 5,250,'עכו','10:00','11:00',NULL,false),
  ('20000000-0000-4000-8000-000000000013','ממתין לאישור','לא שולם',CURRENT_DATE + 5,250,'עכו','12:00','13:00',NULL,false),
  ('20000000-0000-4000-8000-000000000014','ממתין לאישור','לא שולם',CURRENT_DATE + 5,250,'עכו','14:00','15:00','40000000-0000-4000-8000-000000000001',false),
  ('20000000-0000-4000-8000-000000000015','ממתין לאישור','לא שולם',CURRENT_DATE + 5,250,'עכו','16:00','17:00',NULL,false),
  ('20000000-0000-4000-8000-000000000016','ממתין לאישור','לא שולם',CURRENT_DATE + 5,250,'עכו','18:00','19:00',NULL,false),
  ('20000000-0000-4000-8000-000000000017','ממתין לאישור','לא שולם',CURRENT_DATE + 6,250,NULL,NULL,NULL,NULL,false),
  ('20000000-0000-4000-8000-000000000018','ממתין לאישור','לא שולם',CURRENT_DATE + 5,250,'עכו','20:00','21:00',NULL,true),
  ('20000000-0000-4000-8000-000000000019','מאושר','לא שולם',CURRENT_DATE + 5,250,'עכו','10:00','11:00',NULL,false),
  ('20000000-0000-4000-8000-000000000020','ממתין לאישור','לא שולם',CURRENT_DATE + 5,250,'עכו','22:00','23:00',NULL,false),
  ('20000000-0000-4000-8000-000000000021','ממתין לאישור','לא שולם',CURRENT_DATE + 5,250,'עכו','08:00','09:00',NULL,false),
  ('20000000-0000-4000-8000-000000000022','ממתין לאישור','לא שולם',CURRENT_DATE + 5,250,'עכו','07:00','08:00',NULL,false),
  ('20000000-0000-4000-8000-000000000023','ממתין לאישור','לא שולם',CURRENT_DATE + 5,250,'עכו','06:00','07:00',NULL,false),
  ('20000000-0000-4000-8000-000000000024','ממתין לאישור','לא שולם',CURRENT_DATE + 5,250,'עכו','05:00','06:00',NULL,false);
INSERT INTO public.order_confirmation_revisions VALUES('20000000-0000-4000-8000-000000000023');
INSERT INTO public.order_delivery_attempts VALUES('20000000-0000-4000-8000-000000000024');
UPDATE public.orders SET order_number='TEST-011' WHERE id='20000000-0000-4000-8000-000000000011';
UPDATE public.orders SET order_number='TEST-022' WHERE id='20000000-0000-4000-8000-000000000022';
INSERT INTO public.quotes(id,converted_to_order_id) VALUES
  ('30000000-0000-4000-8000-000000000013','20000000-0000-4000-8000-000000000013');
INSERT INTO public.blocked_slots(source_order_id,block_date,site,start_time,end_time) VALUES
  ('20000000-0000-4000-8000-000000000015',CURRENT_DATE + 5,'עכו','16:00','17:00');
INSERT INTO public.payment_transactions(order_id) VALUES
  ('20000000-0000-4000-8000-000000000016');
INSERT INTO public.pelecard_live_attempts(order_id) VALUES
  ('20000000-0000-4000-8000-000000000020');
INSERT INTO public.pelecard_controlled_live_control(order_id) VALUES
  ('20000000-0000-4000-8000-000000000021');
INSERT INTO public.payment_transactions(order_id,checkout_snapshot) VALUES
  (NULL,'{"linked_order_info":{"order_number":"TEST-022"}}');
DO $$ BEGIN
  IF (SELECT archived_at FROM public.orders WHERE id='20000000-0000-4000-8000-000000000010') IS NOT NULL THEN
    RAISE EXCEPTION 'new order was archived by default';
  END IF;
END $$;

DO $$ BEGIN
  IF has_function_privilege('anon','public.archive_order(uuid,boolean)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.archive_order(uuid,boolean)','EXECUTE')
     OR has_function_privilege('authenticated','public.guard_order_archive_change()','EXECUTE') THEN
    RAISE EXCEPTION 'archive function grants mismatch';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.archive_order('20000000-0000-4000-8000-000000000001',true);
    RAISE EXCEPTION 'operations user archived';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_archive_forbidden' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.orders SET archived_at = now() WHERE id = '20000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'operations user modified archive field';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_archive_forbidden' THEN RAISE; END IF;
  END;
END $$;

SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.archive_order('20000000-0000-4000-8000-000000000010',false);
    RAISE EXCEPTION 'missing external confirmation accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_archive_confirmation_required' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.orders SET archived_at=now() WHERE id='20000000-0000-4000-8000-000000000010';
    RAISE EXCEPTION 'direct archive accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_archive_confirmation_required' THEN RAISE; END IF;
  END;
END $$;
DO $$ DECLARE saved public.orders; response jsonb; BEGIN
  response := public.archive_order('20000000-0000-4000-8000-000000000001',true);
  SELECT * INTO saved FROM public.orders WHERE id='20000000-0000-4000-8000-000000000001';
  IF response->>'id' IS DISTINCT FROM saved.id::text OR response->>'archived_at' IS NULL
     OR saved.archived_at IS NULL OR saved.archived_by <> '10000000-0000-4000-8000-000000000001'
     OR saved.status <> 'בוטל' OR saved.payment_status <> 'לא שולם'
     OR NOT EXISTS (SELECT 1 FROM public.quotes WHERE converted_to_order_id = saved.id)
     OR EXISTS (SELECT 1 FROM public.orders WHERE id = saved.id AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'archive did not preserve state or quotation';
  END IF;
  BEGIN
    PERFORM public.archive_order(saved.id,true);
    RAISE EXCEPTION 'duplicate archive accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_archive_already_archived' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.orders WHERE id = saved.id;
    RAISE EXCEPTION 'hard deletion accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_hard_delete_forbidden' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.sales(order_id) VALUES(saved.id);
    RAISE EXCEPTION 'sale linked to archived order';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_archive_sale_link_forbidden' THEN RAISE; END IF;
  END;
END $$;

SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.restore_order('20000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'operations user restored';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_archive_forbidden' THEN RAISE; END IF;
  END;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);

DO $$ DECLARE target uuid; expected text; BEGIN
  FOR target,expected IN SELECT * FROM (VALUES
    ('20000000-0000-4000-8000-000000000002'::uuid,'order_archive_status_not_eligible'),
    ('20000000-0000-4000-8000-000000000003'::uuid,'order_archive_financial_dependency'),
    ('20000000-0000-4000-8000-000000000004'::uuid,'order_archive_financial_dependency'),
    ('20000000-0000-4000-8000-000000000005'::uuid,'order_archive_scheduling_block'),
    ('20000000-0000-4000-8000-000000000006'::uuid,'order_archive_financial_dependency'),
    ('20000000-0000-4000-8000-000000000007'::uuid,'order_archive_financial_dependency'),
    ('20000000-0000-4000-8000-000000000008'::uuid,'order_archive_financial_dependency'),
    ('20000000-0000-4000-8000-000000000009'::uuid,'order_archive_financial_dependency'),
    ('20000000-0000-4000-8000-000000000013'::uuid,'order_archive_quotation_link'),
    ('20000000-0000-4000-8000-000000000014'::uuid,'order_archive_instructor_commitment'),
    ('20000000-0000-4000-8000-000000000015'::uuid,'order_archive_scheduling_block'),
    ('20000000-0000-4000-8000-000000000016'::uuid,'order_archive_financial_dependency'),
    ('20000000-0000-4000-8000-000000000018'::uuid,'order_archive_instructor_commitment'),
    ('20000000-0000-4000-8000-000000000020'::uuid,'order_archive_financial_dependency'),
    ('20000000-0000-4000-8000-000000000021'::uuid,'order_archive_financial_dependency'),
    ('20000000-0000-4000-8000-000000000022'::uuid,'order_archive_financial_dependency'),
    ('20000000-0000-4000-8000-000000000023'::uuid,'order_archive_confirmation_history'),
    ('20000000-0000-4000-8000-000000000024'::uuid,'order_archive_confirmation_history')) v(id,reason)
  LOOP
    BEGIN
      PERFORM public.archive_order(target,true);
      RAISE EXCEPTION 'unsafe archive accepted';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> expected THEN RAISE; END IF;
    END;
  END LOOP;
END $$;

RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.payment_transactions) <> 3
     OR (SELECT count(*) FROM public.blocked_slots) <> 2
     OR (SELECT count(*) FROM public.sales) <> 1
     OR (SELECT count(*) FROM public.hakafa_vouchers) <> 1
     OR (SELECT count(*) FROM public.accounting_documents) <> 1
     OR (SELECT count(*) FROM public.payper_document_ledger) <> 1 THEN
    RAISE EXCEPTION 'financial or schedule history changed';
  END IF;
END $$;
SET LOCAL ROLE authenticated;

DO $$ DECLARE saved public.orders; response jsonb; BEGIN
  response := public.restore_order('20000000-0000-4000-8000-000000000001');
  SELECT * INTO saved FROM public.orders WHERE id='20000000-0000-4000-8000-000000000001';
  IF response->>'id' IS DISTINCT FROM saved.id::text OR response->>'archived_at' IS NOT NULL
     OR saved.archived_at IS NOT NULL OR saved.archived_by IS NOT NULL
     OR saved.status <> 'בוטל' OR saved.payment_status <> 'לא שולם'
     OR NOT EXISTS(SELECT 1 FROM public.quotes WHERE converted_to_order_id = saved.id) THEN
    RAISE EXCEPTION 'restore did not preserve state';
  END IF;
END $$;

DO $$ DECLARE saved public.orders; response jsonb; active_before bigint; active_after bigint; BEGIN
  SELECT active_orders INTO active_before FROM public.dashboard_stats;
  response := public.archive_order('20000000-0000-4000-8000-000000000011',true);
  SELECT active_orders INTO active_after FROM public.dashboard_stats;
  SELECT * INTO saved FROM public.orders WHERE id='20000000-0000-4000-8000-000000000011';
  IF response->>'archived_at' IS NULL OR saved.archived_at IS NULL
     OR saved.status <> 'ממתין לאישור' OR saved.payment_status <> 'לא שולם'
     OR saved.total_price <> 250 THEN RAISE EXCEPTION 'eligible pending order was not archived'; END IF;
  IF active_after <> active_before - 1 OR EXISTS (
    SELECT 1 FROM public.instructor_schedule WHERE order_id = saved.id
  ) THEN RAISE EXCEPTION 'operational views include archived order'; END IF;
  BEGIN
    INSERT INTO public.payment_transactions(order_id) VALUES(saved.id);
    RAISE EXCEPTION 'payment linked to archived order';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_archive_financial_link_forbidden' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.payment_transactions(checkout_snapshot) VALUES
      ('{"linked_order_info":{"order_number":"TEST-011"}}');
    RAISE EXCEPTION 'number-only payment linked to archived order';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_archive_financial_link_forbidden' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.sales(linked_order_info) VALUES
      ('{"order_number":"TEST-011"}');
    RAISE EXCEPTION 'number-only sale linked to archived order';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_archive_financial_link_forbidden' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.hakafa_vouchers(order_id) VALUES(saved.id);
    RAISE EXCEPTION 'voucher linked to archived order';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_archive_financial_link_forbidden' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.pelecard_live_attempts(order_id) VALUES(saved.id);
    RAISE EXCEPTION 'Pelecard attempt linked to archived order';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_archive_financial_link_forbidden' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.manual_order_payments(order_id) VALUES(saved.id);
    RAISE EXCEPTION 'manual payment linked to archived order';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_archive_financial_link_forbidden' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.immediate_accounting_preparations(order_id) VALUES(saved.id);
    RAISE EXCEPTION 'accounting preparation linked to archived order';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_archive_financial_link_forbidden' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.payper_payment_billing_snapshots(order_id) VALUES(saved.id);
    RAISE EXCEPTION 'Payper billing linked to archived order';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_archive_financial_link_forbidden' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.accounting_documents(source_type,source_id) VALUES('order',saved.id::text);
    RAISE EXCEPTION 'accounting document linked to archived order';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_archive_financial_link_forbidden' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.quotes(id,converted_to_order_id) VALUES
      ('30000000-0000-4000-8000-000000000011',saved.id);
    RAISE EXCEPTION 'quotation linked to archived order';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_archive_quotation_link_forbidden' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.blocked_slots(source_order_id,block_date) VALUES(saved.id,CURRENT_DATE + 5);
    RAISE EXCEPTION 'schedule block linked to archived order';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_archive_scheduling_link_forbidden' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.orders SET status='מאושר' WHERE id=saved.id;
    RAISE EXCEPTION 'archived business record changed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_archive_business_update_forbidden' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.orders SET created_by='10000000-0000-4000-8000-000000000001' WHERE id=saved.id;
    RAISE EXCEPTION 'archived creator changed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_archive_business_update_forbidden' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.restore_order(saved.id);
    RAISE EXCEPTION 'conflicting future order restored';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_restore_schedule_conflict' THEN RAISE; END IF;
  END;
  UPDATE public.orders SET status='בוטל' WHERE id='20000000-0000-4000-8000-000000000019';
  INSERT INTO public.blocked_slots(source_order_id,block_date,site,start_time,end_time)
    VALUES(NULL,CURRENT_DATE + 5,'עכו','10:00','11:00');
  BEGIN
    PERFORM public.restore_order(saved.id);
    RAISE EXCEPTION 'conflicting manual block restored';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_restore_schedule_conflict' THEN RAISE; END IF;
  END;
  DELETE FROM public.blocked_slots WHERE source_order_id IS NULL AND block_date=CURRENT_DATE + 5;
  response := public.restore_order(saved.id);
  SELECT * INTO saved FROM public.orders WHERE id=saved.id;
  IF response->>'archived_at' IS NOT NULL OR saved.archived_at IS NOT NULL
     OR saved.status <> 'ממתין לאישור' OR saved.total_price <> 250 THEN
    RAISE EXCEPTION 'pending order restore failed';
  END IF;
END $$;

DO $$ BEGIN
  PERFORM public.archive_order('20000000-0000-4000-8000-000000000017',true);
  BEGIN
    PERFORM public.restore_order('20000000-0000-4000-8000-000000000017');
    RAISE EXCEPTION 'incomplete future slot restored';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_restore_schedule_review_required' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;
