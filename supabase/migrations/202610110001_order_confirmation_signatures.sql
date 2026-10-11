BEGIN;
-- Historical quotation JSON can contain keys outside today's item allowlist.
-- Strip internal notes recursively without touching customer-facing notes.
CREATE FUNCTION public.order_signature_customer_data(p_value jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF jsonb_typeof(p_value)='object' THEN
  SELECT coalesce(jsonb_object_agg(k,public.order_signature_customer_data(v)),'{}'::jsonb) INTO result
  FROM jsonb_each(p_value) e(k,v) WHERE lower(replace(k,'_',''))<>'internalnotes';
  RETURN result;
 ELSIF jsonb_typeof(p_value)='array' THEN
  SELECT coalesce(jsonb_agg(public.order_signature_customer_data(v) ORDER BY position),'[]'::jsonb) INTO result
  FROM jsonb_array_elements(p_value) WITH ORDINALITY e(v,position);
  RETURN result;
 END IF;
 RETURN p_value;
END $$;
REVOKE ALL ON FUNCTION public.order_signature_customer_data(jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE public.order_confirmation_revisions (
 id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
 order_id uuid NOT NULL REFERENCES public.orders(id), revision_number integer NOT NULL,
 snapshot jsonb NOT NULL, source_version text NOT NULL,
 revision_hash text CHECK(revision_hash ~ '^[a-f0-9]{64}$'),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'preparing' CHECK(status IN ('preparing','pending','signing','signed','revoked','superseded')),
 created_by uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 unsigned_path text, unsigned_hash text CHECK(unsigned_hash ~ '^[a-f0-9]{64}$'),
 signed_path text, signed_hash text CHECK(signed_hash ~ '^[a-f0-9]{64}$'),
 request_id uuid, full_name text, strokes jsonb, signed_at timestamptz, claim_expires_at timestamptz,
 UNIQUE(order_id,revision_number),
 CHECK(status NOT IN ('pending','signing','signed') OR (revision_hash IS NOT NULL AND unsigned_path IS NOT NULL AND unsigned_hash IS NOT NULL)),
 CHECK(status<>'signed' OR (signed_path IS NOT NULL AND signed_hash IS NOT NULL AND signed_at IS NOT NULL AND full_name IS NOT NULL AND strokes IS NOT NULL))
);
ALTER TABLE public.order_confirmation_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_confirmation_revisions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.order_confirmation_revisions TO service_role;
-- Each signing attempt owns its immutable artifact path forever. Keeping used
-- identities separately prevents A -> B -> A lease recovery from associating
-- A's old uploaded PDF with a new acceptance timestamp or signature payload.
CREATE TABLE public.order_confirmation_signature_claims (
 revision_id uuid NOT NULL REFERENCES public.order_confirmation_revisions(id),
 request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(revision_id,request_id)
);
ALTER TABLE public.order_confirmation_signature_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_confirmation_signature_claims FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('order-signatures-private','order-signatures-private',false,20971520,ARRAY['application/pdf']);

CREATE FUNCTION public.protect_order_signature_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.status='signed' OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.source_version IS DISTINCT FROM OLD.source_version
 OR NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.order_id IS DISTINCT FROM OLD.order_id
 OR NEW.revision_number IS DISTINCT FROM OLD.revision_number OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
 OR (OLD.unsigned_path IS NOT NULL AND (NEW.unsigned_path IS DISTINCT FROM OLD.unsigned_path OR NEW.unsigned_hash IS DISTINCT FROM OLD.unsigned_hash OR NEW.revision_hash IS DISTINCT FROM OLD.revision_hash))
 THEN RAISE EXCEPTION 'immutable_signature_evidence' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_order_signature_evidence BEFORE UPDATE ON public.order_confirmation_revisions FOR EACH ROW EXECUTE FUNCTION public.protect_order_signature_evidence();

-- A service-only boundary: callers never receive table writes or anonymous RPC grants.
-- All staff actions independently check the actor's current database role.
CREATE FUNCTION public.order_signature_action(p_action text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.order_confirmation_revisions; d jsonb; actor uuid; oid uuid; rid uuid; seq integer; result jsonb; vat jsonb; fixed_text jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'signature_forbidden' USING ERRCODE='42501'; END IF;
 IF p_action IN ('create','history','staff_read','revoke','ready') THEN
  actor=(p_input->>'actorId')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=actor AND role IN ('admin','operations','cashier')) THEN RAISE EXCEPTION 'signature_forbidden' USING ERRCODE='42501'; END IF;
 END IF;
 IF p_action='create' THEN
  oid=(p_input->>'orderId')::uuid;
  PERFORM 1 FROM public.orders WHERE id=oid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE='PT404'; END IF;
  IF (p_input->>'days')::integer NOT BETWEEN 1 AND 30 OR jsonb_typeof(p_input->'text')<>'object' OR length(p_input->>'acceptanceText') NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'invalid_request'; END IF;
  d=public.order_signature_customer_data(public.order_confirmation_data(oid));
  vat=CASE WHEN (d->'customer_snapshot') ? 'vat_applicable' THEN d->'customer_snapshot'->'vat_applicable' WHEN d ? 'vat_applicable' THEN d->'vat_applicable' ELSE d->'quotation_snapshot'->'vat_applicable' END;
  fixed_text=jsonb_set(p_input->'text','{ORDER_TERMS,0}',to_jsonb(CASE WHEN vat='true'::jsonb THEN 'חייב במע״מ — המחירים כוללים מע״מ' WHEN vat='false'::jsonb THEN 'מע״מ לא חל לפי ההחלטה השמורה להזמנה' ELSE 'החלטת מע״מ היסטורית לא תועדה; לא הונח חיוב או פטור' END));
  SELECT coalesce(max(revision_number),0)+1 INTO seq FROM public.order_confirmation_revisions WHERE order_id=oid;
  UPDATE public.order_confirmation_revisions SET status='superseded' WHERE order_id=oid AND status IN ('preparing','pending','signing');
  rid=extensions.uuid_generate_v4();
  INSERT INTO public.order_confirmation_revisions(id,order_id,revision_number,snapshot,source_version,token_hash,created_by,expires_at)
  VALUES(rid,oid,seq,jsonb_build_object('revisionId',rid,'revisionNumber',seq,'data',d,'text',fixed_text,'renderVersion',p_input->>'renderVersion','acceptanceVersion',p_input->>'acceptanceVersion','acceptanceText',p_input->>'acceptanceText'),md5(d::text),p_input->>'tokenHash',actor,now()+make_interval(days=>(p_input->>'days')::integer)) RETURNING * INTO r;
 ELSIF p_action='history' THEN
  oid=(p_input->>'orderId')::uuid; d=public.order_signature_customer_data(public.order_confirmation_data(oid));
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'revision_number',revision_number,'revision_hash',revision_hash,'status',CASE WHEN status IN ('pending','preparing','signing') AND expires_at<=now() THEN 'expired' ELSE status END,'created_at',created_at,'expires_at',expires_at,'signed_at',CASE WHEN status='signed' THEN signed_at END,'full_name',CASE WHEN status='signed' THEN full_name END,'current_differs',source_version<>md5(d::text)) ORDER BY revision_number DESC),'[]'::jsonb) INTO result FROM public.order_confirmation_revisions WHERE order_id=oid;
  RETURN jsonb_build_object('revisions',result,'deliveries',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC),'[]'::jsonb) FROM public.order_signature_deliveries a JOIN public.order_confirmation_revisions rev ON a.revision_id=rev.id WHERE rev.order_id=oid));
 ELSE
  IF p_action IN ('view','claim','finish') THEN
   SELECT * INTO r FROM public.order_confirmation_revisions WHERE token_hash=p_input->>'tokenHash' FOR UPDATE;
   IF NOT FOUND OR r.status IN ('preparing','revoked','superseded') OR r.expires_at<=now() THEN RAISE EXCEPTION 'link_unavailable' USING ERRCODE='PT404'; END IF;
   -- A changed order must never be silently signed as its previous revision.
   IF r.status<>'signed' AND r.source_version<>md5(public.order_signature_customer_data(public.order_confirmation_data(r.order_id))::text) THEN RAISE EXCEPTION 'link_unavailable' USING ERRCODE='PT404'; END IF;
  ELSE
   SELECT * INTO r FROM public.order_confirmation_revisions WHERE id=(p_input->>'revisionId')::uuid FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE='PT404'; END IF;
  END IF;
  IF p_action='ready' THEN
   IF r.status<>'preparing' THEN RAISE EXCEPTION 'revision_conflict' USING ERRCODE='PT409'; END IF;
   UPDATE public.order_confirmation_revisions SET revision_hash=p_input->>'revisionHash',unsigned_hash=p_input->>'unsignedHash',unsigned_path=id::text||'/unsigned.pdf',status='pending' WHERE id=r.id RETURNING * INTO r;
  ELSIF p_action='revoke' THEN
   IF r.status IN ('preparing','pending','signing') THEN UPDATE public.order_confirmation_revisions SET status='revoked' WHERE id=r.id RETURNING * INTO r; END IF;
  ELSIF p_action='claim' THEN
   IF r.status='signed' OR (r.status='signing' AND (r.claim_expires_at>now() OR r.request_id=(p_input->>'requestId')::uuid)) THEN
    IF r.request_id IS DISTINCT FROM (p_input->>'requestId')::uuid OR r.full_name IS DISTINCT FROM p_input->>'fullName' OR r.strokes IS DISTINCT FROM p_input->'strokes' THEN RAISE EXCEPTION 'link_unavailable' USING ERRCODE='PT404'; END IF;
   ELSE
    IF p_input->>'accepted' IS DISTINCT FROM 'true' OR coalesce(length(p_input->>'fullName'),0) NOT BETWEEN 3 AND 120 OR jsonb_typeof(p_input->'strokes') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'strokes') NOT BETWEEN 1 AND 64 OR p_input->>'requestId' IS NULL THEN RAISE EXCEPTION 'invalid_signature'; END IF;
    IF EXISTS(SELECT 1 FROM public.order_confirmation_signature_claims WHERE revision_id=r.id AND request_id=(p_input->>'requestId')::uuid) THEN RAISE EXCEPTION 'link_unavailable' USING ERRCODE='PT404'; END IF;
    INSERT INTO public.order_confirmation_signature_claims(revision_id,request_id) VALUES(r.id,(p_input->>'requestId')::uuid);
    UPDATE public.order_confirmation_revisions SET status='signing',request_id=(p_input->>'requestId')::uuid,full_name=p_input->>'fullName',strokes=p_input->'strokes',signed_at=clock_timestamp(),claim_expires_at=clock_timestamp()+interval '2 minutes' WHERE id=r.id RETURNING * INTO r;
   END IF;
  ELSIF p_action='finish' THEN
   IF r.request_id IS DISTINCT FROM (p_input->>'requestId')::uuid OR r.status NOT IN ('signing','signed') THEN RAISE EXCEPTION 'link_unavailable' USING ERRCODE='PT404'; END IF;
   IF r.status='signing' THEN
    UPDATE public.order_confirmation_revisions SET status='signed',signed_hash=p_input->>'signedHash',signed_path=id::text||'/'||request_id::text||'-signed.pdf' WHERE id=r.id RETURNING * INTO r;
   ELSIF r.signed_hash IS DISTINCT FROM p_input->>'signedHash' THEN RAISE EXCEPTION 'revision_conflict' USING ERRCODE='PT409'; END IF;
  ELSIF p_action NOT IN ('view','staff_read') THEN RAISE EXCEPTION 'invalid_request';
  END IF;
 END IF;
 RETURN to_jsonb(r)-'token_hash';
END $$;
REVOKE ALL ON FUNCTION public.order_signature_action(text,jsonb),public.protect_order_signature_evidence() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.order_signature_action(text,jsonb) TO service_role;

CREATE TABLE public.order_signature_rate_limits(bucket text PRIMARY KEY, window_start timestamptz NOT NULL, hits integer NOT NULL);
ALTER TABLE public.order_signature_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_signature_rate_limits FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.order_signature_rate_limit(p_bucket text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'signature_forbidden'; END IF;
 DELETE FROM public.order_signature_rate_limits WHERE window_start<now()-interval '1 day';
 INSERT INTO public.order_signature_rate_limits VALUES(p_bucket,now(),1)
 ON CONFLICT(bucket) DO UPDATE SET hits=CASE WHEN order_signature_rate_limits.window_start<now()-interval '1 minute' THEN 1 ELSE order_signature_rate_limits.hits+1 END,window_start=CASE WHEN order_signature_rate_limits.window_start<now()-interval '1 minute' THEN now() ELSE order_signature_rate_limits.window_start END RETURNING hits INTO n;
 RETURN n<=30;
END $$;
REVOKE ALL ON FUNCTION public.order_signature_rate_limit(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.order_signature_rate_limit(text) TO service_role;
CREATE TABLE public.order_signature_deliveries(
 id uuid PRIMARY KEY,revision_id uuid NOT NULL REFERENCES public.order_confirmation_revisions(id),
 actor_id uuid NOT NULL REFERENCES public.profiles(id),channel text NOT NULL CHECK(channel IN ('email','whatsapp')),
 destination text NOT NULL, state text NOT NULL CHECK(state IN ('dispatched','accepted','failed','uncertain')),
 reason text,provider_message_id text,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 resend_of uuid UNIQUE REFERENCES public.order_signature_deliveries(id),
 CHECK(resend_of IS NULL OR resend_of<>id)
);
CREATE UNIQUE INDEX order_signature_delivery_original ON public.order_signature_deliveries(revision_id,channel) WHERE resend_of IS NULL;
ALTER TABLE public.order_signature_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_signature_deliveries FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.order_signature_deliveries TO service_role;
CREATE FUNCTION public.order_signature_delivery(p_action text,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.order_confirmation_revisions; a public.order_signature_deliveries; parent public.order_signature_deliveries; actor uuid;
BEGIN
 actor=(p_input->>'actorId')::uuid;
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=actor AND role IN ('admin','operations','cashier')) THEN RAISE EXCEPTION 'signature_forbidden' USING ERRCODE='42501'; END IF;
 IF p_action='claim' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_input->>'requestId',110));
  SELECT * INTO a FROM public.order_signature_deliveries WHERE id=(p_input->>'requestId')::uuid;
  IF FOUND THEN
   IF a.actor_id<>actor OR a.revision_id<>(p_input->>'revisionId')::uuid OR a.channel<>p_input->>'channel' OR a.destination<>p_input->>'destination' OR a.resend_of IS DISTINCT FROM (p_input->>'resendOf')::uuid THEN RAISE EXCEPTION 'delivery_conflict' USING ERRCODE='PT409'; END IF;
   RETURN jsonb_build_object('claimed',false,'attempt',to_jsonb(a));
  END IF;
  SELECT * INTO r FROM public.order_confirmation_revisions WHERE id=(p_input->>'revisionId')::uuid FOR UPDATE;
  IF NOT FOUND OR r.status<>'pending' OR r.expires_at<=now() OR r.source_version<>md5(public.order_signature_customer_data(public.order_confirmation_data(r.order_id))::text) THEN RAISE EXCEPTION 'link_unavailable' USING ERRCODE='PT404'; END IF;
  IF (p_input->>'channel'='email' AND (length(p_input->>'destination')>254 OR p_input->>'destination' !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$')) OR (p_input->>'channel'='whatsapp' AND p_input->>'destination' !~ '^[1-9][0-9]{8,14}$') THEN RAISE EXCEPTION 'invalid_destination'; END IF;
  IF p_input->>'resendOf' IS NOT NULL THEN
   SELECT * INTO parent FROM public.order_signature_deliveries WHERE id=(p_input->>'resendOf')::uuid;
   IF NOT FOUND OR parent.revision_id<>r.id OR parent.channel<>p_input->>'channel' OR p_input->>'confirmed' IS DISTINCT FROM 'true' OR EXISTS(SELECT 1 FROM public.order_signature_deliveries WHERE resend_of=parent.id) THEN RAISE EXCEPTION 'delivery_resend_stale' USING ERRCODE='PT409'; END IF;
   IF parent.state='dispatched' AND parent.created_at>now()-interval '2 minutes' THEN RAISE EXCEPTION 'delivery_still_in_progress' USING ERRCODE='PT409'; END IF;
  ELSIF EXISTS(SELECT 1 FROM public.order_signature_deliveries WHERE revision_id=r.id AND channel=p_input->>'channel') THEN RAISE EXCEPTION 'delivery_already_claimed' USING ERRCODE='PT409'; END IF;
  INSERT INTO public.order_signature_deliveries(id,revision_id,actor_id,channel,destination,state,resend_of) VALUES((p_input->>'requestId')::uuid,r.id,actor,p_input->>'channel',p_input->>'destination','dispatched',(p_input->>'resendOf')::uuid) RETURNING * INTO a;
  RETURN jsonb_build_object('claimed',true,'attempt',to_jsonb(a));
 ELSIF p_action='finish' THEN
  SELECT * INTO a FROM public.order_signature_deliveries WHERE id=(p_input->>'requestId')::uuid FOR UPDATE;
  IF NOT FOUND OR a.actor_id<>actor THEN RAISE EXCEPTION 'signature_forbidden' USING ERRCODE='42501'; END IF;
  IF p_input->>'state' NOT IN ('accepted','failed','uncertain') THEN RAISE EXCEPTION 'invalid_request'; END IF;
  IF a.state='dispatched' THEN UPDATE public.order_signature_deliveries SET state=p_input->>'state',reason=p_input->>'reason',provider_message_id=p_input->>'providerId',finished_at=clock_timestamp() WHERE id=a.id RETURNING * INTO a;
  ELSIF a.state IS DISTINCT FROM p_input->>'state' OR a.reason IS DISTINCT FROM p_input->>'reason' OR a.provider_message_id IS DISTINCT FROM p_input->>'providerId' THEN RAISE EXCEPTION 'delivery_conflict' USING ERRCODE='PT409'; END IF;
  RETURN to_jsonb(a);
 END IF;
 RAISE EXCEPTION 'invalid_request';
END $$;
REVOKE ALL ON FUNCTION public.order_signature_delivery(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.order_signature_delivery(text,jsonb) TO service_role;
COMMIT;
