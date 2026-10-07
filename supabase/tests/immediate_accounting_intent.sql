-- Local synthetic fixtures only. No provider connection and every mutation rolls back.
BEGIN;
SET search_path=public,extensions;
SELECT extensions.plan(75);

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
-- No issuance intent means no accounting customer, document, event, or claim.
SELECT extensions.is((SELECT count(*) FROM public.accounting_events WHERE purpose='immediate_sale'),0::bigint,'held manual preparation creates no event');
SELECT extensions.is((SELECT count(*) FROM public.accounting_customers),0::bigint,'held manual preparation creates no customer');
SELECT extensions.is((SELECT count(*) FROM public.accounting_documents),0::bigint,'held manual preparation creates no document');
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_activation_permits),0::bigint,'migration creates no permits');
SELECT extensions.throws_ok($$UPDATE public.immediate_accounting_preparations SET issuance_approved=true WHERE order_id='89000000-0000-4000-8000-000000000010'$$,'P0001','accounting_activation_not_authorized','bare approval flag cannot bypass reviewed permit');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.activate_immediate_accounting(id,'89000000-0000-4000-8000-000000000001',payload_hash,repeat('c',64)) FROM public.immediate_accounting_preparations WHERE order_id='89000000-0000-4000-8000-000000000010'$$,'P0001','accounting_activation_not_authorized','no permit means no activation');
SELECT extensions.throws_ok($$INSERT INTO public.immediate_accounting_activation_permits(preparation_id,payload_hash,approved_by,capability_hash) SELECT id,payload_hash,approved_by,repeat('c',64) FROM public.immediate_accounting_preparations$$,'42501',NULL,'service cannot manufacture permits');
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_preparations a CROSS JOIN LATERAL public.load_approved_immediate_accounting(a.id,'89000000-0000-4000-8000-000000000001') c),0::bigint,'load gate stays closed');
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_preparations a CROSS JOIN LATERAL public.claim_immediate_accounting_customer(a.id,'89000000-0000-4000-8000-000000000001',a.payload_hash) c),0::bigint,'customer gate stays closed');
RESET ROLE;

-- Build real lifecycle shapes using only synthetic localhost transactions.
INSERT INTO public.orders(id,order_number,client_name,client_phone,activity_date,num_participants,total_price)
 VALUES('8a000000-0000-4000-8000-000000000010','LOCAL-CARD-UNRESOLVED','Synthetic','0500000000',CURRENT_DATE,1,47.25),('8a000000-0000-4000-8000-000000000011','LOCAL-CARD-MAPPED','Synthetic','0500000000',CURRENT_DATE,1,47.25);
SELECT pg_temp.bind_fixture_customers();
DO $$
DECLARE o record; payment uuid; transaction_id text;
BEGIN
 FOR o IN SELECT * FROM public.orders WHERE id IN('8a000000-0000-4000-8000-000000000010','8a000000-0000-4000-8000-000000000011') LOOP
  payment:=(public.reserve_pelecard_live_order(o.id,'89000000-0000-4000-8000-000000000001',4725)->>'id')::uuid;
  PERFORM * FROM public.claim_pelecard_live_init(payment);
  transaction_id:=gen_random_uuid()::text;
  PERFORM public.persist_pelecard_live_adapter_session(payment,transaction_id,'synthetic','https://gateway20.pelecard.biz/PaymentGW?transactionId='||transaction_id);
  PERFORM public.observe_pelecard_live_attempt(payment,'usable','000','000',true);
  PERFORM public.finalize_pelecard_live(payment,transaction_id,'approval','000',47.25,'ILS');
 END LOOP;
END $$;
CREATE TEMP TABLE card_fixture AS SELECT p.id AS payment_id,p.sale_id,p.order_id,o.order_number,p.verified_at,
 jsonb_build_object('sourceId',p.id,'orderId',p.order_id,'saleId',p.sale_id,'companyId',512783333,'amountMinor',4725,'billing',jsonb_build_object('name','Synthetic','email','','phone','0500000000','companyId','','approved',true,'noPriorInvoice',true),'vat',jsonb_build_object('vatPercent',18,'grossMinor',4725),'document',jsonb_build_object('document_type',2,'sort_code',100,'price_include_vat',true,'send_mail',false,'prevent_duplicates',true,'currency_id',1,'default_email',false,'digital_signature',true,'request_reference',p.id,'order',o.order_number)) AS snapshot
 FROM public.payment_transactions p JOIN public.orders o ON o.id=p.order_id WHERE o.id IN('8a000000-0000-4000-8000-000000000010','8a000000-0000-4000-8000-000000000011');
UPDATE card_fixture SET snapshot=snapshot||jsonb_build_object('mappingRequired',true,'mappingRevision','unresolved-voucher-contract','paymentEvidence',jsonb_build_object('provider','pelecard','paymentId',payment_id,'saleId',sale_id,'verifiedAt',verified_at,'currency','ILS','amountMinor',4725)) WHERE order_number='LOCAL-CARD-UNRESOLVED';
UPDATE card_fixture SET snapshot=jsonb_set(snapshot,'{document,payments}','[{"payment_type":3,"amount_nis":47.25}]') WHERE order_number='LOCAL-CARD-MAPPED';
UPDATE card_fixture SET snapshot=pg_temp.frozen_fixture(snapshot);
GRANT SELECT ON card_fixture TO service_role;
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.prepare_immediate_accounting(order_id,'89000000-0000-4000-8000-000000000001',snapshot#-'{paymentEvidence,saleId}',repeat('b',64),true) FROM card_fixture WHERE order_number='LOCAL-CARD-UNRESOLVED'$$,'P0001','accounting_payment_evidence_invalid','missing verified sale evidence rejected');
SELECT extensions.lives_ok($$SELECT public.prepare_immediate_accounting(order_id,'89000000-0000-4000-8000-000000000001',snapshot,repeat('b',64),true) FROM card_fixture WHERE order_number='LOCAL-CARD-UNRESOLVED'$$,'verified unmapped card creates evidence-only preparation');
SELECT extensions.lives_ok($$SELECT public.prepare_immediate_accounting(order_id,'89000000-0000-4000-8000-000000000001',snapshot,repeat('b',64),false) FROM card_fixture WHERE order_number='LOCAL-CARD-MAPPED'$$,'mapped card creates held preparation');
SELECT extensions.is((SELECT count(*) FROM public.accounting_events WHERE purpose='immediate_sale'),0::bigint,'card evidence preparation creates no event');
SELECT extensions.ok((SELECT bool_and(public.is_pelecard_controlled_live_accounting_held(payment_id::text)) FROM card_fixture),'global hold stays on for both card sources');
RESET ROLE;
-- Permits below are synthetic and transaction-rolled-back. No real permit exists.
INSERT INTO public.immediate_accounting_activation_permits(preparation_id,payload_hash,approved_by,capability_hash)
 SELECT id,payload_hash,'89000000-0000-4000-8000-000000000001',encode(sha256(convert_to(CASE WHEN state='mapping_required' THEN repeat('d',64) ELSE repeat('c',64) END,'UTF8')),'hex') FROM public.immediate_accounting_preparations WHERE method='pelecard';
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.activate_immediate_accounting(id,'89000000-0000-4000-8000-000000000001',payload_hash,repeat('d',64)) FROM public.immediate_accounting_payment_evidence WHERE state='mapping_required'$$,'P0001','preparation_not_found','unresolved mapping evidence cannot activate');
SELECT extensions.throws_ok($$SELECT public.activate_immediate_accounting(id,'89000000-0000-4000-8000-000000000001',payload_hash,repeat('e',64)) FROM public.immediate_accounting_preparations WHERE order_id='8a000000-0000-4000-8000-000000000011'$$,'P0001','accounting_activation_not_authorized','wrong capability cannot activate');
SELECT extensions.is((SELECT count(*) FROM public.accounting_events WHERE purpose='immediate_sale'),0::bigint,'failed activation atomically creates no event');
SELECT extensions.lives_ok($$SELECT public.activate_immediate_accounting(id,'89000000-0000-4000-8000-000000000001',payload_hash,repeat('c',64)) FROM public.immediate_accounting_preparations WHERE order_id='8a000000-0000-4000-8000-000000000011'$$,'exact reviewed card can activate without global hold release');
SELECT extensions.lives_ok($$SELECT public.activate_immediate_accounting(id,'89000000-0000-4000-8000-000000000001',payload_hash,repeat('c',64)) FROM public.immediate_accounting_preparations WHERE order_id='8a000000-0000-4000-8000-000000000011'$$,'activation retry idempotent');
SELECT extensions.is((SELECT count(*) FROM public.accounting_events WHERE purpose='immediate_sale'),1::bigint,'activation creates exactly one event');
SELECT extensions.ok((SELECT bool_and(public.is_pelecard_controlled_live_accounting_held(payment_id::text)) FROM card_fixture),'global card hold remains true after scoped activation');
RESET ROLE;
UPDATE public.orders SET total_price=60 WHERE id='8a000000-0000-4000-8000-000000000011';
SET LOCAL ROLE service_role;
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_preparations a CROSS JOIN LATERAL public.claim_immediate_accounting_customer(a.id,'89000000-0000-4000-8000-000000000001',a.payload_hash) c WHERE a.method='pelecard'),0::bigint,'changed order amount blocks new customer claim');
RESET ROLE;
UPDATE public.orders SET total_price=47.25 WHERE id='8a000000-0000-4000-8000-000000000011';
SET LOCAL ROLE service_role;
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_preparations a CROSS JOIN LATERAL public.claim_immediate_accounting_customer(a.id,'89000000-0000-4000-8000-000000000001',a.payload_hash) c WHERE a.method='pelecard'),1::bigint,'only reviewed mapped card can claim customer');
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_preparations a CROSS JOIN LATERAL public.claim_immediate_accounting_dispatch(a.id) c WHERE a.method='pelecard'),0::bigint,'document cannot claim before provider identity freeze');
SELECT extensions.throws_ok($$SELECT public.claim_accounting_event(event_id,'legacy-worker',300,true) FROM public.immediate_accounting_preparations WHERE order_id='8a000000-0000-4000-8000-000000000011'$$,'P0001','immediate_accounting_dispatch_required','generic worker cannot claim scoped card event');
SELECT extensions.lives_ok($$SELECT public.persist_immediate_accounting_customer(id,'89000000-0000-4000-8000-000000000001',payload_hash,'456','synthetic-card-account') FROM public.immediate_accounting_preparations WHERE order_id='8a000000-0000-4000-8000-000000000011'$$,'scoped card customer identity persists');
SELECT extensions.lives_ok($$SELECT public.freeze_immediate_accounting_expected(id,'89000000-0000-4000-8000-000000000001',payload_hash,jsonb_build_object('accountingCustomerId',accounting_customer_id,'accountNamespace','synthetic-card-account','customerId','456','companyId',512783333,'amountMinor',4725,'documentType',2,'vatPercent',18,'vat',snapshot->'vat','requestReference',request_reference,'orderNumber','LOCAL-CARD-MAPPED','paymentType',3)) FROM public.immediate_accounting_preparations WHERE order_id='8a000000-0000-4000-8000-000000000011'$$,'scoped card expectation freezes');
RESET ROLE;
UPDATE public.orders SET total_price=60 WHERE id='8a000000-0000-4000-8000-000000000011';
SET LOCAL ROLE service_role;
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_preparations a CROSS JOIN LATERAL public.claim_immediate_accounting_dispatch(a.id) c WHERE a.order_id='8a000000-0000-4000-8000-000000000011'),0::bigint,'changed order amount blocks new document claim');
RESET ROLE;
UPDATE public.orders SET total_price=47.25 WHERE id='8a000000-0000-4000-8000-000000000011';
SET LOCAL ROLE service_role;
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_preparations a CROSS JOIN LATERAL public.claim_immediate_accounting_dispatch(a.id) c WHERE a.order_id='8a000000-0000-4000-8000-000000000011'),1::bigint,'scoped card has one document claim');
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_preparations a CROSS JOIN LATERAL public.claim_immediate_accounting_dispatch(a.id) c WHERE a.order_id='8a000000-0000-4000-8000-000000000011'),0::bigint,'scoped card cannot reissue');
RESET ROLE;
UPDATE public.orders SET total_price=60 WHERE id='8a000000-0000-4000-8000-000000000011';
SET LOCAL ROLE service_role;
SELECT extensions.lives_ok($$SELECT public.persist_immediate_accounting_result(id,'89000000-0000-4000-8000-000000000001',payload_hash,'succeeded','2/456','456','https://example.test/456.pdf') FROM public.immediate_accounting_preparations WHERE order_id='8a000000-0000-4000-8000-000000000011'$$,'scoped card document and event persist despite unchanged global hold');
SELECT extensions.is((SELECT total_price FROM public.orders WHERE id='8a000000-0000-4000-8000-000000000011'),60::numeric,'postdispatch recovery preserves later order edit');
SELECT extensions.is((SELECT amount_minor FROM public.immediate_accounting_preparations WHERE order_id='8a000000-0000-4000-8000-000000000011'),4725,'recovered document retains approved original amount');
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_preparations a CROSS JOIN LATERAL public.claim_immediate_accounting_dispatch(a.id) c WHERE a.order_id='8a000000-0000-4000-8000-000000000011'),0::bigint,'postdispatch order edit never enables a new document claim');
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_preparations a CROSS JOIN LATERAL public.claim_immediate_accounting_customer(a.id,'89000000-0000-4000-8000-000000000001',a.payload_hash) c WHERE a.method='pelecard'),0::bigint,'postdispatch order edit never enables a new customer claim');
SELECT extensions.is((SELECT count(*) FROM public.accounting_documents WHERE external_document_id='2/456'),1::bigint,'one scoped card document');
SELECT extensions.ok((SELECT bool_and(public.is_pelecard_controlled_live_accounting_held(payment_id::text)) FROM card_fixture),'document persistence does not release global card hold');

RESET ROLE;
INSERT INTO public.accounting_events(source_type,source_id,purpose,accounting_provider) SELECT 'payment_transaction',payment_id::text,'payment_success','rivhit' FROM card_fixture;
SELECT extensions.is((SELECT count(*) FROM public.accounting_events WHERE purpose='payment_success' AND source_id IN(SELECT payment_id::text FROM card_fixture)),0::bigint,'legacy payment-success enqueue remains held for both card sources');
RESET ROLE;
SELECT extensions.throws_ok($$UPDATE public.immediate_accounting_activation_permits SET payload_hash=repeat('f',64) WHERE preparation_id IN(SELECT id FROM public.immediate_accounting_preparations)$$,'P0001','accounting_history_immutable','approval permit immutable');
SELECT extensions.ok(NOT has_table_privilege('authenticated','public.immediate_accounting_activation_permits','SELECT') AND NOT has_table_privilege('service_role','public.immediate_accounting_activation_permits','SELECT'),'capability hashes not exposed to application roles');
SET LOCAL ROLE service_role;
SELECT extensions.lives_ok($$SELECT public.prepare_immediate_accounting(order_id,'89000000-0000-4000-8000-000000000001',jsonb_set(snapshot,'{document,payments}','[{"payment_type":3,"amount_nis":47.25}]'),repeat('f',64),false) FROM card_fixture WHERE order_number='LOCAL-CARD-UNRESOLVED'$$,'later reviewed mapping can create a preparation without rewriting original evidence');
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_payment_evidence),1::bigint,'original evidence retained');
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_preparations WHERE order_id='8a000000-0000-4000-8000-000000000010' AND event_id IS NULL AND NOT issuance_approved),1::bigint,'later mapped preparation starts held without event or approval');
RESET ROLE;
SELECT extensions.throws_ok($$UPDATE public.immediate_accounting_payment_evidence SET snapshot='{}' WHERE order_id='8a000000-0000-4000-8000-000000000010'$$,'P0001','accounting_history_immutable','original mapping evidence cannot be rewritten');
-- Incomplete historical ledger links are never inferred from a paid label.
INSERT INTO public.orders(id,order_number,client_name,client_phone,activity_date,num_participants,total_price,payment_status) VALUES('8c000000-0000-4000-8000-000000000010','LOCAL-MISSING-CARD-LINK','Synthetic','0500000000',CURRENT_DATE,1,47.25,U&'\05D0\05E9\05E8\05D0\05D9');
INSERT INTO public.payment_transactions(id,order_id,amount,currency,status,idempotency_key,verified_at,provider_transaction_id) VALUES('8c000000-0000-4000-8000-000000000020','8c000000-0000-4000-8000-000000000010',47.25,'ILS','succeeded','local-incomplete-link',clock_timestamp(),'synthetic-transaction');
INSERT INTO public.sales(id,order_id,payment_transaction_id,total,method) VALUES('8c000000-0000-4000-8000-000000000030','8c000000-0000-4000-8000-000000000010','8c000000-0000-4000-8000-000000000020',47.25,'card');
SELECT extensions.throws_ok($$SELECT public.prepare_immediate_accounting('8c000000-0000-4000-8000-000000000010','89000000-0000-4000-8000-000000000001','{}',repeat('b',64))$$,'P0001','verified_payment_required','missing payment-to-sale ledger link blocks preparation');
UPDATE public.payment_transactions SET sale_id='8c000000-0000-4000-8000-000000000030' WHERE id='8c000000-0000-4000-8000-000000000020';
UPDATE public.sales SET payment_transaction_id=NULL WHERE id='8c000000-0000-4000-8000-000000000030';
SELECT extensions.throws_ok($$SELECT public.prepare_immediate_accounting('8c000000-0000-4000-8000-000000000010','89000000-0000-4000-8000-000000000001','{}',repeat('b',64))$$,'P0001','authorized_manual_payment_required','missing sale-to-payment ledger link cannot masquerade as manual payment');
SELECT extensions.is((SELECT count(*) FROM public.immediate_accounting_preparations WHERE order_id='8c000000-0000-4000-8000-000000000010'),0::bigint,'incomplete ledger never produces preparation');

SELECT extensions.finish();
ROLLBACK;
