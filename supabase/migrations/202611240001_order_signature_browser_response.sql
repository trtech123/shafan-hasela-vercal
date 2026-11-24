-- Additive signature responses. No historic order, customer, lead, payment or document rows are rewritten.
BEGIN;

CREATE TABLE public.order_signature_responses (
  revision_id uuid PRIMARY KEY REFERENCES public.order_confirmation_revisions(id),
  request_id uuid NOT NULL,
  order_id uuid NOT NULL REFERENCES public.orders(id),
  customer_id uuid REFERENCES public.customers(id),
  lead_id uuid REFERENCES public.leads(id),
  lead_link_status text NOT NULL CHECK (lead_link_status IN ('linked','unmatched','ambiguous')),
  details jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(details) = 'object'),
  full_name text NOT NULL,
  signed_at timestamptz NOT NULL,
  completed_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_signature_responses_customer_idx ON public.order_signature_responses(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX order_signature_responses_lead_idx ON public.order_signature_responses(lead_id) WHERE lead_id IS NOT NULL;
ALTER TABLE public.order_signature_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_signature_responses FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.order_signature_responses TO authenticated,service_role;
CREATE POLICY order_signature_responses_staff_read ON public.order_signature_responses
  FOR SELECT TO authenticated USING (completed_at IS NOT NULL AND (public.is_admin_or_ops() OR public.is_cashier()));

CREATE FUNCTION public.record_order_signature_response(p_revision_id uuid,p_request_id uuid,p_details jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.order_confirmation_revisions; o public.orders; existing public.order_signature_responses;
        lead_count integer; linked_lead uuid; frozen_customer uuid; link_state text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'signature_forbidden' USING ERRCODE='42501'; END IF;
  IF p_details IS NULL OR pg_catalog.jsonb_typeof(p_details) <> 'object' OR
     EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_details) AS key WHERE key NOT IN ('phone','email','organization','signerId')) OR
     EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(p_details) AS e WHERE pg_catalog.jsonb_typeof(e.value) <> 'string') OR
     length(coalesce(p_details->>'phone','')) > 24 OR length(coalesce(p_details->>'email','')) > 320 OR
     length(coalesce(p_details->>'organization','')) > 300 OR
     (p_details ? 'signerId' AND NOT public.order_signature_valid_israeli_id(p_details->>'signerId'))
  THEN RAISE EXCEPTION 'invalid_contact_details' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM public.order_confirmation_revisions WHERE id=p_revision_id FOR SHARE;
  IF NOT FOUND OR r.status NOT IN ('signing','signed') OR r.request_id IS DISTINCT FROM p_request_id THEN
    RAISE EXCEPTION 'link_unavailable' USING ERRCODE='PT404';
  END IF;
  IF (p_details->>'signerId') IS DISTINCT FROM r.signer_id THEN
    RAISE EXCEPTION 'invalid_contact_details' USING ERRCODE='22023';
  END IF;
  SELECT * INTO existing FROM public.order_signature_responses WHERE revision_id=p_revision_id FOR UPDATE;
  IF FOUND THEN
    -- An expired signing claim may be replaced by a fresh claim. A completed
    -- response, or changed details within the same claim, remain immutable.
    IF existing.request_id IS DISTINCT FROM p_request_id AND existing.completed_at IS NULL AND r.status='signing' THEN
      DELETE FROM public.order_signature_responses WHERE revision_id=p_revision_id;
    ELSIF existing.request_id IS DISTINCT FROM p_request_id OR existing.details IS DISTINCT FROM p_details THEN
      RAISE EXCEPTION 'revision_conflict' USING ERRCODE='PT409';
    ELSE
      IF r.status='signed' AND existing.completed_at IS NULL THEN
        UPDATE public.order_signature_responses SET completed_at=now() WHERE revision_id=p_revision_id;
      END IF;
      RETURN pg_catalog.jsonb_build_object('recorded',true,'leadLinkStatus',existing.lead_link_status);
    END IF;
  END IF;
  -- Older signed documents have no browser-contact evidence. Never attach
  -- fresh details to one merely because its signing token is replayed.
  IF r.status='signed' THEN RAISE EXCEPTION 'revision_conflict' USING ERRCODE='PT409'; END IF;
  SELECT * INTO o FROM public.orders WHERE id=r.order_id FOR SHARE;
  IF nullif(r.snapshot->'data'->>'customer_snapshot_id','') IS NOT NULL THEN
    SELECT s.customer_id INTO frozen_customer FROM public.customer_snapshots s
    WHERE s.id=(r.snapshot->'data'->>'customer_snapshot_id')::uuid AND s.order_id=o.id;
  END IF;
  SELECT count(*), (pg_catalog.array_agg(id))[1] INTO lead_count,linked_lead
    FROM public.leads WHERE converted_to_quote_id=o.quote_id AND o.quote_id IS NOT NULL;
  link_state := CASE WHEN lead_count=1 THEN 'linked' WHEN lead_count>1 THEN 'ambiguous' ELSE 'unmatched' END;
  INSERT INTO public.order_signature_responses(revision_id,request_id,order_id,customer_id,lead_id,lead_link_status,details,full_name,signed_at,completed_at)
  VALUES(r.id,p_request_id,o.id,frozen_customer,CASE WHEN lead_count=1 THEN linked_lead ELSE NULL END,link_state,p_details,r.full_name,r.signed_at,
    CASE WHEN r.status='signed' THEN now() ELSE NULL END)
  ON CONFLICT (revision_id) DO NOTHING;
  SELECT * INTO existing FROM public.order_signature_responses WHERE revision_id=p_revision_id;
  IF existing.request_id IS DISTINCT FROM p_request_id OR existing.details IS DISTINCT FROM p_details THEN
    RAISE EXCEPTION 'revision_conflict' USING ERRCODE='PT409';
  END IF;
  IF r.status='signed' AND existing.completed_at IS NULL THEN
    UPDATE public.order_signature_responses SET completed_at=now() WHERE revision_id=p_revision_id;
  END IF;
  RETURN pg_catalog.jsonb_build_object('recorded',true,'leadLinkStatus',existing.lead_link_status);
END $$;
REVOKE ALL ON FUNCTION public.record_order_signature_response(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_order_signature_response(uuid,uuid,jsonb) TO service_role;

COMMIT;
