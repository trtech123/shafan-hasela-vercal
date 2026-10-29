\set ON_ERROR_STOP on
-- Run in a disposable local PostgreSQL database. This fixture models the
-- columns touched by the Payper migration, not the full Supabase schema.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text);
INSERT INTO public.profiles(id,role) VALUES('88888888-8888-4888-8888-888888888888','admin');
CREATE TABLE public.orders(id uuid PRIMARY KEY,order_number text,customer_snapshot_id uuid,customer_id uuid,customer_record_version int,total_price numeric);
CREATE TABLE public.sales(id uuid PRIMARY KEY,order_id uuid,payment_transaction_id uuid,total numeric);
CREATE TABLE public.customer_snapshots(id uuid PRIMARY KEY,order_id uuid,customer_id uuid,revision int,customer_kind text,customer_version int,data jsonb);
CREATE TABLE public.payment_transactions(id uuid PRIMARY KEY,provider text,operation text,status text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),verified_at timestamptz,provider_transaction_id text,order_id uuid,sale_id uuid,currency text,amount numeric,checkout_snapshot jsonb);
CREATE TABLE public.accounting_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),accounting_provider text,purpose text,source_type text,source_id text,status text,worker_id text,lease_token uuid,lease_expires_at timestamptz,next_attempt_at timestamptz,last_error jsonb,attempt_count int DEFAULT 0);
CREATE TABLE public.accounting_documents(provider text,source_type text,source_id text,status text);
CREATE TABLE public.immediate_accounting_preparations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),payment_id uuid,method text,customer_creation_started_at timestamptz,dispatch_started_at timestamptz);
INSERT INTO public.accounting_events(accounting_provider,purpose,source_type,source_id,status)
VALUES ('rivhit','payment_success','payment_transaction','legacy-pending','pending'),
       ('rivhit','payment_success','payment_transaction','legacy-retry','retryable_error'),
       ('rivhit','payment_success','payment_transaction','legacy-processing','processing'),
       ('rivhit','manual','order','other-bookkeeping','pending');
INSERT INTO public.immediate_accounting_preparations(payment_id,method)
VALUES ('11111111-1111-4111-8111-111111111111','pelecard'),
       (NULL,'cash');
INSERT INTO public.accounting_documents(provider,source_type,source_id,status)
VALUES('rivhit','order','44444444-4444-4444-8444-444444444444','processing');
\ir ../migrations/202610220003_payper_disabled_ledger.sql
-- Simulate the later activation instant locally while real dispatch stays off.
DO $$ BEGIN
 BEGIN
  UPDATE public.payper_dispatch_control SET activation_cutoff_utc=clock_timestamp()-interval '1 second';
  RAISE EXCEPTION 'backdated activation accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE public.payper_dispatch_control SET activation_cutoff_utc=clock_timestamp();
INSERT INTO public.customer_snapshots(id,order_id,customer_id,revision,customer_kind,customer_version,data)
VALUES('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444',
 '55555555-5555-4555-8555-555555555555',1,'person',1,
 '{"vat_applicable":true,"client_name":"Test Customer","client_email":"test@example.org"}');
INSERT INTO public.orders(id,order_number,customer_snapshot_id,customer_id,customer_record_version,total_price)
VALUES('44444444-4444-4444-8444-444444444444','LOCAL-1','33333333-3333-4333-8333-333333333333',
 '55555555-5555-4555-8555-555555555555',1,100);
INSERT INTO public.sales(id,order_id,payment_transaction_id,total)
VALUES('66666666-6666-4666-8666-666666666666','44444444-4444-4444-8444-444444444444',
 '77777777-7777-4777-8777-777777777777',100);
INSERT INTO public.payment_transactions(id,provider,operation,status,created_at,verified_at,provider_transaction_id,order_id,sale_id,currency,amount,checkout_snapshot)
VALUES('77777777-7777-4777-8777-777777777777','pelecard','payment','initiated',
 (SELECT activation_cutoff_utc FROM public.payper_dispatch_control),
 (SELECT activation_cutoff_utc+interval '1 second' FROM public.payper_dispatch_control),'test-transaction',
 '44444444-4444-4444-8444-444444444444','66666666-6666-4666-8666-666666666666','ILS',100,
 '{"items":[{"id":"item","name":"Test","qty":1,"customPrice":100}],"discount":null}');
INSERT INTO public.payper_payment_billing_snapshots(payment_id,order_id,source_customer_snapshot_id,customer_kind,billing_name,billing_identity,billing_email,vat_applicable)
VALUES('77777777-7777-4777-8777-777777777777','44444444-4444-4444-8444-444444444444',
 '33333333-3333-4333-8333-333333333333','person','Test Customer','000000018','test@example.org',true);
UPDATE public.payment_transactions SET status='succeeded' WHERE id='77777777-7777-4777-8777-777777777777';
UPDATE public.immediate_accounting_preparations SET payment_id='77777777-7777-4777-8777-777777777777' WHERE method='pelecard';
-- Historical attempt finalized by a delayed callback stays outside Payper.
INSERT INTO public.orders(id,order_number,total_price) VALUES
 ('a0000000-0000-4000-8000-000000000001','BEFORE',100),
 ('a0000000-0000-4000-8000-000000000002','AT',100),
 ('a0000000-0000-4000-8000-000000000003','AFTER',100);
INSERT INTO public.sales(id,order_id,payment_transaction_id,total) VALUES
 ('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',100),
 ('b0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002',100),
 ('b0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000003',100);
INSERT INTO public.payment_transactions(id,provider,operation,status,created_at,verified_at,provider_transaction_id,order_id,sale_id,currency,amount,checkout_snapshot) VALUES
 ('c0000000-0000-4000-8000-000000000001','pelecard','payment','pending_provider',(SELECT activation_cutoff_utc-interval '1 microsecond' FROM public.payper_dispatch_control),NULL,NULL,'a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','ILS',100,'{"items":[{"id":"item","name":"Test","qty":1,"customPrice":100}],"discount":null}'),
 ('c0000000-0000-4000-8000-000000000002','pelecard','payment','succeeded',(SELECT activation_cutoff_utc FROM public.payper_dispatch_control),(SELECT activation_cutoff_utc FROM public.payper_dispatch_control),'at-transaction','a0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','ILS',100,'{"items":[{"id":"item","name":"Test","qty":1,"customPrice":100}],"discount":null}'),
 ('c0000000-0000-4000-8000-000000000003','pelecard','payment','succeeded',(SELECT activation_cutoff_utc+interval '1 microsecond' FROM public.payper_dispatch_control),(SELECT activation_cutoff_utc+interval '1 second' FROM public.payper_dispatch_control),'after-transaction','a0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000003','ILS',100,'{"items":[{"id":"item","name":"Test","qty":1,"customPrice":100}],"discount":null}');
UPDATE public.payment_transactions SET status='succeeded',
 verified_at=(SELECT activation_cutoff_utc+interval '5 minutes' FROM public.payper_dispatch_control),provider_transaction_id='late-transaction'
 WHERE id='c0000000-0000-4000-8000-000000000001';
INSERT INTO public.accounting_events(accounting_provider,purpose,source_type,source_id,status) VALUES
 ('rivhit','payment_success','payment_transaction','c0000000-0000-4000-8000-000000000001','pending'),
 ('rivhit','payment_success','payment_transaction','c0000000-0000-4000-8000-000000000002','pending'),
 ('rivhit','payment_success','payment_transaction','c0000000-0000-4000-8000-000000000003','pending'),
 ('rivhit','payment_success','payment_transaction','c0000000-0000-4000-8000-000000000003','retryable_error');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.payper_document_ledger WHERE payment_id='c0000000-0000-4000-8000-000000000001')
 OR NOT EXISTS(SELECT 1 FROM public.payper_document_ledger WHERE payment_id='c0000000-0000-4000-8000-000000000002')
 OR NOT EXISTS(SELECT 1 FROM public.payper_document_ledger WHERE payment_id='c0000000-0000-4000-8000-000000000003')
 THEN RAISE EXCEPTION 'activation boundary captured wrong payments'; END IF;
 IF (SELECT status FROM public.accounting_events WHERE source_id='c0000000-0000-4000-8000-000000000001')<>'pending'
 OR (SELECT count(*) FROM public.accounting_events WHERE source_id IN ('c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000003') AND status='configuration_required')<>3
 THEN RAISE EXCEPTION 'Rivhit cutoff ownership mismatch'; END IF;
 BEGIN
  UPDATE public.payper_dispatch_control SET activation_cutoff_utc=activation_cutoff_utc-interval '1 second';
  RAISE EXCEPTION 'cutoff was mutable';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$
DECLARE facts jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.payper_document_ledger WHERE payment_id='77777777-7777-4777-8777-777777777777' AND state='eligible') THEN RAISE EXCEPTION 'eligibility not captured'; END IF;
 facts:=public.freeze_payper_source('77777777-7777-4777-8777-777777777777');
 IF facts->>'orderNumber'<>'LOCAL-1' THEN RAISE EXCEPTION 'wrong frozen source'; END IF;
 BEGIN
  PERFORM public.reserve_payper_dispatch('77777777-7777-4777-8777-777777777777');
  RAISE EXCEPTION 'dispatch reservation unexpectedly succeeded';
 EXCEPTION WHEN insufficient_privilege THEN
  NULL;
 END;
END $$;
DO $$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM public.accounting_events WHERE (source_id='legacy-pending' AND status='pending') OR (source_id='legacy-retry' AND status='retryable_error');
 IF n<>2 THEN RAISE EXCEPTION 'historical events changed: %',n; END IF;
 IF (SELECT status FROM public.accounting_events WHERE source_id='legacy-processing')<>'processing' THEN RAISE EXCEPTION 'in-flight state changed'; END IF;
 IF (SELECT status FROM public.accounting_events WHERE source_id='other-bookkeeping')<>'pending' THEN RAISE EXCEPTION 'unrelated bookkeeping changed'; END IF;
 IF (SELECT enabled FROM public.payper_dispatch_control) THEN RAISE EXCEPTION 'Payper dispatch enabled'; END IF;
END $$;
-- Disposable transaction only: exercise the future reservation's existing
-- document guard, then roll back the temporary control-table change.
BEGIN;
ALTER TABLE public.payper_dispatch_control DROP CONSTRAINT payper_dispatch_control_enabled_check;
UPDATE public.payper_dispatch_control SET enabled=true;
DO $$ BEGIN
 BEGIN
  PERFORM public.reserve_payper_dispatch('77777777-7777-4777-8777-777777777777');
  RAISE EXCEPTION 'existing Rivhit document did not block Payper reservation';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'existing_accounting_document_or_dispatch' THEN RAISE; END IF;
 END;
END $$;
ROLLBACK;
-- Reconciliation evidence can be attached once, but cannot release a row.
BEGIN;
UPDATE public.payper_document_ledger SET state='dispatch_reserved',dispatch_reserved_at=now()
 WHERE payment_id='77777777-7777-4777-8777-777777777777';
SELECT public.record_payper_dispatch_outcome('77777777-7777-4777-8777-777777777777','reconciliation_required',NULL,NULL,'provider_transport_uncertain');
DO $$ BEGIN
 IF NOT public.note_payper_reconciliation('77777777-7777-4777-8777-777777777777',
   '88888888-8888-4888-8888-888888888888','PAYPER/REVIEW-1','Reviewed locally')
 OR public.note_payper_reconciliation('77777777-7777-4777-8777-777777777777',
   '88888888-8888-4888-8888-888888888888','PAYPER/REVIEW-2','Duplicate note')
 THEN RAISE EXCEPTION 'manual evidence was not one-shot'; END IF;
 IF (SELECT state FROM public.payper_document_ledger WHERE payment_id='77777777-7777-4777-8777-777777777777')<>'reconciliation_required'
 THEN RAISE EXCEPTION 'manual evidence released dispatch'; END IF;
END $$;
ROLLBACK;
-- Attempts are isolated with PL/pgSQL subtransactions, so a rejected write
-- does not terminate the rest of the rehearsal.
INSERT INTO public.accounting_events(accounting_provider,purpose,source_type,source_id,status)
VALUES('rivhit','payment_success','payment_transaction','77777777-7777-4777-8777-777777777777','processing');
DO $$ BEGIN
 IF (SELECT status FROM public.accounting_events WHERE source_id='77777777-7777-4777-8777-777777777777')<>'configuration_required' THEN RAISE EXCEPTION 'new event was not held'; END IF;
END $$;
DO $$
DECLARE q text;
BEGIN
 FOREACH q IN ARRAY ARRAY[
  $q$UPDATE public.accounting_events SET status='processing' WHERE source_id='77777777-7777-4777-8777-777777777777'$q$,
  $q$UPDATE public.accounting_events SET status='processing',lease_token=gen_random_uuid() WHERE source_id='77777777-7777-4777-8777-777777777777'$q$,
  $q$UPDATE public.immediate_accounting_preparations SET customer_creation_started_at=now() WHERE method='pelecard'$q$,
  $q$UPDATE public.immediate_accounting_preparations SET dispatch_started_at=now() WHERE method='pelecard'$q$,
  $q$INSERT INTO public.accounting_documents(provider,source_type,source_id,status) VALUES('rivhit','order','44444444-4444-4444-8444-444444444444','processing')$q$,
  $q$INSERT INTO public.accounting_documents(provider,source_type,source_id,status) VALUES('rivhit','payment_transaction','77777777-7777-4777-8777-777777777777','processing')$q$,
  $q$INSERT INTO public.accounting_documents(provider,source_type,source_id,status) VALUES('rivhit','sale','66666666-6666-4666-8666-666666666666','processing')$q$,
  $q$UPDATE public.accounting_documents SET status='processing' WHERE source_type='order' AND source_id='44444444-4444-4444-8444-444444444444'$q$,
  $q$UPDATE public.payper_dispatch_control SET enabled=true$q$
 ] LOOP
  BEGIN
   EXECUTE q;
   RAISE EXCEPTION 'unsafe operation unexpectedly succeeded: %',q;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
   NULL;
  END;
 END LOOP;
END $$;
UPDATE public.accounting_events SET status='processing' WHERE source_id='other-bookkeeping';
UPDATE public.accounting_events SET status='processing' WHERE source_id='legacy-pending';
UPDATE public.accounting_events SET status='processing',lease_token=gen_random_uuid() WHERE source_id='legacy-processing';
INSERT INTO public.immediate_accounting_preparations(payment_id,method)
VALUES('c0000000-0000-4000-8000-000000000001','pelecard');
UPDATE public.immediate_accounting_preparations SET dispatch_started_at=now()
 WHERE payment_id='c0000000-0000-4000-8000-000000000001';
UPDATE public.immediate_accounting_preparations SET customer_creation_started_at=now(),dispatch_started_at=now() WHERE method='cash';
INSERT INTO public.accounting_documents(provider,source_type,source_id,status)
VALUES('rivhit','order','unrelated-order','processing');
DO $$ BEGIN
 IF (SELECT status FROM public.accounting_events WHERE source_id='other-bookkeeping')<>'processing' THEN RAISE EXCEPTION 'bookkeeping was blocked'; END IF;
 IF (SELECT dispatch_started_at FROM public.immediate_accounting_preparations WHERE method='cash') IS NULL THEN RAISE EXCEPTION 'cash issuance was blocked'; END IF;
END $$;
SELECT 'payper_disabled_ledger_rehearsal_passed' AS result;
