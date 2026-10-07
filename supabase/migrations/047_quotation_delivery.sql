BEGIN;
CREATE TABLE public.quotation_delivery_attempts (
 id uuid PRIMARY KEY, quote_id uuid NOT NULL REFERENCES public.quotes(id),
 revision_id uuid NOT NULL REFERENCES public.quotation_revisions(id),
 channel text NOT NULL CHECK(channel IN ('email','whatsapp')), destination text NOT NULL CHECK(length(destination) BETWEEN 1 AND 254),
 pdf_sha256 text NOT NULL CHECK(pdf_sha256 ~ '^[0-9a-f]{64}$'),
 state text NOT NULL CHECK(state IN ('dispatched','accepted','failed','uncertain')),
 reason text, provider_message_id text CHECK(provider_message_id IS NULL OR provider_message_id ~ '^[A-Za-z0-9._:@+/=<>-]{1,300}$'),
 actor_id uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
 dispatched_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 UNIQUE(quote_id,revision_id,channel),
 CHECK((state='dispatched' AND finished_at IS NULL AND reason IS NULL AND provider_message_id IS NULL) OR (state<>'dispatched' AND finished_at IS NOT NULL)),
 CHECK(reason IS NULL OR reason IN ('provider_rejected','provider_timeout','provider_unavailable','provider_response_uncertain'))
);
ALTER TABLE public.quotation_delivery_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quotation_delivery_attempts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.quotation_delivery_attempts TO authenticated,service_role;
CREATE POLICY quotation_delivery_read ON public.quotation_delivery_attempts FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.role IN ('admin','operations')));

CREATE FUNCTION public.claim_quotation_delivery(p_request_id uuid,p_quote_id uuid,p_revision_id uuid,p_channel text,p_actor_id uuid,p_pdf_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.quotation_delivery_attempts; q public.quotes; r public.quotation_revisions; destination text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role IN ('admin','operations')) THEN RAISE EXCEPTION 'quotation_delivery_forbidden' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_quote_id IS NULL OR p_revision_id IS NULL OR p_channel NOT IN ('email','whatsapp') OR p_channel IS NULL OR p_pdf_sha256 IS NULL OR p_pdf_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_delivery_request' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,47));
 SELECT * INTO a FROM public.quotation_delivery_attempts WHERE id=p_request_id;
 IF FOUND THEN
  IF a.quote_id<>p_quote_id OR a.revision_id<>p_revision_id OR a.channel<>p_channel OR a.actor_id<>p_actor_id OR a.pdf_sha256<>p_pdf_sha256 THEN RAISE EXCEPTION 'delivery_request_conflict' USING ERRCODE='PT409'; END IF;
  RETURN pg_catalog.jsonb_build_object('claimed',false,'attempt',pg_catalog.to_jsonb(a));
 END IF;
 SELECT * INTO q FROM public.quotes WHERE id=p_quote_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'quotation_not_found' USING ERRCODE='PT404'; END IF;
 IF q.quotation_revision_id IS DISTINCT FROM p_revision_id THEN RAISE EXCEPTION 'quotation_revision_stale' USING ERRCODE='PT409'; END IF;
 SELECT * INTO r FROM public.quotation_revisions WHERE id=p_revision_id AND quote_id=p_quote_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'quotation_revision_not_found' USING ERRCODE='PT404'; END IF;
 IF EXISTS(SELECT 1 FROM public.quotation_delivery_attempts WHERE quote_id=p_quote_id AND revision_id=p_revision_id AND channel=p_channel) THEN RAISE EXCEPTION 'quotation_delivery_already_claimed' USING ERRCODE='PT409'; END IF;
 IF p_channel='email' THEN
  destination=pg_catalog.btrim(r.data->>'client_email');
  IF destination IS NULL OR length(destination)>254 OR destination !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$' THEN RAISE EXCEPTION 'invalid_saved_email' USING ERRCODE='22023'; END IF;
 ELSE
  destination=r.data->>'client_phone';
  IF destination IS NULL OR length(destination) NOT BETWEEN 7 AND 40 OR pg_catalog.btrim(destination) !~ '^\+?[0-9 ()-]+$' OR destination ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'invalid_saved_phone' USING ERRCODE='22023'; END IF;
  IF pg_catalog.left(pg_catalog.btrim(destination),1)='+' AND pg_catalog.left(pg_catalog.regexp_replace(destination,'[^0-9]','','g'),1)='0' THEN RAISE EXCEPTION 'invalid_saved_phone' USING ERRCODE='22023'; END IF;
  destination=pg_catalog.regexp_replace(destination,'[^0-9]','','g');
  IF pg_catalog.left(destination,5)='00972' THEN destination=pg_catalog.substr(destination,3);
  ELSIF pg_catalog.left(destination,1)='0' THEN destination='972'||pg_catalog.substr(destination,2); END IF;
  IF (pg_catalog.left(destination,3)='972' AND destination !~ '^972(5[0-9]{8}|[23489][0-9]{7}|7[0-9]{8})$') OR destination !~ '^[1-9][0-9]{8,14}$' THEN RAISE EXCEPTION 'invalid_saved_phone' USING ERRCODE='22023'; END IF;
 END IF;
 INSERT INTO public.quotation_delivery_attempts(id,quote_id,revision_id,channel,destination,pdf_sha256,state,actor_id)
 VALUES(p_request_id,p_quote_id,p_revision_id,p_channel,destination,p_pdf_sha256,'dispatched',p_actor_id) RETURNING * INTO a;
 RETURN pg_catalog.jsonb_build_object('claimed',true,'attempt',pg_catalog.to_jsonb(a),'revision',r.data);
END $$;

CREATE FUNCTION public.finish_quotation_delivery(p_request_id uuid,p_actor_id uuid,p_state text,p_reason text DEFAULT NULL,p_provider_message_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.quotation_delivery_attempts;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role IN ('admin','operations')) THEN RAISE EXCEPTION 'quotation_delivery_forbidden' USING ERRCODE='42501'; END IF;
 IF p_state IS NULL OR p_state NOT IN ('accepted','failed','uncertain') OR (p_state='accepted' AND (p_reason IS NOT NULL OR p_provider_message_id IS NULL)) OR (p_state<>'accepted' AND (p_reason IS NULL OR p_provider_message_id IS NOT NULL)) THEN RAISE EXCEPTION 'invalid_delivery_result' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM public.quotation_delivery_attempts WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND OR a.actor_id<>p_actor_id THEN RAISE EXCEPTION 'quotation_delivery_not_found' USING ERRCODE='PT404'; END IF;
 IF a.state<>'dispatched' THEN
  IF a.state IS DISTINCT FROM p_state OR a.reason IS DISTINCT FROM p_reason OR a.provider_message_id IS DISTINCT FROM p_provider_message_id THEN RAISE EXCEPTION 'delivery_result_conflict' USING ERRCODE='PT409'; END IF;
  RETURN pg_catalog.to_jsonb(a);
 END IF;
 UPDATE public.quotation_delivery_attempts SET state=p_state,reason=p_reason,provider_message_id=p_provider_message_id,finished_at=pg_catalog.now() WHERE id=p_request_id RETURNING * INTO a;
 RETURN pg_catalog.to_jsonb(a);
END $$;
REVOKE ALL ON FUNCTION public.claim_quotation_delivery(uuid,uuid,uuid,text,uuid,text), public.finish_quotation_delivery(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_quotation_delivery(uuid,uuid,uuid,text,uuid,text), public.finish_quotation_delivery(uuid,uuid,text,text,text) TO service_role;
COMMIT;
