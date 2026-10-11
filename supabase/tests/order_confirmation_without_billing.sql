BEGIN;
SET search_path=public,extensions;
INSERT INTO auth.users(id,email) VALUES('98100000-0000-4000-8000-000000000001','signature-operator@example.invalid'),('98100000-0000-4000-8000-000000000002','signature-instructor@example.invalid');
SELECT set_config('request.jwt.claims','{"role":"service_role","sub":"98100000-0000-4000-8000-000000000001"}',true);
UPDATE public.profiles SET role='operations' WHERE id='98100000-0000-4000-8000-000000000001';
SELECT set_config('test.quote',public.save_quotation('98100000-0000-4000-8000-000000000003',NULL,0,'{"client_name":"Synthetic signature","client_email":"signature@example.invalid","client_phone":"0501234567","event_date":"2026-12-01","num_participants":1,"discount":0,"selected_activities":[{"item_type":"product","activity_name":"Frozen signed item","price_per_person":10,"quantity":1}]}',NULL,NULL,false)::text,true);
SELECT set_config('test.order',public.convert_quotation_to_order((current_setting('test.quote')::jsonb->>'id')::uuid,1)::text,true);
DO $$
DECLARE oid uuid; snapshot_id uuid; stage integer; r jsonb; expected jsonb; before_order jsonb; before_customer jsonb; history jsonb;
BEGIN
 oid=(current_setting('test.order')::jsonb->>'id')::uuid;
 FOR stage IN 1..5 LOOP
  IF stage=2 THEN
   INSERT INTO public.customers(id,display_name,phone,billing_company_id,vat_applicable) VALUES('98100000-0000-4000-8000-000000000020','Synthetic customer','0501234567','012345674',false);
   PERFORM public.link_order_customer(oid,'98100000-0000-4000-8000-000000000020',0);
  ELSIF stage=3 THEN
   UPDATE public.customers SET billing_company_id='',phone='' WHERE id='98100000-0000-4000-8000-000000000020';
   PERFORM public.link_order_customer(oid,'98100000-0000-4000-8000-000000000020',1);
  ELSIF stage=4 THEN
   UPDATE public.customers SET archived_at=clock_timestamp() WHERE id='98100000-0000-4000-8000-000000000020';
  ELSIF stage=5 THEN
   INSERT INTO public.customer_snapshots(order_id,customer_id,customer_version,customer_kind,revision,data,captured_by)
   SELECT order_id,customer_id,customer_version,customer_kind,revision+1,jsonb_set(data,'{vat_applicable}','null'::jsonb),captured_by FROM public.customer_snapshots WHERE id=(SELECT customer_snapshot_id FROM public.orders WHERE id=oid) RETURNING id INTO snapshot_id;
   UPDATE public.orders SET customer_snapshot_id=snapshot_id,customer_record_version=3,vat_applicable=NULL WHERE id=oid;
  END IF;
  SELECT to_jsonb(o) INTO before_order FROM public.orders o WHERE id=oid;
  SELECT to_jsonb(c) INTO before_customer FROM public.customers c WHERE id='98100000-0000-4000-8000-000000000020';
  expected=public.order_signature_customer_data(public.order_confirmation_data(oid));
  r=public.order_signature_action('create',jsonb_build_object('actorId','98100000-0000-4000-8000-000000000001','orderId',oid,'tokenHash',md5(stage::text)||md5(stage::text),'days',7,'text','{"ORDER_TERMS":["original"]}'::jsonb,'renderVersion','2','acceptanceVersion','1','acceptanceText','Synthetic acceptance of existing order without billing setup'));
  IF r->>'status'<>'preparing' OR r->'snapshot'->'data' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'existing order not frozen unchanged at stage %',stage; END IF;
  IF (SELECT to_jsonb(o) FROM public.orders o WHERE id=oid) IS DISTINCT FROM before_order OR (SELECT to_jsonb(c) FROM public.customers c WHERE id='98100000-0000-4000-8000-000000000020') IS DISTINCT FROM before_customer THEN RAISE EXCEPTION 'preparation changed order or customer at stage %',stage; END IF;
  history=public.order_signature_action('history',jsonb_build_object('actorId','98100000-0000-4000-8000-000000000001','orderId',oid));
  IF history ? 'readiness' OR history ? 'customerReview' THEN RAISE EXCEPTION 'history retains billing dependency'; END IF;
 END LOOP;
END $$;
ROLLBACK;
