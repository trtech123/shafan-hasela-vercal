BEGIN;
-- Only frozen customer records and saved order values enter document versions.
CREATE FUNCTION public.order_confirmation_data(p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders; d jsonb; c jsonb; actor_role text;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE='PT404'; END IF;
 SELECT role INTO actor_role FROM public.profiles WHERE id=auth.uid();
 IF auth.role() IS DISTINCT FROM 'service_role' AND (actor_role IS NULL OR NOT (actor_role IN ('admin','operations','cashier') OR (actor_role='instructor' AND o.instructor_id IS NOT DISTINCT FROM public.get_my_instructor_id() AND o.instructor_id IS NOT NULL))) THEN RAISE EXCEPTION 'order_delivery_forbidden' USING ERRCODE='42501'; END IF;
 SELECT pg_catalog.jsonb_object_agg(k,v) INTO d FROM pg_catalog.jsonb_each(pg_catalog.to_jsonb(o)) e(k,v)
 WHERE k=ANY(ARRAY['id','order_number','client_name','client_phone','client_email','organization','activity_date','start_time','end_time','site','num_participants','price_per_person','total_price','notes','status','payment_status','created_at','vat_applicable','quotation_snapshot','customer_snapshot_id','customer_record_version','billing_institution_name','billing_company_id','billing_accounting_email','billing_address_line','billing_city','billing_postal_code','billing_country_code']);
 IF o.customer_snapshot_id IS NOT NULL THEN
  SELECT s.data INTO c FROM public.customer_snapshots s WHERE s.id=o.customer_snapshot_id AND s.order_id=o.id;
  IF c IS NULL THEN RAISE EXCEPTION 'invalid_saved_order' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN d||pg_catalog.jsonb_build_object('customer_snapshot',c);
END $$;
REVOKE ALL ON FUNCTION public.order_confirmation_data(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.order_confirmation_data(uuid) TO authenticated,service_role;

-- Invoker query ensures existing order RLS is applied before the snapshot helper.
CREATE FUNCTION public.order_confirmation_document(p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE d jsonb; allowed boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.orders WHERE id=p_order_id) THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE='PT404'; END IF;
 d=public.order_confirmation_data(p_order_id);
 SELECT role IN ('admin','operations','cashier') INTO allowed FROM public.profiles WHERE id=auth.uid();
 RETURN pg_catalog.jsonb_build_object('version',pg_catalog.md5(d::text),'data',d,'can_send',COALESCE(allowed,false));
END $$;
REVOKE ALL ON FUNCTION public.order_confirmation_document(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.order_confirmation_document(uuid) TO authenticated;

CREATE TABLE public.order_delivery_attempts (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES public.orders(id), version text NOT NULL CHECK(version ~ '^[0-9a-f]{32}$'),
 document_snapshot jsonb NOT NULL CHECK(jsonb_typeof(document_snapshot)='object'),
 channel text NOT NULL CHECK(channel IN ('email','whatsapp')), destination text NOT NULL CHECK(length(destination) BETWEEN 1 AND 254),
 pdf_sha256 text NOT NULL CHECK(pdf_sha256 ~ '^[0-9a-f]{64}$'),
 state text NOT NULL CHECK(state IN ('dispatched','accepted','failed','uncertain')),
 reason text CHECK(reason IS NULL OR reason IN ('provider_rejected','provider_timeout','provider_unavailable','provider_response_uncertain')),
 provider_message_id text CHECK(provider_message_id IS NULL OR provider_message_id ~ '^[A-Za-z0-9._:@+/=<>-]{1,300}$'),
 actor_id uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(), dispatched_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 UNIQUE(order_id,version,channel),
 CHECK((state='dispatched' AND finished_at IS NULL AND reason IS NULL AND provider_message_id IS NULL) OR (state='accepted' AND finished_at IS NOT NULL AND reason IS NULL AND provider_message_id IS NOT NULL) OR (state IN ('failed','uncertain') AND finished_at IS NOT NULL AND reason IS NOT NULL AND provider_message_id IS NULL))
);
ALTER TABLE public.order_delivery_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_delivery_attempts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.order_delivery_attempts TO authenticated,service_role;
CREATE POLICY order_delivery_read ON public.order_delivery_attempts FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.orders o WHERE o.id=order_delivery_attempts.order_id));
CREATE FUNCTION public.claim_order_delivery(p_request_id uuid,p_order_id uuid,p_version text,p_channel text,p_actor_id uuid,p_pdf_sha256 text,p_destination text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.order_delivery_attempts; d jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role IN ('admin','operations','cashier')) THEN RAISE EXCEPTION 'order_delivery_forbidden' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_order_id IS NULL OR p_version IS NULL OR p_version !~ '^[0-9a-f]{32}$' OR p_channel IS NULL OR p_channel NOT IN ('email','whatsapp') OR p_pdf_sha256 IS NULL OR p_pdf_sha256 !~ '^[0-9a-f]{64}$' OR p_destination IS NULL THEN RAISE EXCEPTION 'invalid_delivery_request' USING ERRCODE='22023'; END IF;
 IF (p_channel='email' AND (length(p_destination)>254 OR p_destination<>pg_catalog.lower(pg_catalog.btrim(p_destination)) OR p_destination !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$')) OR (p_channel='whatsapp' AND (p_destination !~ '^[1-9][0-9]{8,14}$' OR (pg_catalog.left(p_destination,3)='972' AND p_destination !~ '^972(5[0-9]{8}|[23489][0-9]{7}|7[0-9]{8})$'))) THEN RAISE EXCEPTION 'invalid_destination' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,48));
 SELECT * INTO a FROM public.order_delivery_attempts WHERE id=p_request_id;
 IF FOUND THEN
  IF a.order_id<>p_order_id OR a.version<>p_version OR a.channel<>p_channel OR a.actor_id<>p_actor_id OR a.pdf_sha256<>p_pdf_sha256 OR a.destination<>p_destination THEN RAISE EXCEPTION 'delivery_request_conflict' USING ERRCODE='PT409'; END IF;
  RETURN pg_catalog.jsonb_build_object('claimed',false,'attempt',pg_catalog.to_jsonb(a));
 END IF;
 PERFORM 1 FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE='PT404'; END IF;
 d=public.order_confirmation_data(p_order_id);
 IF pg_catalog.md5(d::text)<>p_version THEN RAISE EXCEPTION 'order_version_stale' USING ERRCODE='PT409'; END IF;
 IF EXISTS(SELECT 1 FROM public.order_delivery_attempts WHERE order_id=p_order_id AND channel=p_channel AND (version=p_version OR state IN ('dispatched','uncertain'))) THEN RAISE EXCEPTION 'order_delivery_already_claimed' USING ERRCODE='PT409'; END IF;
 INSERT INTO public.order_delivery_attempts(id,order_id,version,document_snapshot,channel,destination,pdf_sha256,state,actor_id)
 VALUES(p_request_id,p_order_id,p_version,d,p_channel,p_destination,p_pdf_sha256,'dispatched',p_actor_id) RETURNING * INTO a;
 RETURN pg_catalog.jsonb_build_object('claimed',true,'attempt',pg_catalog.to_jsonb(a),'revision',d);
END $$;
CREATE FUNCTION public.finish_order_delivery(p_request_id uuid,p_actor_id uuid,p_state text,p_reason text DEFAULT NULL,p_provider_message_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.order_delivery_attempts;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role IN ('admin','operations','cashier')) THEN RAISE EXCEPTION 'order_delivery_forbidden' USING ERRCODE='42501'; END IF;
 IF p_state IS NULL OR p_state NOT IN ('accepted','failed','uncertain') OR (p_state='accepted' AND (p_reason IS NOT NULL OR p_provider_message_id IS NULL)) OR (p_state<>'accepted' AND (p_reason IS NULL OR p_provider_message_id IS NOT NULL)) THEN RAISE EXCEPTION 'invalid_delivery_result' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM public.order_delivery_attempts WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND OR a.actor_id<>p_actor_id THEN RAISE EXCEPTION 'order_delivery_not_found' USING ERRCODE='PT404'; END IF;
 IF a.state<>'dispatched' THEN
  IF a.state IS DISTINCT FROM p_state OR a.reason IS DISTINCT FROM p_reason OR a.provider_message_id IS DISTINCT FROM p_provider_message_id THEN RAISE EXCEPTION 'delivery_result_conflict' USING ERRCODE='PT409'; END IF;
  RETURN pg_catalog.to_jsonb(a);
 END IF;
 UPDATE public.order_delivery_attempts SET state=p_state,reason=p_reason,provider_message_id=p_provider_message_id,finished_at=pg_catalog.now() WHERE id=p_request_id RETURNING * INTO a;
 RETURN pg_catalog.to_jsonb(a);
END $$;
REVOKE ALL ON FUNCTION public.claim_order_delivery(uuid,uuid,text,text,uuid,text,text),public.finish_order_delivery(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_order_delivery(uuid,uuid,text,text,uuid,text,text),public.finish_order_delivery(uuid,uuid,text,text,text) TO service_role;
COMMIT;
