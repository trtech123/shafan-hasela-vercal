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
 r=public.order_signature_action('create',input);
 IF r ? 'token_hash' OR r->'snapshot'->'data' ? 'internal_notes' THEN RAISE EXCEPTION 'private data returned'; END IF;
 IF r->'snapshot'->'text'->'ORDER_TERMS'->>0='original' THEN RAISE EXCEPTION 'VAT terms not frozen';END IF;
 r=public.order_signature_action('ready',jsonb_build_object('actorId',input->>'actorId','revisionId',r->>'id','revisionHash',repeat('b',64),'unsignedHash',repeat('c',64)));
 IF public.order_signature_action('view',jsonb_build_object('tokenHash',repeat('a',64)))->>'status'<>'pending' THEN RAISE EXCEPTION 'view consumed token';END IF;
 PERFORM public.order_signature_action('view',jsonb_build_object('tokenHash',repeat('a',64)));
 claim=jsonb_build_object('tokenHash',repeat('a',64),'requestId','98100000-0000-4000-8000-000000000004','fullName','Synthetic Signer','strokes','[[{"x":0.1,"y":0.1},{"x":0.5,"y":0.3}]]'::jsonb,'accepted',true);
 r=public.order_signature_action('claim',claim);
 IF r->>'signer_id' IS NOT NULL THEN RAISE EXCEPTION 'unexpected signer ID';END IF;
 failed=false;BEGIN PERFORM public.order_signature_action('claim',claim||'{"signerId":"123456782"}');EXCEPTION WHEN SQLSTATE 'PT404' THEN failed=true;END;IF NOT failed THEN RAISE EXCEPTION 'replay mutated signer ID';END IF;
 r2=public.order_signature_action('claim',claim);
 IF r->>'signed_at' IS DISTINCT FROM r2->>'signed_at' THEN RAISE EXCEPTION 'claim retry changed signing time';END IF;
 failed=false;BEGIN PERFORM public.order_signature_action('claim',claim||'{"requestId":"98100000-0000-4000-8000-000000000005"}');EXCEPTION WHEN SQLSTATE 'PT404' THEN failed=true;END;IF NOT failed THEN RAISE EXCEPTION 'competing signer accepted';END IF;
 r=public.order_signature_action('finish',claim||jsonb_build_object('signedHash',repeat('d',64)));
 r2=public.order_signature_action('finish',claim||jsonb_build_object('signedHash',repeat('d',64)));
 IF r<>r2 OR r->>'status'<>'signed' THEN RAISE EXCEPTION 'finish not idempotent';END IF;
 failed=false;BEGIN UPDATE public.order_confirmation_revisions SET full_name='Changed signer' WHERE id=(r->>'id')::uuid;EXCEPTION WHEN insufficient_privilege THEN failed=true;END;IF NOT failed THEN RAISE EXCEPTION 'signed evidence mutable';END IF;
 PERFORM public.order_signature_action('revoke',jsonb_build_object('actorId',input->>'actorId','revisionId',r->>'id'));
 IF public.order_signature_action('view',jsonb_build_object('tokenHash',repeat('a',64)))->>'status'<>'signed' THEN RAISE EXCEPTION 'revocation rewrote signed evidence';END IF;
 UPDATE public.orders SET notes='Customer-facing order changes' WHERE id=oid;
 IF NOT (public.order_signature_action('history',jsonb_build_object('actorId',input->>'actorId','orderId',oid))->'revisions'->0->>'current_differs')::boolean THEN RAISE EXCEPTION 'missing current differs warning';END IF;
 r2=public.order_signature_action('create',input||jsonb_build_object('tokenHash',repeat('e',64)));
 IF r2->>'revision_number'<>'2' OR r2->'snapshot'=r->'snapshot' THEN RAISE EXCEPTION 'changed order did not freeze new revision';END IF;
 PERFORM public.order_signature_action('ready',jsonb_build_object('actorId',input->>'actorId','revisionId',r2->>'id','revisionHash',repeat('b',64),'unsignedHash',repeat('c',64)));
 r2=public.order_signature_action('create',input||jsonb_build_object('tokenHash',repeat('f',64)));
 failed=false;BEGIN PERFORM public.order_signature_action('view',jsonb_build_object('tokenHash',repeat('e',64)));EXCEPTION WHEN SQLSTATE 'PT404' THEN failed=true;END;IF NOT failed THEN RAISE EXCEPTION 'superseded link accepted';END IF;
 r2=public.order_signature_action('ready',jsonb_build_object('actorId',input->>'actorId','revisionId',r2->>'id','revisionHash',repeat('b',64),'unsignedHash',repeat('c',64)));
 -- A render/upload failure does not permanently consume the capability.
 claim=claim||jsonb_build_object('tokenHash',repeat('f',64));
 PERFORM public.order_signature_action('claim',claim);
 IF public.order_signature_action('history',jsonb_build_object('actorId',input->>'actorId','orderId',oid))->'revisions'->0->>'signed_at' IS NOT NULL THEN RAISE EXCEPTION 'provisional evidence shown as signed';END IF;
 UPDATE public.order_confirmation_revisions SET claim_expires_at=now()-interval '1 second' WHERE id=(r2->>'id')::uuid;
 r=public.order_signature_action('claim',claim||'{"requestId":"98100000-0000-4000-8000-000000000005","fullName":"Recovered Signer"}');
 -- A previously superseded identity can already have an immutable PDF object.
 -- Expiring B's lease must never let A reuse that object with a new timestamp.
 UPDATE public.order_confirmation_revisions SET claim_expires_at=now()-interval '1 second' WHERE id=(r2->>'id')::uuid;
 failed=false;BEGIN PERFORM public.order_signature_action('claim',claim);EXCEPTION WHEN SQLSTATE 'PT404' THEN failed=true;END;IF NOT failed THEN RAISE EXCEPTION 'superseded claim A reused after B expired with same payload';END IF;
 failed=false;BEGIN PERFORM public.order_signature_action('claim',claim||'{"fullName":"Different Signer"}');EXCEPTION WHEN SQLSTATE 'PT404' THEN failed=true;END;IF NOT failed THEN RAISE EXCEPTION 'superseded claim A reused after B expired with changed payload';END IF;
 failed=false;BEGIN PERFORM public.order_signature_action('finish',claim||jsonb_build_object('signedHash',repeat('d',64)));EXCEPTION WHEN SQLSTATE 'PT404' THEN failed=true;END;IF NOT failed THEN RAISE EXCEPTION 'stale lease finalized';END IF;
 r2=public.order_signature_action('claim',claim||'{"requestId":"98100000-0000-4000-8000-000000000005","fullName":"Recovered Signer"}');
 IF r2->>'signed_at' IS DISTINCT FROM r->>'signed_at' OR (SELECT count(*) FROM public.order_confirmation_signature_claims WHERE revision_id=(r2->>'id')::uuid)<>2 THEN RAISE EXCEPTION 'current expired-lease replay changed acceptance or identities';END IF;
 r2=public.order_signature_action('finish',claim||jsonb_build_object('requestId','98100000-0000-4000-8000-000000000005','signedHash',repeat('d',64)));
 IF r2->>'signed_path' NOT LIKE '%/98100000-0000-4000-8000-000000000005-signed.pdf' OR r2->>'full_name'<>'Recovered Signer' THEN RAISE EXCEPTION 'recovery used old artifact or signer';END IF;
 INSERT INTO public.order_confirmation_revisions(order_id,revision_number,snapshot,source_version,token_hash,created_by,expires_at,status,revision_hash,unsigned_path,unsigned_hash)
 SELECT order_id,100,snapshot,source_version,repeat('0',64),created_by,now()-interval '1 second','pending',revision_hash,'expired/unsigned.pdf',unsigned_hash FROM public.order_confirmation_revisions WHERE id=(r2->>'id')::uuid;
 failed=false;BEGIN PERFORM public.order_signature_action('view',jsonb_build_object('tokenHash',repeat('0',64)));EXCEPTION WHEN SQLSTATE 'PT404' THEN failed=true;END;IF NOT failed THEN RAISE EXCEPTION 'expired link accepted';END IF;
 failed=false;BEGIN PERFORM public.order_signature_action('view',jsonb_build_object('tokenHash',repeat('9',64)));EXCEPTION WHEN SQLSTATE 'PT404' THEN failed=true;END;IF NOT failed THEN RAISE EXCEPTION 'invalid link accepted';END IF;
 r2=public.order_signature_action('create',input||jsonb_build_object('tokenHash',repeat('1',64)));
 PERFORM public.order_signature_action('ready',jsonb_build_object('actorId',input->>'actorId','revisionId',r2->>'id','revisionHash',repeat('b',64),'unsignedHash',repeat('c',64)));
 PERFORM public.order_signature_action('revoke',jsonb_build_object('actorId',input->>'actorId','revisionId',r2->>'id'));
 failed=false;BEGIN PERFORM public.order_signature_action('view',jsonb_build_object('tokenHash',repeat('1',64)));EXCEPTION WHEN SQLSTATE 'PT404' THEN failed=true;END;IF NOT failed THEN RAISE EXCEPTION 'revoked link accepted';END IF;
 r2=public.order_signature_action('create',input||jsonb_build_object('tokenHash',repeat('2',64)));
 PERFORM public.order_signature_action('ready',jsonb_build_object('actorId',input->>'actorId','revisionId',r2->>'id','revisionHash',repeat('b',64),'unsignedHash',repeat('c',64)));
 -- Delivery claims are immutable and exact replays do not dispatch again.
 input=jsonb_build_object('actorId',input->>'actorId','revisionId',r2->>'id','channel','email','requestId','98100000-0000-4000-8000-000000000006','destination','recipient@example.invalid');
 IF public.order_signature_delivery('claim',input)->>'claimed'<>'true' OR public.order_signature_delivery('claim',input)->>'claimed'<>'false' THEN RAISE EXCEPTION 'delivery replay dispatched twice';END IF;
 failed=false;BEGIN PERFORM public.order_signature_delivery('claim',input||'{"destination":"changed@example.invalid"}');EXCEPTION WHEN SQLSTATE 'PT409' THEN failed=true;END;IF NOT failed THEN RAISE EXCEPTION 'delivery recipient mutation accepted';END IF;
 failed=false;BEGIN PERFORM public.order_signature_delivery('claim',input||'{"resendOf":"98100000-0000-4000-8000-000000000006","requestId":"98100000-0000-4000-8000-000000000007","confirmed":true}');EXCEPTION WHEN SQLSTATE 'PT409' THEN failed=true;END;IF NOT failed THEN RAISE EXCEPTION 'inflight resend accepted';END IF;
 PERFORM public.order_signature_delivery('finish',input||'{"state":"uncertain","reason":"provider_timeout","providerId":null}');
 failed=false;BEGIN PERFORM public.order_signature_delivery('claim',input||'{"resendOf":"98100000-0000-4000-8000-000000000006","requestId":"98100000-0000-4000-8000-000000000007"}');EXCEPTION WHEN SQLSTATE 'PT409' THEN failed=true;END;IF NOT failed THEN RAISE EXCEPTION 'unconfirmed resend accepted';END IF;
 IF public.order_signature_delivery('claim',input||'{"resendOf":"98100000-0000-4000-8000-000000000006","requestId":"98100000-0000-4000-8000-000000000007","confirmed":true}')->>'claimed'<>'true' THEN RAISE EXCEPTION 'confirmed manual resend unavailable';END IF;
 failed=false;BEGIN PERFORM public.order_signature_delivery('claim',input||'{"resendOf":"98100000-0000-4000-8000-000000000006","requestId":"98100000-0000-4000-8000-000000000008","confirmed":true}');EXCEPTION WHEN SQLSTATE 'PT409' THEN failed=true;END;IF NOT failed THEN RAISE EXCEPTION 'second resend child accepted';END IF;
 failed=false;BEGIN PERFORM public.order_signature_delivery('claim',input||'{"actorId":"98100000-0000-4000-8000-000000000002"}');EXCEPTION WHEN insufficient_privilege THEN failed=true;END;IF NOT failed THEN RAISE EXCEPTION 'instructor delivery accepted';END IF;
 UPDATE public.orders SET notes='Changed after invitation' WHERE id=oid;
 failed=false;BEGIN PERFORM public.order_signature_action('claim',claim||jsonb_build_object('tokenHash',repeat('2',64)));EXCEPTION WHEN SQLSTATE 'PT404' THEN failed=true;END;IF NOT failed THEN RAISE EXCEPTION 'stale order signed';END IF;
 FOR n IN 1..30 LOOP IF NOT public.order_signature_rate_limit('synthetic-fixture') THEN RAISE EXCEPTION 'rate limited too early';END IF;END LOOP;
 IF public.order_signature_rate_limit('synthetic-fixture') THEN RAISE EXCEPTION 'rate limit absent';END IF;
END $$;
INSERT INTO storage.objects(bucket_id,name) VALUES('order-signatures-private','synthetic/unsigned.pdf');
GRANT SELECT ON storage.objects TO anon,authenticated;
SET LOCAL ROLE anon;
DO $$BEGIN
 BEGIN PERFORM public.order_signature_action('view','{}');RAISE EXCEPTION 'anonymous RPC access';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM 1 FROM public.order_confirmation_revisions;RAISE EXCEPTION 'anonymous revision access';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='order-signatures-private') THEN RAISE EXCEPTION 'anonymous private storage access';END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$BEGIN
 BEGIN PERFORM public.order_signature_action('history','{}');RAISE EXCEPTION 'authenticated direct RPC access';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM 1 FROM public.order_confirmation_revisions;RAISE EXCEPTION 'authenticated direct revision access';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='order-signatures-private') THEN RAISE EXCEPTION 'authenticated private storage access';END IF;
END $$;
RESET ROLE;
ROLLBACK;
