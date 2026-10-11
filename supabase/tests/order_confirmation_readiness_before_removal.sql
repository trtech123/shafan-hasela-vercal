BEGIN;
SET search_path=public,extensions;
INSERT INTO auth.users(id,email) VALUES('98100000-0000-4000-8000-000000000001','signature-operator@example.invalid'),('98100000-0000-4000-8000-000000000002','signature-instructor@example.invalid');
SELECT set_config('request.jwt.claims','{"role":"service_role","sub":"98100000-0000-4000-8000-000000000001"}',true);
UPDATE public.profiles SET role='operations' WHERE id='98100000-0000-4000-8000-000000000001';
SELECT set_config('test.quote',public.save_quotation('98100000-0000-4000-8000-000000000003',NULL,0,'{"client_name":"Synthetic signature","client_email":"signature@example.invalid","client_phone":"0501234567","event_date":"2026-12-01","num_participants":1,"discount":0,"selected_activities":[{"item_type":"product","activity_name":"Frozen signed item","price_per_person":10,"quantity":1}]}',NULL,NULL,false)::text,true);
SELECT set_config('test.order',public.convert_quotation_to_order((current_setting('test.quote')::jsonb->>'id')::uuid,1)::text,true);
DO $$
DECLARE input jsonb; r jsonb; r2 jsonb; claim jsonb; oid uuid; snapshot_id uuid; n integer; failed boolean;
BEGIN
 IF public.order_signature_customer_data('{"notes":"visible order note","quotation_snapshot":{"internal_notes":"private quote note","selected_activities":[{"description":"visible description","internalNotes":"private item note"}]},"customer_snapshot":{"client_name":"Visible client","internal_notes":"private customer note"}}'::jsonb) IS DISTINCT FROM '{"notes":"visible order note","quotation_snapshot":{"selected_activities":[{"description":"visible description"}]},"customer_snapshot":{"client_name":"Visible client"}}'::jsonb THEN RAISE EXCEPTION 'nested internal notes retained in frozen customer data'; END IF;
 IF has_function_privilege('anon','public.order_signature_action(text,jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.order_signature_action(text,jsonb)','EXECUTE') OR has_table_privilege('anon','public.order_confirmation_revisions','SELECT') OR has_table_privilege('authenticated','public.order_confirmation_revisions','SELECT') OR has_table_privilege('service_role','public.order_confirmation_revisions','UPDATE') THEN RAISE EXCEPTION 'role privileges leaked'; END IF;
 IF has_table_privilege('anon','public.order_confirmation_signature_claims','SELECT') OR has_table_privilege('authenticated','public.order_confirmation_signature_claims','SELECT') OR has_table_privilege('service_role','public.order_confirmation_signature_claims','DELETE') OR has_table_privilege('service_role','public.order_confirmation_signature_claims','UPDATE') OR has_table_privilege('service_role','public.order_confirmation_signature_claims','INSERT') THEN RAISE EXCEPTION 'claim identity privileges leaked'; END IF;
 IF (SELECT public FROM storage.buckets WHERE id='order-signatures-private') THEN RAISE EXCEPTION 'bucket public'; END IF;
 oid=(current_setting('test.order')::jsonb->>'id')::uuid;
 input=jsonb_build_object('actorId','98100000-0000-4000-8000-000000000001','orderId',oid,'tokenHash',repeat('a',64),'days',7,'text','{"ORDER_TERMS":["original","Second condition"]}'::jsonb,'renderVersion','1','acceptanceVersion','1','acceptanceText','I accept this precise frozen order document');
 failed=false;BEGIN PERFORM public.order_signature_action('create',input||'{"actorId":"98100000-0000-4000-8000-000000000002"}');EXCEPTION WHEN insufficient_privilege THEN failed=true;END;IF NOT failed THEN RAISE EXCEPTION 'instructor can create';END IF;
 failed=false;BEGIN PERFORM public.order_signature_action('create',input);EXCEPTION WHEN SQLSTATE 'PT409' THEN failed=true;END;IF NOT failed THEN RAISE EXCEPTION 'unlinked customer allowed to prepare';END IF;
 INSERT INTO public.customers(id,display_name,phone,billing_company_id,vat_applicable) VALUES('98100000-0000-4000-8000-000000000020','Synthetic customer','0501234567','012345674',false);
 PERFORM public.link_order_customer(oid,'98100000-0000-4000-8000-000000000020',0);
 -- Canonical edits never silently replace a reviewed order snapshot.
 UPDATE public.customers SET billing_company_id='',phone='' WHERE id='98100000-0000-4000-8000-000000000020';
 IF public.order_signature_readiness(oid)<>'[]'::jsonb THEN RAISE EXCEPTION 'latest master replaced reviewed snapshot'; END IF;
 PERFORM public.link_order_customer(oid,'98100000-0000-4000-8000-000000000020',1);
 IF NOT public.order_signature_readiness(oid) @> '["billing_identification","customer_phone"]'::jsonb THEN RAISE EXCEPTION 'incomplete snapshot accepted'; END IF;
 failed=false;BEGIN PERFORM public.order_signature_action('create',input);EXCEPTION WHEN SQLSTATE 'PT409' THEN failed=true;END;IF NOT failed THEN RAISE EXCEPTION 'incomplete customer allowed to prepare';END IF;
 UPDATE public.customers SET billing_company_id='000000000',phone='0501234567',customer_kind='organization' WHERE id='98100000-0000-4000-8000-000000000020';
 PERFORM public.link_order_customer(oid,'98100000-0000-4000-8000-000000000020',2);
 IF NOT public.order_signature_readiness(oid) @> '["billing_identification"]'::jsonb THEN RAISE EXCEPTION 'all-zero organization ID accepted'; END IF;
 UPDATE public.customers SET billing_company_id='123456789' WHERE id='98100000-0000-4000-8000-000000000020';
 PERFORM public.link_order_customer(oid,'98100000-0000-4000-8000-000000000020',3);
 IF public.order_signature_readiness(oid)<>'[]'::jsonb THEN RAISE EXCEPTION 'organization wrongly needs personal checksum or optional email address'; END IF;
 UPDATE public.customers SET billing_company_id=' 012-345 674 ',customer_kind='person' WHERE id='98100000-0000-4000-8000-000000000020';
 PERFORM public.link_order_customer(oid,'98100000-0000-4000-8000-000000000020',4);
 IF public.order_signature_readiness(oid)<>'[]'::jsonb THEN RAISE EXCEPTION 'normalized personal ID rejected'; END IF;
 -- Explicit boolean VAT remains mandatory even on malformed historical snapshots.
 INSERT INTO public.customer_snapshots(order_id,customer_id,customer_version,customer_kind,revision,data,captured_by)
 SELECT order_id,customer_id,customer_version,customer_kind,revision+1,jsonb_set(data,'{vat_applicable}','null'::jsonb),captured_by FROM public.customer_snapshots WHERE id=(SELECT customer_snapshot_id FROM public.orders WHERE id=oid) RETURNING id INTO snapshot_id;
 UPDATE public.orders SET customer_snapshot_id=snapshot_id,customer_record_version=6,vat_applicable=NULL WHERE id=oid;
 IF NOT public.order_signature_readiness(oid) @> '["vat_applicable"]'::jsonb THEN RAISE EXCEPTION 'unknown VAT accepted'; END IF;
 PERFORM public.link_order_customer(oid,'98100000-0000-4000-8000-000000000020',6);
 UPDATE public.orders SET num_participants=0 WHERE id=oid;
 IF NOT public.order_signature_readiness(oid) @> '["order_details"]'::jsonb THEN RAISE EXCEPTION 'invalid participant count accepted'; END IF;
 UPDATE public.orders SET num_participants=1 WHERE id=oid;
END $$;
ROLLBACK;
