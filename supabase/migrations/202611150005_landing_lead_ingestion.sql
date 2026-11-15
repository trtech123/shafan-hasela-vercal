-- Landing lead ingestion is independent of payment and chatbot records.
-- Historical leads remain unchanged; their source stays unknown unless already recorded.
BEGIN;

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS lead_source text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS lead_attribution jsonb;

CREATE TABLE IF NOT EXISTS public.landing_lead_submissions (
  submission_key text PRIMARY KEY CHECK (submission_key ~ '^[a-f0-9]{64}$'),
  contact_key text NOT NULL CHECK (contact_key ~ '^[a-f0-9]{64}$'),
  form_id text NOT NULL CHECK (length(form_id) BETWEEN 1 AND 100),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS landing_lead_submissions_contact_time
  ON public.landing_lead_submissions(contact_key, created_at DESC);
CREATE INDEX IF NOT EXISTS landing_lead_submissions_created
  ON public.landing_lead_submissions(created_at DESC);
ALTER TABLE public.landing_lead_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.landing_lead_submissions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.landing_lead_submissions TO service_role;

CREATE OR REPLACE FUNCTION public.ingest_landing_lead(
  p_form_id text, p_submission_key text, p_contact_key text, p_lead jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_existing uuid;
  v_lead_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'landing_lead_forbidden';
  END IF;
  IF p_form_id IS NULL OR length(p_form_id) NOT BETWEEN 1 AND 100 OR
    p_submission_key IS NULL OR p_submission_key !~ '^[a-f0-9]{64}$' OR
    p_contact_key IS NULL OR p_contact_key !~ '^[a-f0-9]{64}$' OR
    pg_catalog.jsonb_typeof(p_lead) IS DISTINCT FROM 'object' OR
    p_lead->>'source' IS DISTINCT FROM 'landing_page' OR
    length(coalesce(p_lead->>'fullName','')) NOT BETWEEN 2 AND 200 OR
    length(coalesce(p_lead->>'phone','')) NOT BETWEEN 9 AND 10 OR
    length(coalesce(p_lead->>'email','')) NOT BETWEEN 3 AND 320 OR
    pg_catalog.jsonb_typeof(p_lead->'attribution') IS DISTINCT FROM 'object' OR
    length(coalesce(p_lead->'attribution'->>'pagePath','')) NOT BETWEEN 1 AND 1000
  THEN RAISE EXCEPTION 'landing_lead_invalid'; END IF;

  -- Serialize accepted submissions so idempotency and rate limits remain atomic.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('landing_lead_ingestion', 0));
  SELECT s.lead_id INTO v_existing
  FROM public.landing_lead_submissions s
  WHERE s.submission_key = p_submission_key;
  IF v_existing IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('created', false, 'leadId', v_existing);
  END IF;
  IF (SELECT count(*) FROM public.landing_lead_submissions
      WHERE created_at > now() - interval '1 hour') >= 100 OR
     (SELECT count(*) FROM public.landing_lead_submissions
      WHERE contact_key = p_contact_key AND created_at > now() - interval '1 hour') >= 3
  THEN RETURN pg_catalog.jsonb_build_object('limited', true); END IF;

  INSERT INTO public.leads(full_name, phone, email, company, source_text,
    lead_source, lead_attribution)
  VALUES(p_lead->>'fullName', p_lead->>'phone', p_lead->>'email',
    nullif(p_lead->>'company',''), nullif(p_lead->>'inquiry',''),
    'landing_page', p_lead->'attribution')
  RETURNING id INTO v_lead_id;
  INSERT INTO public.landing_lead_submissions(submission_key, contact_key, form_id, lead_id)
  VALUES(p_submission_key, p_contact_key, p_form_id, v_lead_id);
  RETURN pg_catalog.jsonb_build_object('created', true, 'leadId', v_lead_id);
END;
$$;
REVOKE ALL ON FUNCTION public.ingest_landing_lead(text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_landing_lead(text,text,text,jsonb) TO service_role;

COMMIT;
