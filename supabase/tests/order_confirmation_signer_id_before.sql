BEGIN;
SET search_path=public,extensions;
INSERT INTO auth.users(id,email) VALUES('98200000-0000-4000-8000-000000000001','legacy-operator@example.invalid'),('98200000-0000-4000-8000-000000000002','legacy-instructor@example.invalid');
SELECT set_config('request.jwt.claims','{"role":"service_role","sub":"98200000-0000-4000-8000-000000000001"}',true);
UPDATE public.profiles SET role='operations' WHERE id='98200000-0000-4000-8000-000000000001';
SELECT set_config('test.quote',public.save_quotation('98200000-0000-4000-8000-000000000003',NULL,0,'{"client_name":"Synthetic signature","client_email":"signature@example.invalid","client_phone":"0501234567","event_date":"2026-12-01","num_participants":1,"discount":0,"selected_activities":[{"item_type":"product","activity_name":"Frozen signed item","price_per_person":10,"quantity":1}]}',NULL,NULL,false)::text,true);
SELECT set_config('test.order',public.convert_quotation_to_order((current_setting('test.quote')::jsonb->>'id')::uuid,1)::text,true);

-- Synthetic pre-migration signed evidence. Never touch production ORD-1044.
INSERT INTO public.order_confirmation_revisions(id,order_id,revision_number,snapshot,source_version,token_hash,created_by,expires_at,status,revision_hash,unsigned_path,unsigned_hash,signed_path,signed_hash,full_name,strokes,signed_at,request_id)
SELECT '98200000-0000-4000-8000-000000000010',(current_setting('test.order')::jsonb->>'id')::uuid,1,'{"acceptanceText":"Legacy acceptance"}',md5(public.order_signature_customer_data(public.order_confirmation_data((current_setting('test.order')::jsonb->>'id')::uuid))::text),repeat('7',64),'98200000-0000-4000-8000-000000000001',now()+interval '7 days','signed',repeat('b',64),'legacy/unsigned.pdf',repeat('c',64),'legacy/signed.pdf',repeat('d',64),'Legacy Signer','[[{"x":0,"y":0},{"x":1,"y":1}]]',now(),'98200000-0000-4000-8000-000000000011';
COMMIT;
