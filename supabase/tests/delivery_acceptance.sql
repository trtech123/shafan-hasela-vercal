-- Synthetic/local only. Accepted provider results must survive the real RPC/check constraints.
BEGIN;
DO $$
DECLARE actor uuid := '99000000-0000-4000-8000-000000000001'; q jsonb; o jsonb;
 d jsonb; a jsonb; result jsonb; kind text; channel text; request_id uuid; provider_id text; bad text;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(actor,'delivery-status@example.invalid');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','service_role','sub',actor)::text,true);
 UPDATE public.profiles SET role='admin' WHERE id=actor;
 q:=public.save_quotation(pg_catalog.gen_random_uuid(),NULL,0,'{"client_name":"Synthetic","client_email":"synthetic@example.invalid","client_phone":"0501234567","event_date":"2026-12-01","num_participants":1,"discount":0,"selected_activities":[{"item_type":"product","activity_name":"Frozen","price_per_person":10,"quantity":1}]}',NULL,NULL,false);
 o:=public.convert_quotation_to_order((q->>'id')::uuid,1);
 d:=public.order_confirmation_data((o->>'id')::uuid);
 SET LOCAL ROLE service_role;
 FOREACH kind IN ARRAY ARRAY['order','quotation'] LOOP
  FOREACH channel IN ARRAY ARRAY['email','whatsapp'] LOOP
   request_id:=pg_catalog.gen_random_uuid();
   provider_id:=CASE WHEN channel='email' THEN '<synthetic@example.invalid>' ELSE 'wamid.synthetic+/=' END;
   IF kind='order' THEN
    a:=public.claim_order_delivery(request_id,(o->>'id')::uuid,md5(d::text),channel,actor,repeat('a',64),CASE WHEN channel='email' THEN 'synthetic@example.invalid' ELSE '972501234567' END);
   ELSE
    SELECT quotation_revision_id INTO bad FROM public.quotes WHERE id=(q->>'id')::uuid;
    a:=public.claim_quotation_delivery(request_id,(q->>'id')::uuid,bad::uuid,channel,actor,repeat('a',64));
   END IF;
   IF a->>'claimed'<>'true' THEN RAISE EXCEPTION 'claim_failed'; END IF;
   -- Preserve length/character validation without unsupported regex repetition.
   FOREACH bad IN ARRAY ARRAY['',repeat('x',301),'raw payload with spaces',E'line\nbreak'] LOOP
    BEGIN
     EXECUTE format('SELECT public.finish_%s_delivery($1,$2,$3,$4,$5)',kind) USING request_id,actor,'accepted',NULL::text,bad;
     RAISE EXCEPTION 'invalid_provider_id_allowed';
    EXCEPTION WHEN check_violation THEN NULL; END;
   END LOOP;
   BEGIN
    EXECUTE format('SELECT public.finish_%s_delivery($1,$2,$3,$4,$5)',kind) INTO result USING request_id,actor,'accepted',NULL::text,repeat('x',300);
    IF result->>'state'<>'accepted' THEN RAISE EXCEPTION 'maximum_valid_id_rejected'; END IF;
    RAISE EXCEPTION 'rollback_boundary_probe' USING ERRCODE='Z0001';
   EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL; END;
   EXECUTE format('SELECT public.finish_%s_delivery($1,$2,$3,$4,$5)',kind) INTO result USING request_id,actor,'accepted',NULL::text,provider_id;
   IF result->>'state'<>'accepted' OR result->>'provider_message_id'<>provider_id OR result->>'finished_at' IS NULL THEN RAISE EXCEPTION 'acceptance_lost'; END IF;
   EXECUTE format('SELECT public.finish_%s_delivery($1,$2,$3,$4,$5)',kind) INTO result USING request_id,actor,'accepted',NULL::text,provider_id;
   IF result->>'state'<>'accepted' THEN RAISE EXCEPTION 'replay_failed'; END IF;
   BEGIN
    EXECUTE format('SELECT public.finish_%s_delivery($1,$2,$3,$4,$5)',kind) USING request_id,actor,'uncertain','provider_timeout',NULL::text;
    RAISE EXCEPTION 'accepted_rewrite_allowed';
   EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  END LOOP;
 END LOOP;
END $$;
ROLLBACK;
