\set ON_ERROR_STOP on
-- Disposable local database only; no provider network requests.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text);
INSERT INTO public.profiles VALUES('88888888-8888-4888-8888-888888888888','admin');
CREATE TABLE public.orders(id uuid PRIMARY KEY,order_number text,customer_snapshot_id uuid,customer_id uuid,customer_record_version int,total_price numeric);
CREATE TABLE public.sales(id uuid PRIMARY KEY,order_id uuid,payment_transaction_id uuid,total numeric);
CREATE TABLE public.customer_snapshots(id uuid PRIMARY KEY,order_id uuid,customer_id uuid,revision int,customer_kind text,customer_version int,data jsonb);
CREATE TABLE public.payment_transactions(id uuid PRIMARY KEY,provider text,operation text,status text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),verified_at timestamptz,provider_transaction_id text,order_id uuid,sale_id uuid,currency text,amount numeric,checkout_snapshot jsonb);
CREATE TABLE public.accounting_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),accounting_provider text,purpose text,source_type text,source_id text,status text,worker_id text,lease_token uuid,lease_expires_at timestamptz,next_attempt_at timestamptz,last_error jsonb,attempt_count int DEFAULT 0);
CREATE TABLE public.accounting_documents(provider text,source_type text,source_id text,status text);
CREATE TABLE public.immediate_accounting_preparations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),payment_id uuid,method text,customer_creation_started_at timestamptz,dispatch_started_at timestamptz);
CREATE FUNCTION public.reserve_pelecard_live_order(p_order_id uuid,p_actor_id uuid,p_expected_amount_minor integer,p_previous_payment_id uuid) RETURNS jsonb
LANGUAGE plpgsql AS $$ DECLARE payment_id uuid:=gen_random_uuid(); BEGIN
 INSERT INTO public.payment_transactions(id,provider,operation,status,order_id,currency,amount,checkout_snapshot)
 VALUES(payment_id,'pelecard','payment','initiated',p_order_id,'ILS',p_expected_amount_minor/100.0,'{}');
 RETURN jsonb_build_object('id',payment_id,'created',true);
END $$;
\ir ../migrations/202610220003_payper_disabled_ledger.sql
\ir ../migrations/202610290001_payper_new_payments_activation_controls.sql

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.payper_dispatch_control WHERE enabled OR activation_cutoff_utc IS NOT NULL OR dispatch_remaining<>0)
 THEN RAISE EXCEPTION 'migration activated dispatch'; END IF;
 IF has_table_privilege('authenticated','public.payper_payment_billing_snapshots','SELECT')
  OR has_table_privilege('service_role','public.payper_payment_billing_snapshots','SELECT')
  OR NOT has_table_privilege('authenticated','public.payper_document_ledger','SELECT')
 THEN RAISE EXCEPTION 'billing privacy or review visibility mismatch'; END IF;
 BEGIN
  PERFORM public.activate_payper_new_payments('88888888-8888-4888-8888-888888888888');
  RAISE EXCEPTION 'unauthorized activation accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.get_payper_billing_defaults('a0000000-0000-4000-8000-000000000001',
   '88888888-8888-4888-8888-888888888888');
  RAISE EXCEPTION 'unauthorized billing read accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT public.activate_payper_new_payments('88888888-8888-4888-8888-888888888888');
DO $$ BEGIN
 BEGIN
  PERFORM public.activate_payper_new_payments('88888888-8888-4888-8888-888888888888');
  RAISE EXCEPTION 'second activation accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

INSERT INTO public.orders VALUES
 ('a0000000-0000-4000-8000-000000000001','NEW-1','d0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001',1,118),
 ('a0000000-0000-4000-8000-000000000002','NEW-2','d0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000002',1,118),
 ('a0000000-0000-4000-8000-000000000003','MISSING',NULL,NULL,0,118),
 ('a0000000-0000-4000-8000-000000000004','UNKNOWN-VAT','d0000000-0000-4000-8000-000000000004','e0000000-0000-4000-8000-000000000004',1,118);
INSERT INTO public.customer_snapshots VALUES
 ('d0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001',1,'person',1,'{"vat_applicable":true,"client_name":"Test","client_email":"test@example.org","billing_company_id":"000000018"}'),
 ('d0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000002',1,'organization',1,'{"vat_applicable":false,"billing_institution_name":"Example Ltd","billing_company_id":"512783333"}'),
 ('d0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000004','e0000000-0000-4000-8000-000000000004',1,'person',1,'{"vat_applicable":null,"client_name":"Test","client_email":"test@example.org"}');
INSERT INTO public.sales VALUES
 ('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',118),
 ('b0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002',118),
 ('b0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000003',118),
 ('b0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000005',118);
-- Missing billing never interrupts reservation or verified payment finalization.
INSERT INTO public.payment_transactions(id,provider,operation,status,verified_at,provider_transaction_id,order_id,sale_id,currency,amount,checkout_snapshot)
VALUES
 ('c0000000-0000-4000-8000-000000000003','pelecard','payment','initiated',NULL,'missing','a0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000003','ILS',118,'{}'),
 ('c0000000-0000-4000-8000-000000000005','pelecard','payment','initiated',NULL,'unknown-vat','a0000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000004','ILS',118,'{}');
INSERT INTO public.payper_payment_billing_snapshots(payment_id,order_id,source_customer_snapshot_id,customer_kind,billing_name,billing_identity,billing_email,vat_applicable)
VALUES('c0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000004','person','Test','000000018','test@example.org',NULL);
UPDATE public.payment_transactions SET status='succeeded',verified_at=clock_timestamp()+interval '1 second'
WHERE id IN ('c0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000005');
INSERT INTO public.payment_transactions(id,provider,operation,status,created_at,verified_at,provider_transaction_id,order_id,currency,amount,checkout_snapshot)
VALUES('c0000000-0000-4000-8000-000000000004','pelecard','payment','succeeded',
 (SELECT activation_cutoff_utc-interval '1 microsecond' FROM public.payper_dispatch_control),clock_timestamp(),'old','a0000000-0000-4000-8000-000000000003','ILS',118,'{}');
INSERT INTO public.payment_transactions(id,provider,operation,status,provider_transaction_id,order_id,sale_id,currency,amount,checkout_snapshot) VALUES
 ('c0000000-0000-4000-8000-000000000001','pelecard','payment','initiated','new-1','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','ILS',118,'{"items":[{"id":"order-1","name":"Test","qty":1,"customPrice":118}],"discount":null}'),
 ('c0000000-0000-4000-8000-000000000002','pelecard','payment','initiated','new-2','a0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','ILS',118,'{"items":[{"id":"order-2","name":"Test","qty":1,"customPrice":118}],"discount":null}');
INSERT INTO public.payper_payment_billing_snapshots(payment_id,order_id,source_customer_snapshot_id,customer_kind,billing_name,billing_identity,billing_email,vat_applicable) VALUES
 ('c0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','person','Test','000000018','test@example.org',true),
 ('c0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000002','organization','Example Ltd','512783333','test@example.org',false);
UPDATE public.payment_transactions SET status='succeeded',verified_at=clock_timestamp()+interval '1 second'
WHERE id IN ('c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002');
UPDATE public.payment_transactions SET status='succeeded'
 WHERE id='c0000000-0000-4000-8000-000000000001';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.payper_document_ledger WHERE payment_id='c0000000-0000-4000-8000-000000000004')
 OR (SELECT count(*) FROM public.payper_document_ledger)<>4 THEN RAISE EXCEPTION 'historical capture or new capture failed'; END IF;
 IF (SELECT count(*) FROM public.payper_document_ledger WHERE state='source_blocked'
   AND reconciliation_code IN ('billing_snapshot_required','vat_treatment_required'))<>2
 THEN RAISE EXCEPTION 'missing billing review obligation'; END IF;
 IF public.freeze_payper_source('c0000000-0000-4000-8000-000000000001')->'billing'->>'billing_company_id'<>'000000018'
 THEN RAISE EXCEPTION 'private payment billing not frozen'; END IF;
 BEGIN
  UPDATE public.payper_payment_billing_snapshots SET billing_identity='123456789'
  WHERE payment_id='c0000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'billing snapshot mutation accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM public.freeze_payper_source('c0000000-0000-4000-8000-000000000002');
 INSERT INTO public.accounting_documents VALUES('rivhit','order','a0000000-0000-4000-8000-000000000002','succeeded');
 BEGIN
  PERFORM public.reserve_payper_dispatch('c0000000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'existing document was ignored';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'existing_accounting_document_or_dispatch' THEN RAISE; END IF;
 END;
 DELETE FROM public.accounting_documents WHERE source_id='a0000000-0000-4000-8000-000000000002';
 PERFORM public.reserve_payper_dispatch('c0000000-0000-4000-8000-000000000001');
 BEGIN
  PERFORM public.reserve_payper_dispatch('c0000000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'second document reserved';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT dispatch_remaining FROM public.payper_dispatch_control)<>0 THEN RAISE EXCEPTION 'quota incorrect'; END IF;
END $$;
-- The new reservation overload freezes the supplied identity and authoritative
-- VAT before hosted checkout. Missing identity remains a payable attempt.
DO $$ DECLARE result jsonb; v_payment_id uuid; BEGIN
 INSERT INTO public.orders VALUES('a0000000-0000-4000-8000-000000000006','PERSON-MISSING-ID',
  'd0000000-0000-4000-8000-000000000006','e0000000-0000-4000-8000-000000000006',1,118);
 INSERT INTO public.customer_snapshots VALUES('d0000000-0000-4000-8000-000000000006',
  'a0000000-0000-4000-8000-000000000006','e0000000-0000-4000-8000-000000000006',1,'person',1,
  '{"vat_applicable":true,"client_name":"Test","client_email":"test@example.org"}');
 result:=public.reserve_pelecard_live_order('a0000000-0000-4000-8000-000000000006',
  '88888888-8888-4888-8888-888888888888',11800,NULL,
  '{"kind":"person","name":"Test","identity":"","email":"test@example.org"}');
 v_payment_id:=(result->>'id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.payper_payment_billing_snapshots
  WHERE payment_id=v_payment_id AND billing_identity IS NULL AND vat_applicable=true)
 THEN RAISE EXCEPTION 'incomplete billing snapshot absent'; END IF;
 INSERT INTO public.sales VALUES('b0000000-0000-4000-8000-000000000006',
  'a0000000-0000-4000-8000-000000000006',v_payment_id,118);
 UPDATE public.payment_transactions SET sale_id='b0000000-0000-4000-8000-000000000006',
  provider_transaction_id='missing-id',status='succeeded',verified_at=clock_timestamp()+interval '1 second'
 WHERE id=v_payment_id;
 IF NOT EXISTS(SELECT 1 FROM public.payper_document_ledger
  WHERE payper_document_ledger.payment_id=v_payment_id AND state='source_blocked'
  AND reconciliation_code='billing_identity_required')
 THEN RAISE EXCEPTION 'manual billing review absent'; END IF;
 IF NOT public.note_payper_reconciliation(v_payment_id,'88888888-8888-4888-8888-888888888888',
  'PAYPER/REVIEW-6','Identity follow-up needed')
  OR (SELECT state FROM public.payper_document_ledger WHERE payment_id=v_payment_id)<>'source_blocked'
 THEN RAISE EXCEPTION 'manual review evidence did not remain held'; END IF;
END $$;
DO $$ DECLARE result jsonb; v_payment_id uuid; BEGIN
 INSERT INTO public.orders VALUES('a0000000-0000-4000-8000-000000000007','ORG-BAD-EMAIL',
  'd0000000-0000-4000-8000-000000000007','e0000000-0000-4000-8000-000000000007',1,118);
 INSERT INTO public.customer_snapshots VALUES('d0000000-0000-4000-8000-000000000007',
  'a0000000-0000-4000-8000-000000000007','e0000000-0000-4000-8000-000000000007',1,'organization',1,
  '{"vat_applicable":true,"billing_institution_name":"Example Ltd","billing_company_id":"512783333"}');
 result:=public.reserve_pelecard_live_order('a0000000-0000-4000-8000-000000000007',
  '88888888-8888-4888-8888-888888888888',11800,NULL,
  '{"kind":"organization","name":"Example Ltd","identity":"512783333","email":"invalid"}');
 v_payment_id:=(result->>'id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.payper_payment_billing_snapshots
  WHERE payment_id=v_payment_id AND billing_email IS NULL)
 THEN RAISE EXCEPTION 'invalid email was stored'; END IF;
 INSERT INTO public.sales VALUES('b0000000-0000-4000-8000-000000000007',
  'a0000000-0000-4000-8000-000000000007',v_payment_id,118);
 UPDATE public.payment_transactions SET sale_id='b0000000-0000-4000-8000-000000000007',
  provider_transaction_id='bad-email',status='succeeded',verified_at=clock_timestamp()+interval '1 second'
 WHERE id=v_payment_id;
 IF NOT EXISTS(SELECT 1 FROM public.payper_document_ledger
  WHERE payper_document_ledger.payment_id=v_payment_id AND state='source_blocked'
  AND reconciliation_code='billing_email_required')
 THEN RAISE EXCEPTION 'email review obligation absent'; END IF;
END $$;
SELECT 'payper_activation_rehearsal_passed' AS result;
-- Upgrade the existing payment guards only after the fixture's checkout tests.
CREATE TABLE public.pelecard_live_attempts(payment_id uuid,order_id uuid);
\ir ../migrations/202610300001_pelecard_admin_cashier_payment_access.sql
INSERT INTO public.profiles VALUES
 ('88888888-8888-4888-8888-888888888889','cashier'),
 ('88888888-8888-4888-8888-888888888890','operations');
DO $$ DECLARE billing jsonb; BEGIN
 billing:=public.get_payper_billing_defaults('a0000000-0000-4000-8000-000000000001',
  '88888888-8888-4888-8888-888888888889');
 IF billing->>'identity' IS DISTINCT FROM '000000018' THEN RAISE EXCEPTION 'cashier billing defaults denied'; END IF;
 BEGIN
  PERFORM public.get_payper_billing_defaults('a0000000-0000-4000-8000-000000000001',
   '88888888-8888-4888-8888-888888888890');
  RAISE EXCEPTION 'shift manager billing access accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.reserve_pelecard_live_order('a0000000-0000-4000-8000-000000000001',
   '88888888-8888-4888-8888-888888888890',11800,NULL,'{}');
  RAISE EXCEPTION 'shift manager reservation accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF has_table_privilege('authenticated','public.payper_payment_billing_snapshots','SELECT')
  OR has_table_privilege('authenticated','public.payper_payment_billing_snapshots','UPDATE')
 THEN RAISE EXCEPTION 'private billing snapshot became accessible'; END IF;
 BEGIN
  PERFORM public.activate_payper_new_payments('88888888-8888-4888-8888-888888888889');
  RAISE EXCEPTION 'cashier activated Payper';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 BEGIN
  PERFORM public.get_payper_billing_defaults('a0000000-0000-4000-8000-000000000001',
   '88888888-8888-4888-8888-888888888889');
  RAISE EXCEPTION 'browser direct billing RPC accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT 'pelecard_cashier_role_rehearsal_passed' AS result;
