-- DISPOSABLE LOCAL DATABASE ONLY: synthetic fixtures and local gate activation.
-- Never execute this suite against production, even inside a transaction.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO service_role,pelecard_controlled_live_adapter;
SELECT extensions.plan(25);
SELECT extensions.ok(to_regprocedure('public.uuid_generate_v4()') IS NULL,'production has no public uuid helper');
SELECT extensions.ok(to_regprocedure('extensions.uuid_generate_v4()') IS NOT NULL,'uuid-ossp lives in extensions');
SELECT extensions.ok(to_regprocedure('pg_catalog.gen_random_uuid()') IS NOT NULL,'core UUID function is available');
SELECT extensions.ok(NOT has_function_privilege('service_role','public.persist_pelecard_controlled_live_adapter_session(uuid,text,text,text)','EXECUTE'),'Edge cannot use adapter persistence');
SELECT extensions.ok(NOT has_function_privilege('authenticated','public.persist_pelecard_controlled_live_adapter_session(uuid,text,text,text)','EXECUTE'),'browser cannot persist adapter response');
INSERT INTO auth.users(id,email) VALUES ('76000000-0000-4000-8000-000000000001','schema-parity@example.test');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
UPDATE public.profiles SET role='admin' WHERE id='76000000-0000-4000-8000-000000000001';
INSERT INTO public.orders(id,order_number,client_name,client_phone,activity_date,num_participants,total_price)
VALUES ('a57ebbc6-47a9-4e74-9208-3340f8508df7','ORD-1039','LOCAL schema parity','0500000000',CURRENT_DATE,1,35);
INSERT INTO public.accounting_events(id,source_type,source_id,purpose,accounting_provider) VALUES
  ('76000000-0000-4000-8000-000000000010','order','ordinary-local-order','payment_success','rivhit'),
  ('76000000-0000-4000-8000-000000000011','order','a57ebbc6-47a9-4e74-9208-3340f8508df7','payment_success','rivhit');
-- Synthetic corruption probe is rolled back by throws_ok's subtransaction.
SELECT extensions.throws_ok($probe$DO $body$ BEGIN
  PERFORM public.reserve_pelecard_payment('76000000-0000-4000-8000-000000000099',
    'a57ebbc6-47a9-4e74-9208-3340f8508df7','76000000-0000-4000-8000-000000000001',
    'local-corrupt-amount',36,'ILS','{}');
  UPDATE public.pelecard_controlled_live_control SET payment_id='76000000-0000-4000-8000-000000000099',dispatch_started_at=now();
  SET LOCAL ROLE pelecard_controlled_live_adapter;
  PERFORM public.persist_pelecard_controlled_live_adapter_session('76000000-0000-4000-8000-000000000099',
    '76000000-0000-4000-8000-000000000002','synthetic-key',
    'https://gateway20.pelecard.biz/PaymentGW?transactionId=76000000-0000-4000-8000-000000000002');
END $body$;$probe$,'23514','controlled_live_attempt_mismatch','adapter rejects even a corrupted control row with wrong commercial amount');
SET LOCAL ROLE service_role;
SET LOCAL search_path='';
SELECT extensions.ok((SELECT claimed FROM public.claim_accounting_event('76000000-0000-4000-8000-000000000010','local-parity-worker',300,false)),'ordinary accounting claim uses core UUID under actual role and empty path');
SELECT extensions.throws_ok($$SELECT public.reserve_pelecard_controlled_live('76000000-0000-4000-8000-000000000001')$$,'23514','controlled_live_disabled','actual service role still obeys disabled gate');
RESET ROLE;
UPDATE public.pelecard_controlled_live_control SET enabled=true;
SET LOCAL ROLE service_role;
SELECT extensions.is(current_user::text,'service_role','reservation executes with actual service ACLs');
SELECT extensions.ok((public.reserve_pelecard_controlled_live('76000000-0000-4000-8000-000000000001')->>'created')::boolean,'full reservation succeeds with extensions schema and empty search path');
SELECT extensions.throws_ok($$SELECT * FROM public.claim_accounting_event('76000000-0000-4000-8000-000000000011','local-parity-worker',300,true)$$,'23514','controlled_live_accounting_hold','correct UUID resolution still preserves accounting hold');
SELECT set_config('test.parity_payment',(public.reserve_pelecard_controlled_live('76000000-0000-4000-8000-000000000001')->>'id'),true);
SELECT extensions.ok(NOT(public.reserve_pelecard_controlled_live('76000000-0000-4000-8000-000000000001')->>'created')::boolean,'retry retains one attempt');
SELECT extensions.is((SELECT count(*) FROM public.payment_transaction_events WHERE payment_transaction_id=current_setting('test.parity_payment')::uuid),1::bigint,'audit default resolves its extension dependency');
RESET ROLE;
SET LOCAL ROLE pelecard_controlled_live_adapter;
SELECT extensions.throws_ok($$SELECT public.persist_pelecard_controlled_live_adapter_session(current_setting('test.parity_payment')::uuid,'76000000-0000-4000-8000-000000000002','synthetic-key','https://gateway20.pelecard.biz/PaymentGW?transactionId=76000000-0000-4000-8000-000000000002')$$,'23514','controlled_live_attempt_mismatch','cannot persist before dispatch claim');
SELECT extensions.is((SELECT amount_minor FROM public.claim_pelecard_controlled_live_init(current_setting('test.parity_payment')::uuid)),3500,'actual restricted adapter claims authoritative amount');
SELECT extensions.is((SELECT count(*) FROM public.claim_pelecard_controlled_live_init(current_setting('test.parity_payment')::uuid)),0::bigint,'actual restricted adapter cannot redispatch');
SELECT extensions.throws_ok($$SELECT public.persist_pelecard_controlled_live_adapter_session('76000000-0000-4000-8000-000000000099','76000000-0000-4000-8000-000000000002','synthetic-key','https://gateway20.pelecard.biz/PaymentGW?transactionId=76000000-0000-4000-8000-000000000002')$$,'23514','controlled_live_attempt_mismatch','adapter cannot attach response to other payment');
SELECT extensions.throws_ok($$SELECT public.persist_pelecard_controlled_live_adapter_session(current_setting('test.parity_payment')::uuid,'invalid','synthetic-key','https://gateway20.pelecard.biz/PaymentGW?transactionId=invalid')$$,'23514','controlled_live_invalid_session','adapter rejects invalid provider identifier');
SELECT extensions.lives_ok($$SELECT public.persist_pelecard_controlled_live_adapter_session(current_setting('test.parity_payment')::uuid,'76000000-0000-4000-8000-000000000002','synthetic-key','https://gateway20.pelecard.biz/PaymentGW?transactionId=76000000-0000-4000-8000-000000000002')$$,'adapter durably persists before Edge response');
SELECT extensions.is((SELECT transaction_id FROM public.get_pelecard_controlled_live_attempt(current_setting('test.parity_payment')::uuid)),'76000000-0000-4000-8000-000000000002','session remains available without Edge save');
SELECT extensions.throws_ok($$SELECT public.persist_pelecard_controlled_live_adapter_session(current_setting('test.parity_payment')::uuid,'76000000-0000-4000-8000-000000000003','synthetic-key','https://gateway20.pelecard.biz/PaymentGW?transactionId=76000000-0000-4000-8000-000000000003')$$,'23514','controlled_live_session_mismatch','second provider session cannot overwrite first');
SELECT extensions.is((SELECT count(*) FROM public.claim_pelecard_controlled_live_init(current_setting('test.parity_payment')::uuid)),0::bigint,'persistence never releases dispatch claim');
SELECT extensions.lives_ok($$SELECT public.persist_pelecard_controlled_live_adapter_session(current_setting('test.parity_payment')::uuid,'76000000-0000-4000-8000-000000000002','synthetic-key','https://gateway20.pelecard.biz/PaymentGW?transactionId=76000000-0000-4000-8000-000000000002')$$,'same durable session may be acknowledged again');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT public.save_pelecard_controlled_live_session(current_setting('test.parity_payment')::uuid,
  '76000000-0000-4000-8000-000000000002','synthetic-key',
  'https://gateway20.pelecard.biz/PaymentGW?transactionId=76000000-0000-4000-8000-000000000002');
SELECT public.finalize_pelecard_controlled_live(current_setting('test.parity_payment')::uuid,
  '76000000-0000-4000-8000-000000000002','synthetic-approval','000',35,'ILS');
SELECT extensions.is((SELECT count(*) FROM public.sales WHERE order_id='a57ebbc6-47a9-4e74-9208-3340f8508df7'),1::bigint,'actual service finalization resolves sale defaults under empty search path');
SELECT extensions.is((SELECT count(*) FROM public.accounting_events WHERE source_id=current_setting('test.parity_payment')),0::bigint,'commercial success retains accounting hold');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
