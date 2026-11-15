-- Explicit manual resends form an append-only chain: one child per parent.
-- Normal claims remain unchanged and cannot bypass existing dispatch guards.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.order_delivery_attempts
 ADD COLUMN resend_of uuid REFERENCES public.order_delivery_attempts(id),
 ADD COLUMN attempt_type text NOT NULL DEFAULT 'original',
 ADD CONSTRAINT order_delivery_attempt_type_check CHECK((resend_of IS NULL AND attempt_type='original') OR (resend_of IS NOT NULL AND attempt_type='manual_resend' AND resend_of<>id)),
 ADD CONSTRAINT order_delivery_one_resend_per_parent UNIQUE(resend_of);
ALTER TABLE public.order_delivery_attempts DROP CONSTRAINT order_delivery_attempts_order_id_version_channel_key;
CREATE UNIQUE INDEX order_delivery_original_once ON public.order_delivery_attempts(order_id,version,channel) WHERE resend_of IS NULL;
CREATE FUNCTION public.claim_manual_order_delivery(p_request_id uuid,p_order_id uuid,p_version text,p_channel text,p_actor_id uuid,p_pdf_sha256 text,p_destination text,p_resend_of uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE parent public.order_delivery_attempts; a public.order_delivery_attempts; d jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role IN ('admin','operations','cashier')) THEN RAISE EXCEPTION 'order_delivery_forbidden' USING ERRCODE='42501'; END IF;
 IF p_resend_of IS NULL OR p_request_id=p_resend_of OR p_request_id IS NULL OR p_order_id IS NULL OR p_version IS NULL OR p_version !~ '^[0-9a-f]{32}$' OR p_channel IS NULL OR p_channel NOT IN ('email','whatsapp') OR p_pdf_sha256 IS NULL OR p_pdf_sha256 !~ '^[0-9a-f]{64}$' OR p_destination IS NULL THEN RAISE EXCEPTION 'invalid_delivery_request' USING ERRCODE='22023'; END IF;
 IF (p_channel='email' AND (length(p_destination)>254 OR p_destination<>pg_catalog.lower(pg_catalog.btrim(p_destination)) OR p_destination !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$')) OR (p_channel='whatsapp' AND (p_destination !~ '^[1-9][0-9]{8,14}$' OR (pg_catalog.left(p_destination,3)='972' AND p_destination !~ '^972(5[0-9]{8}|[23489][0-9]{7}|7[0-9]{8})$'))) THEN RAISE EXCEPTION 'invalid_destination' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,48));
 SELECT * INTO a FROM public.order_delivery_attempts WHERE id=p_request_id;
 IF FOUND THEN
  IF a.resend_of IS DISTINCT FROM p_resend_of OR a.order_id<>p_order_id OR a.version<>p_version OR a.channel<>p_channel OR a.actor_id<>p_actor_id OR a.pdf_sha256<>p_pdf_sha256 OR a.destination<>p_destination THEN RAISE EXCEPTION 'delivery_request_conflict' USING ERRCODE='PT409'; END IF;
  RETURN pg_catalog.jsonb_build_object('claimed',false,'attempt',pg_catalog.to_jsonb(a));
 END IF;
 PERFORM 1 FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE='PT404'; END IF;
 d=public.order_confirmation_data(p_order_id);
 IF pg_catalog.md5(d::text)<>p_version THEN RAISE EXCEPTION 'order_version_stale' USING ERRCODE='PT409'; END IF;
 SELECT * INTO parent FROM public.order_delivery_attempts WHERE id=p_resend_of;
 IF NOT FOUND OR parent.order_id<>p_order_id OR parent.channel<>p_channel THEN RAISE EXCEPTION 'delivery_resend_parent_invalid' USING ERRCODE='PT409'; END IF;
 IF EXISTS(SELECT 1 FROM public.order_delivery_attempts WHERE resend_of=p_resend_of OR (order_id=p_order_id AND channel=p_channel AND created_at>parent.created_at)) THEN RAISE EXCEPTION 'delivery_resend_stale' USING ERRCODE='PT409'; END IF;
 -- Never overlap the bounded provider execution window with a manual resend.
 IF parent.state='dispatched' AND parent.dispatched_at>pg_catalog.clock_timestamp()-interval '2 minutes' THEN RAISE EXCEPTION 'delivery_still_in_progress' USING ERRCODE='PT409'; END IF;
 INSERT INTO public.order_delivery_attempts(id,order_id,version,document_snapshot,channel,destination,pdf_sha256,state,actor_id,resend_of,attempt_type)
 VALUES(p_request_id,p_order_id,p_version,d,p_channel,p_destination,p_pdf_sha256,'dispatched',p_actor_id,p_resend_of,'manual_resend') RETURNING * INTO a;
 RETURN pg_catalog.jsonb_build_object('claimed',true,'attempt',pg_catalog.to_jsonb(a),'revision',d);
END $$;
CREATE OR REPLACE FUNCTION public.claim_order_delivery(p_request_id uuid,p_order_id uuid,p_version text,p_channel text,p_actor_id uuid,p_pdf_sha256 text,p_destination text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.order_delivery_attempts; d jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role IN ('admin','operations','cashier')) THEN RAISE EXCEPTION 'order_delivery_forbidden' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_order_id IS NULL OR p_version IS NULL OR p_version !~ '^[0-9a-f]{32}$' OR p_channel IS NULL OR p_channel NOT IN ('email','whatsapp') OR p_pdf_sha256 IS NULL OR p_pdf_sha256 !~ '^[0-9a-f]{64}$' OR p_destination IS NULL THEN RAISE EXCEPTION 'invalid_delivery_request' USING ERRCODE='22023'; END IF;
 IF (p_channel='email' AND (length(p_destination)>254 OR p_destination<>pg_catalog.lower(pg_catalog.btrim(p_destination)) OR p_destination !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$')) OR (p_channel='whatsapp' AND (p_destination !~ '^[1-9][0-9]{8,14}$' OR (pg_catalog.left(p_destination,3)='972' AND p_destination !~ '^972(5[0-9]{8}|[23489][0-9]{7}|7[0-9]{8})$'))) THEN RAISE EXCEPTION 'invalid_destination' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,48));
 SELECT * INTO a FROM public.order_delivery_attempts WHERE id=p_request_id;
 IF FOUND THEN
  IF a.resend_of IS NOT NULL OR a.order_id<>p_order_id OR a.version<>p_version OR a.channel<>p_channel OR a.actor_id<>p_actor_id OR a.pdf_sha256<>p_pdf_sha256 OR a.destination<>p_destination THEN RAISE EXCEPTION 'delivery_request_conflict' USING ERRCODE='PT409'; END IF;
  RETURN pg_catalog.jsonb_build_object('claimed',false,'attempt',pg_catalog.to_jsonb(a));
 END IF;
 PERFORM 1 FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE='PT404'; END IF;
 d=public.order_confirmation_data(p_order_id);
 IF pg_catalog.md5(d::text)<>p_version THEN RAISE EXCEPTION 'order_version_stale' USING ERRCODE='PT409'; END IF;
 IF EXISTS(SELECT 1 FROM public.order_delivery_attempts WHERE order_id=p_order_id AND channel=p_channel) THEN RAISE EXCEPTION 'order_delivery_already_claimed' USING ERRCODE='PT409'; END IF;
 INSERT INTO public.order_delivery_attempts(id,order_id,version,document_snapshot,channel,destination,pdf_sha256,state,actor_id)
 VALUES(p_request_id,p_order_id,p_version,d,p_channel,p_destination,p_pdf_sha256,'dispatched',p_actor_id) RETURNING * INTO a;
 RETURN pg_catalog.jsonb_build_object('claimed',true,'attempt',pg_catalog.to_jsonb(a),'revision',d);
END $$;
REVOKE ALL ON FUNCTION public.claim_manual_order_delivery(uuid,uuid,text,text,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_manual_order_delivery(uuid,uuid,text,text,uuid,text,text,uuid) TO service_role;
ALTER TABLE public.quotation_delivery_attempts
 ADD COLUMN resend_of uuid REFERENCES public.quotation_delivery_attempts(id),
 ADD COLUMN attempt_type text NOT NULL DEFAULT 'original',
 ADD CONSTRAINT quotation_delivery_attempt_type_check CHECK((resend_of IS NULL AND attempt_type='original') OR (resend_of IS NOT NULL AND attempt_type='manual_resend' AND resend_of<>id)),
 ADD CONSTRAINT quotation_delivery_one_resend_per_parent UNIQUE(resend_of);
ALTER TABLE public.quotation_delivery_attempts DROP CONSTRAINT quotation_delivery_attempts_quote_id_revision_id_channel_key;
CREATE UNIQUE INDEX quotation_delivery_original_once ON public.quotation_delivery_attempts(quote_id,revision_id,channel) WHERE resend_of IS NULL;
CREATE FUNCTION public.claim_manual_quotation_delivery(p_request_id uuid,p_quote_id uuid,p_revision_id uuid,p_channel text,p_actor_id uuid,p_pdf_sha256 text,p_resend_of uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE parent public.quotation_delivery_attempts; a public.quotation_delivery_attempts; q public.quotes; r public.quotation_revisions; destination text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role IN ('admin','operations')) THEN RAISE EXCEPTION 'quotation_delivery_forbidden' USING ERRCODE='42501'; END IF;
 IF p_resend_of IS NULL OR p_request_id=p_resend_of OR p_request_id IS NULL OR p_quote_id IS NULL OR p_revision_id IS NULL OR p_channel NOT IN ('email','whatsapp') OR p_channel IS NULL OR p_pdf_sha256 IS NULL OR p_pdf_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_delivery_request' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,47));
 SELECT * INTO a FROM public.quotation_delivery_attempts WHERE id=p_request_id;
 IF FOUND THEN
  IF a.resend_of IS DISTINCT FROM p_resend_of OR a.quote_id<>p_quote_id OR a.revision_id<>p_revision_id OR a.channel<>p_channel OR a.actor_id<>p_actor_id OR a.pdf_sha256<>p_pdf_sha256 THEN RAISE EXCEPTION 'delivery_request_conflict' USING ERRCODE='PT409'; END IF;
  RETURN pg_catalog.jsonb_build_object('claimed',false,'attempt',pg_catalog.to_jsonb(a));
 END IF;
 SELECT * INTO q FROM public.quotes WHERE id=p_quote_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'quotation_not_found' USING ERRCODE='PT404'; END IF;
 IF q.quotation_revision_id IS DISTINCT FROM p_revision_id THEN RAISE EXCEPTION 'quotation_revision_stale' USING ERRCODE='PT409'; END IF;
 SELECT * INTO r FROM public.quotation_revisions WHERE id=p_revision_id AND quote_id=p_quote_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'quotation_revision_not_found' USING ERRCODE='PT404'; END IF;
 SELECT * INTO parent FROM public.quotation_delivery_attempts WHERE id=p_resend_of;
 IF NOT FOUND OR parent.quote_id<>p_quote_id OR parent.channel<>p_channel THEN RAISE EXCEPTION 'delivery_resend_parent_invalid' USING ERRCODE='PT409'; END IF;
 IF EXISTS(SELECT 1 FROM public.quotation_delivery_attempts WHERE resend_of=p_resend_of OR (quote_id=p_quote_id AND channel=p_channel AND created_at>parent.created_at)) THEN RAISE EXCEPTION 'delivery_resend_stale' USING ERRCODE='PT409'; END IF;
 -- Never overlap the bounded provider execution window with a manual resend.
 IF parent.state='dispatched' AND parent.dispatched_at>pg_catalog.clock_timestamp()-interval '2 minutes' THEN RAISE EXCEPTION 'delivery_still_in_progress' USING ERRCODE='PT409'; END IF;
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
 INSERT INTO public.quotation_delivery_attempts(id,quote_id,revision_id,channel,destination,pdf_sha256,state,actor_id,resend_of,attempt_type)
 VALUES(p_request_id,p_quote_id,p_revision_id,p_channel,destination,p_pdf_sha256,'dispatched',p_actor_id,p_resend_of,'manual_resend') RETURNING * INTO a;
 RETURN pg_catalog.jsonb_build_object('claimed',true,'attempt',pg_catalog.to_jsonb(a),'revision',r.data);
END $$;
CREATE OR REPLACE FUNCTION public.claim_quotation_delivery(p_request_id uuid,p_quote_id uuid,p_revision_id uuid,p_channel text,p_actor_id uuid,p_pdf_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.quotation_delivery_attempts; q public.quotes; r public.quotation_revisions; destination text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role IN ('admin','operations')) THEN RAISE EXCEPTION 'quotation_delivery_forbidden' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_quote_id IS NULL OR p_revision_id IS NULL OR p_channel NOT IN ('email','whatsapp') OR p_channel IS NULL OR p_pdf_sha256 IS NULL OR p_pdf_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_delivery_request' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,47));
 SELECT * INTO a FROM public.quotation_delivery_attempts WHERE id=p_request_id;
 IF FOUND THEN
  IF a.resend_of IS NOT NULL OR a.quote_id<>p_quote_id OR a.revision_id<>p_revision_id OR a.channel<>p_channel OR a.actor_id<>p_actor_id OR a.pdf_sha256<>p_pdf_sha256 THEN RAISE EXCEPTION 'delivery_request_conflict' USING ERRCODE='PT409'; END IF;
  RETURN pg_catalog.jsonb_build_object('claimed',false,'attempt',pg_catalog.to_jsonb(a));
 END IF;
 SELECT * INTO q FROM public.quotes WHERE id=p_quote_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'quotation_not_found' USING ERRCODE='PT404'; END IF;
 IF q.quotation_revision_id IS DISTINCT FROM p_revision_id THEN RAISE EXCEPTION 'quotation_revision_stale' USING ERRCODE='PT409'; END IF;
 SELECT * INTO r FROM public.quotation_revisions WHERE id=p_revision_id AND quote_id=p_quote_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'quotation_revision_not_found' USING ERRCODE='PT404'; END IF;
 IF EXISTS(SELECT 1 FROM public.quotation_delivery_attempts WHERE quote_id=p_quote_id AND channel=p_channel) THEN RAISE EXCEPTION 'quotation_delivery_already_claimed' USING ERRCODE='PT409'; END IF;
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
REVOKE ALL ON FUNCTION public.claim_manual_quotation_delivery(uuid,uuid,uuid,text,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_manual_quotation_delivery(uuid,uuid,uuid,text,uuid,text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
