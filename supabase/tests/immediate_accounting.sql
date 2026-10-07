-- Local synthetic fixtures only. No provider connection and every mutation rolls back.
BEGIN;
SET search_path=public,extensions;
SELECT extensions.plan(45);

-- New-schema eligibility fixtures; the pre-041 regression run remains supported.
CREATE FUNCTION pg_temp.bind_fixture_customers() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $fixture$
DECLARE saved text; rec record;
BEGIN
 IF to_regclass('public.customers') IS NULL THEN RETURN; END IF;
 saved:=current_setting('request.jwt.claims',true);
 PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"89000000-0000-4000-8000-000000000001"}',true);
 INSERT INTO public.customers(id,display_name,phone,vat_applicable) VALUES('89ffffff-0000-4000-8000-000000000001','Synthetic','0500000000',true) ON CONFLICT(id) DO NOTHING;
 FOR rec IN SELECT id FROM public.orders WHERE id IN('89000000-0000-4000-8000-000000000010','89000000-0000-4000-8000-000000000011','8a000000-0000-4000-8000-000000000010','8a000000-0000-4000-8000-000000000011') AND customer_snapshot_id IS NULL LOOP
  PERFORM public.link_order_customer(rec.id,'89ffffff-0000-4000-8000-000000000001',0);
 END LOOP;
 PERFORM set_config('request.jwt.claims',coalesce(saved,''),true);
END $fixture$;
CREATE FUNCTION pg_temp.frozen_fixture(p_snapshot jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $fixture$
DECLARE s record;
BEGIN
 IF to_regclass('public.customer_snapshots') IS NULL THEN RETURN p_snapshot; END IF;
 SELECT cs.* INTO STRICT s FROM public.orders o JOIN public.customer_snapshots cs ON cs.id=o.customer_snapshot_id WHERE o.id=(p_snapshot->>'orderId')::uuid;
 RETURN p_snapshot || jsonb_build_object('billing',p_snapshot->'billing'||jsonb_build_object('customerId',s.customer_id,'customerSnapshotId',s.id,'customerVersion',s.customer_version,'vatApplicable',true,'address',coalesce(s.data->>'billing_address_line',''),'city',coalesce(s.data->>'billing_city',''),'postalCode',coalesce(s.data->>'billing_postal_code',''),'countryCode',coalesce(s.data->>'billing_country_code','')),'vat',p_snapshot->'vat'||jsonb_build_object('applicable',true,'configuredRatePercent',18,'policyRevision','rivhit-account-2026-09-30','vatMinor',721,'netMinor',4004));
END $fixture$;
INSERT INTO auth.users(id,email) VALUES ('89000000-0000-4000-8000-000000000001','immediate-admin@example.test'),('89000000-0000-4000-8000-000000000002','immediate-staff@example.test');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
UPDATE public.profiles SET role='admin' WHERE id='89000000-0000-4000-8000-000000000001';
INSERT INTO public.orders(id,order_number,client_name,client_phone,activity_date,num_participants,total_price) VALUES ('89000000-0000-4000-8000-000000000010','LOCAL-IMMEDIATE','Synthetic','0500000000',CURRENT_DATE,1,47.25),('89000000-0000-4000-8000-000000000011','LOCAL-IMMEDIATE-CHECK','Synthetic','0500000000',CURRENT_DATE,1,50);
SELECT pg_temp.bind_fixture_customers();
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"89000000-0000-4000-8000-000000000002"}',true);
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok($$SELECT public.complete_manual_order_payment('89000000-0000-4000-8000-000000000010','cash','89000000-0000-4000-8000-000000000020')$$,'42501','administrator_required','staff cannot record payment');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"89000000-0000-4000-8000-000000000001"}',true);
SELECT extensions.throws_ok($$SELECT public.complete_manual_order_payment('89000000-0000-4000-8000-000000000010',NULL,'89000000-0000-4000-8000-000000000020')$$,'P0001','invalid_manual_payment','null method rejected');
SELECT extensions.throws_ok($$SELECT public.complete_manual_order_payment('89000000-0000-4000-8000-000000000010','cash','89000000-0000-4000-8000-000000000020',NULL)$$,'P0001','invalid_manual_payment','null details rejected');
SELECT extensions.is((public.complete_manual_order_payment('89000000-0000-4000-8000-000000000010','cash','89000000-0000-4000-8000-000000000020')->>'duplicate')::boolean,false,'cash completion succeeds');
SELECT extensions.is((public.complete_manual_order_payment('89000000-0000-4000-8000-000000000010','cash','89000000-0000-4000-8000-000000000020')->>'duplicate')::boolean,true,'same request returns same payment');
SELECT extensions.throws_ok($$SELECT public.complete_manual_order_payment('89000000-0000-4000-8000-000000000010','cash','89000000-0000-4000-8000-000000000021')$$,'P0001','order_already_paid','different idempotency key rejected');
SELECT extensions.is((SELECT amount_minor FROM public.manual_order_payments WHERE order_id='89000000-0000-4000-8000-000000000010'),4725,'amount is authoritative order total');
SELECT extensions.throws_ok($$UPDATE public.immediate_accounting_preparations SET issuance_approved=true WHERE id=gen_random_uuid()$$,'42501',NULL,'admin cannot approve via table');
SELECT extensions.throws_ok($$SELECT public.complete_manual_order_payment('89000000-0000-4000-8000-000000000011','check','89000000-0000-4000-8000-000000000021','{}')$$,'P0001','invalid_check_details','missing check fields rejected');
SELECT extensions.lives_ok($$SELECT public.complete_manual_order_payment('89000000-0000-4000-8000-000000000011','check','89000000-0000-4000-8000-000000000021','{"bankCode":"12","branchNumber":"123","accountNumber":"456","checkNumber":"789","dueDate":"2026-10-01"}')$$,'complete valid check');
RESET ROLE;
CREATE TEMP TABLE immediate_fixture AS SELECT m.id AS payment_id,m.sale_id,m.order_id,
 jsonb_build_object('sourceId',m.id,'orderId',m.order_id,'saleId',m.sale_id,'companyId',512783333,'amountMinor',4725,'billing',jsonb_build_object('approved',true,'noPriorInvoice',true,'name','Synthetic','email','','phone','0500000000'),'vat',jsonb_build_object('vatPercent',18,'grossMinor',4725),'document',jsonb_build_object('document_type',2,'sort_code',100,'price_include_vat',true,'send_mail',false,'prevent_duplicates',true,'currency_id',1,'default_email',false,'digital_signature',true,'request_reference',m.id,'order','LOCAL-IMMEDIATE','payments',jsonb_build_array(jsonb_build_object('payment_type',2,'amount_nis',47.25)))) AS snapshot
 FROM public.manual_order_payments m WHERE m.order_id='89000000-0000-4000-8000-000000000010';
UPDATE immediate_fixture SET snapshot=pg_temp.frozen_fixture(snapshot);
GRANT SELECT ON immediate_fixture TO service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.prepare_immediate_accounting(order_id,'89000000-0000-4000-8000-000000000001',snapshot-'companyId',repeat('a',64)) FROM immediate_fixture$$,'P0001','accounting_snapshot_invalid','missing required source fields rejected');
SELECT extensions.throws_ok($$SELECT public.prepare_immediate_accounting(order_id,'89000000-0000-4000-8000-000000000001',jsonb_set(snapshot,'{amountMinor}','1'),repeat('a',64)) FROM immediate_fixture$$,'P0001','accounting_snapshot_invalid','amount mismatch rejected');
SELECT extensions.throws_ok($$SELECT public.prepare_immediate_accounting(order_id,'89000000-0000-4000-8000-000000000001',jsonb_set(snapshot,'{billing,name}','"Changed"'),repeat('a',64)) FROM immediate_fixture$$,'P0001','billing_review_changed','locked canonical name required');
SELECT extensions.throws_ok($$SELECT public.prepare_immediate_accounting(order_id,'89000000-0000-4000-8000-000000000001',jsonb_set(snapshot,'{billing,email}','"changed@example.test"'),repeat('a',64)) FROM immediate_fixture$$,'P0001','billing_review_changed','locked canonical email required');
SELECT extensions.throws_ok($$SELECT public.prepare_immediate_accounting(order_id,'89000000-0000-4000-8000-000000000001',jsonb_set(snapshot,'{billing,phone}','"0501234567"'),repeat('a',64)) FROM immediate_fixture$$,'P0001','billing_review_changed','locked canonical phone required');
SELECT extensions.throws_ok($$SELECT public.prepare_immediate_accounting(order_id,'89000000-0000-4000-8000-000000000001',jsonb_set(snapshot,'{billing,companyId}','"512783333"'),repeat('a',64)) FROM immediate_fixture$$,'P0001','billing_review_changed','locked canonical company id required');
SELECT extensions.lives_ok($$SELECT public.prepare_immediate_accounting(order_id,'89000000-0000-4000-8000-000000000001',snapshot,repeat('a',64)) FROM immediate_fixture$$,'valid preparation');
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_preparations WHERE order_id='89000000-0000-4000-8000-000000000010'),1::bigint,'exactly one preparation');
SELECT extensions.lives_ok($$SELECT public.prepare_immediate_accounting(order_id,'89000000-0000-4000-8000-000000000001',snapshot,repeat('a',64)) FROM immediate_fixture$$,'prepare idempotent');
SELECT extensions.throws_ok($$SELECT public.prepare_immediate_accounting(order_id,'89000000-0000-4000-8000-000000000001',snapshot,NULL) FROM immediate_fixture$$,'P0001','accounting_snapshot_conflict','null cannot bypass immutable hash');
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_preparations a CROSS JOIN LATERAL public.claim_immediate_accounting_dispatch(a.id) c WHERE a.order_id='89000000-0000-4000-8000-000000000010'),0::bigint,'unapproved dispatch has zero winners');
SELECT extensions.throws_ok($$UPDATE public.immediate_accounting_preparations SET issuance_approved=true WHERE order_id='89000000-0000-4000-8000-000000000010'$$,'42501',NULL,'service cannot directly approve');
SELECT extensions.throws_ok($$SELECT public.persist_immediate_accounting_result(id,'89000000-0000-4000-8000-000000000001',repeat('a',64),'reconciliation_required') FROM public.immediate_accounting_preparations WHERE order_id='89000000-0000-4000-8000-000000000010'$$,'P0001','dispatch_not_started','cannot invent reconciliation before dispatch');
RESET ROLE;
SELECT extensions.throws_ok($$UPDATE public.immediate_accounting_preparations SET snapshot='{}' WHERE order_id='89000000-0000-4000-8000-000000000010'$$,'P0001','accounting_snapshot_immutable','even table owner cannot rewrite snapshot');
SELECT extensions.throws_ok($$DELETE FROM public.manual_order_payments WHERE order_id='89000000-0000-4000-8000-000000000010'$$,'P0001','accounting_history_immutable','payment audit cannot be deleted');
SELECT extensions.is((SELECT count(*) FROM public.sales WHERE order_id='89000000-0000-4000-8000-000000000010'),1::bigint,'one sale under retries');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"89000000-0000-4000-8000-000000000002"}',true);
SET LOCAL ROLE authenticated;
SELECT extensions.is((SELECT count(*) FROM public.manual_order_payments),0::bigint,'staff cannot read manual payment history');
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_preparations),0::bigint,'staff cannot read snapshots');
RESET ROLE;
-- Explicit owner approval occurs ONLY in this disposable, rolled-back synthetic fixture.
INSERT INTO public.immediate_accounting_activation_permits(preparation_id,payload_hash,approved_by,capability_hash)
 SELECT id,payload_hash,'89000000-0000-4000-8000-000000000001',encode(sha256(convert_to(repeat('c',64),'UTF8')),'hex') FROM public.immediate_accounting_preparations WHERE order_id='89000000-0000-4000-8000-000000000010';
 SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
 SELECT public.activate_immediate_accounting(id,'89000000-0000-4000-8000-000000000001',payload_hash,repeat('c',64)) FROM public.immediate_accounting_preparations WHERE order_id='89000000-0000-4000-8000-000000000010';
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.claim_accounting_event(event_id,'synthetic',300,true) FROM public.immediate_accounting_preparations WHERE order_id='89000000-0000-4000-8000-000000000010'$$,'P0001','immediate_accounting_dispatch_required','generic outbox cannot dispatch this lane');
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_preparations a CROSS JOIN LATERAL public.claim_immediate_accounting_dispatch(a.id) c WHERE a.order_id='89000000-0000-4000-8000-000000000010'),0::bigint,'approval alone cannot bypass missing expected identity');
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_preparations a CROSS JOIN LATERAL public.claim_immediate_accounting_customer(a.id,'89000000-0000-4000-8000-000000000001',repeat('a',64)) c WHERE a.order_id='89000000-0000-4000-8000-000000000010'),1::bigint,'one customer creation claim');
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_preparations a CROSS JOIN LATERAL public.claim_immediate_accounting_customer(a.id,'89000000-0000-4000-8000-000000000001',repeat('a',64)) c WHERE a.order_id='89000000-0000-4000-8000-000000000010'),0::bigint,'customer creation cannot reissue');
SELECT extensions.lives_ok($$SELECT public.persist_immediate_accounting_customer(id,'89000000-0000-4000-8000-000000000001',repeat('a',64),'123','synthetic-account') FROM public.immediate_accounting_preparations WHERE order_id='89000000-0000-4000-8000-000000000010'$$,'persist customer identity');
SELECT extensions.throws_ok($$SELECT public.persist_immediate_accounting_customer(id,'89000000-0000-4000-8000-000000000001',repeat('a',64),'124','synthetic-account') FROM public.immediate_accounting_preparations WHERE order_id='89000000-0000-4000-8000-000000000010'$$,'P0001','accounting_customer_immutable','customer identity cannot change');
SELECT extensions.throws_ok($$SELECT public.freeze_immediate_accounting_expected(id,'89000000-0000-4000-8000-000000000001',repeat('a',64),jsonb_build_object('companyId',512783333,'amountMinor',4725,'documentType',2,'vatPercent',18,'vat',snapshot->'vat','orderNumber','LOCAL-IMMEDIATE','paymentType',2)) FROM public.immediate_accounting_preparations WHERE order_id='89000000-0000-4000-8000-000000000010'$$,'P0001','accounting_expected_invalid','missing immutable request reference rejected');
SELECT extensions.lives_ok($$SELECT public.freeze_immediate_accounting_expected(id,'89000000-0000-4000-8000-000000000001',repeat('a',64),jsonb_build_object('accountingCustomerId',accounting_customer_id,'accountNamespace','synthetic-account','customerId','123','companyId',512783333,'amountMinor',4725,'documentType',2,'vatPercent',18,'vat',snapshot->'vat','requestReference',request_reference,'orderNumber','LOCAL-IMMEDIATE','paymentType',2)) FROM public.immediate_accounting_preparations WHERE order_id='89000000-0000-4000-8000-000000000010'$$,'freeze verified provider/customer identity');
SELECT extensions.throws_ok($$SELECT public.freeze_immediate_accounting_expected(id,'89000000-0000-4000-8000-000000000001',repeat('a',64),'{}') FROM public.immediate_accounting_preparations WHERE order_id='89000000-0000-4000-8000-000000000010'$$,'P0001','accounting_expected_immutable','expected identity immutable');
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_preparations a CROSS JOIN LATERAL public.claim_immediate_accounting_dispatch(a.id) c WHERE a.order_id='89000000-0000-4000-8000-000000000010'),1::bigint,'one approved dispatch claim');
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_preparations a CROSS JOIN LATERAL public.claim_immediate_accounting_dispatch(a.id) c WHERE a.order_id='89000000-0000-4000-8000-000000000010'),0::bigint,'dispatch cannot reissue');
SELECT extensions.throws_ok($$SELECT public.persist_immediate_accounting_result(id,'89000000-0000-4000-8000-000000000001',repeat('b',64),'artifact_required','2/123','123') FROM public.immediate_accounting_preparations WHERE order_id='89000000-0000-4000-8000-000000000010'$$,'P0001','accounting_reconciliation_fence','stale hash fenced');
SELECT extensions.lives_ok($$SELECT public.persist_immediate_accounting_result(id,'89000000-0000-4000-8000-000000000001',repeat('a',64),'artifact_required','2/123','123') FROM public.immediate_accounting_preparations WHERE order_id='89000000-0000-4000-8000-000000000010'$$,'existing document missing artifact persisted');
SELECT extensions.lives_ok($$SELECT public.persist_immediate_accounting_result(id,'89000000-0000-4000-8000-000000000001',repeat('a',64),'succeeded','2/123','123','https://example.test/document.pdf') FROM public.immediate_accounting_preparations WHERE order_id='89000000-0000-4000-8000-000000000010'$$,'artifact recovery without reissue');
SELECT extensions.throws_ok($$SELECT public.persist_immediate_accounting_result(id,'89000000-0000-4000-8000-000000000001',repeat('a',64),'succeeded','2/124','124','https://example.test/document.pdf') FROM public.immediate_accounting_preparations WHERE order_id='89000000-0000-4000-8000-000000000010'$$,'P0001','invalid_accounting_result','second document identity rejected');
SELECT extensions.is((SELECT count(*) FROM public.accounting_documents WHERE request_reference=(SELECT payment_id::text FROM immediate_fixture)),1::bigint,'single durable accounting document');
RESET ROLE;
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_reconciliations),2::bigint,'both reconciliation stages audited');

SELECT extensions.finish();
ROLLBACK;
