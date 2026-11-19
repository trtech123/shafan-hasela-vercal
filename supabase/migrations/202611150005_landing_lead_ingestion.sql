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
    (p_lead->>'email' IS NOT NULL AND
      length(p_lead->>'email') NOT BETWEEN 3 AND 320) OR
    pg_catalog.jsonb_typeof(p_lead->'attribution') IS DISTINCT FROM 'object' OR
    length(coalesce(p_lead->'attribution'->>'pagePath','')) NOT BETWEEN 1 AND 1000 OR
    length(coalesce(p_lead->'attribution'->>'pageUrl','')) NOT BETWEEN 10 AND 1200
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
    status, lead_source, lead_attribution)
  VALUES(p_lead->>'fullName', p_lead->>'phone', p_lead->>'email',
    nullif(p_lead->>'company',''), nullif(p_lead->>'inquiry',''),
    'פתוח', 'landing_page', p_lead->'attribution')
  RETURNING id INTO v_lead_id;
  INSERT INTO public.landing_lead_submissions(submission_key, contact_key, form_id, lead_id)
  VALUES(p_submission_key, p_contact_key, p_form_id, v_lead_id);
  RETURN pg_catalog.jsonb_build_object('created', true, 'leadId', v_lead_id);
END;
$$;
REVOKE ALL ON FUNCTION public.ingest_landing_lead(text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_landing_lead(text,text,text,jsonb) TO service_role;

-- The optional WhatsApp continuation carries the opaque #SHF reference returned
-- by the webhook. Reuse the landing lead only when that exact reference appears
-- in an inbound message of the same conversation. Other bot handoffs are untouched.
CREATE OR REPLACE FUNCTION public.attach_landing_lead_to_bot_handoff()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_landing_lead_id uuid;
BEGIN
  IF NEW.lead_id IS NULL OR NEW.conversation_id IS NULL THEN RETURN NEW; END IF;
  SELECT s.lead_id INTO v_landing_lead_id
  FROM public.bot_messages m
  JOIN public.landing_lead_submissions s
    ON s.submission_key = pg_catalog.substring(m.body, '#SHF-([a-f0-9]{64})')
  JOIN public.leads l ON l.id = s.lead_id AND l.lead_source = 'landing_page'
  JOIN public.bot_conversations c ON c.id = m.conversation_id
  JOIN public.bot_contacts bc ON bc.id = c.contact_id
  WHERE m.conversation_id = NEW.conversation_id
    AND m.direction = 'inbound'
    AND m.created_at > now() - interval '7 days'
    AND s.created_at > now() - interval '7 days'
    AND (CASE WHEN pg_catalog.regexp_replace(bc.phone, '[^0-9]', '', 'g') LIKE '972%'
          THEN '0' || pg_catalog.substring(pg_catalog.regexp_replace(bc.phone, '[^0-9]', '', 'g'), 4)
          ELSE pg_catalog.regexp_replace(bc.phone, '[^0-9]', '', 'g') END) = l.phone
  ORDER BY m.created_at DESC
  LIMIT 1;
  IF v_landing_lead_id IS NULL OR v_landing_lead_id = NEW.lead_id THEN RETURN NEW; END IF;

  -- create_bot_handoff inserted this lead immediately before inserting the
  -- handoff. Delete only that newly created bot lead, never historical leads.
  DELETE FROM public.leads
  WHERE id = NEW.lead_id AND lead_source IS NULL
    AND notes = 'נוצר אוטומטית מתור העברה של שפן'
    AND created_at > now() - interval '1 minute';
  IF NOT FOUND THEN RETURN NEW; END IF;
  NEW.lead_id := v_landing_lead_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.attach_landing_lead_to_bot_handoff() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS attach_landing_lead_to_bot_handoff ON public.bot_handoffs;
CREATE TRIGGER attach_landing_lead_to_bot_handoff
  BEFORE INSERT ON public.bot_handoffs
  FOR EACH ROW EXECUTE FUNCTION public.attach_landing_lead_to_bot_handoff();


CREATE OR REPLACE FUNCTION public.create_bot_handoff(
  p_conversation_id UUID,
  p_reason TEXT,
  p_priority TEXT,
  p_summary TEXT,
  p_capture JSONB DEFAULT '{}'::JSONB
)
RETURNS TABLE(handoff_id UUID, lead_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_contact public.bot_contacts%ROWTYPE;
  v_conversation public.bot_conversations%ROWTYPE;
  v_name TEXT;
  v_phone TEXT;
  v_email TEXT;
  v_site TEXT;
  v_event_date DATE;
BEGIN
  SELECT c.* INTO v_conversation
  FROM public.bot_conversations c
  WHERE c.id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversation_not_found'; END IF;

  SELECT h.id, h.lead_id INTO handoff_id, lead_id
  FROM public.bot_handoffs h
  WHERE h.conversation_id = p_conversation_id AND h.status IN ('waiting', 'active')
  LIMIT 1;
  IF handoff_id IS NOT NULL THEN RETURN NEXT; RETURN; END IF;

  SELECT c.* INTO v_contact FROM public.bot_contacts c WHERE c.id = v_conversation.contact_id;
  v_name := COALESCE(NULLIF(p_capture->>'name', ''), v_contact.display_name, 'פניית צ׳אטבוט');
  v_phone := COALESCE(NULLIF(p_capture->>'phone', ''), v_contact.phone);
  v_email := COALESCE(NULLIF(p_capture->>'email', ''), v_contact.email);
  v_site := CASE COALESCE(p_capture->>'requested_site', v_conversation.selected_site)
    WHEN 'acre_extreme_park' THEN 'עכו'
    WHEN 'berko_360_tiberias' THEN 'טבריה'
    WHEN 'nof_hagalil_zipline' THEN 'נוף הגליל'
    WHEN 'field_activities' THEN 'שטח'
    WHEN 'via_ferrata' THEN 'ויה פרטה'
    ELSE NULL
  END;
  IF COALESCE(p_capture->>'preferred_date', '') ~ '^\d{4}-\d{2}-\d{2}$' THEN
    v_event_date := (p_capture->>'preferred_date')::DATE;
  END IF;

  INSERT INTO public.leads (full_name, phone, email, company, site, event_date, source_text, notes)
  VALUES (
    v_name,
    v_phone,
    v_email,
    NULLIF(p_capture->>'company', ''),
    v_site,
    v_event_date,
    p_summary,
    'נוצר אוטומטית מתור העברה של שפן'
  )
  RETURNING id INTO lead_id;

  INSERT INTO public.bot_handoffs (
    conversation_id, lead_id, reason, priority, summary, customer_name,
    callback_phone, callback_email, company, requested_site, requested_activity,
    group_size, preferred_date
  ) VALUES (
    p_conversation_id, lead_id, p_reason, p_priority, p_summary, v_name,
    v_phone, v_email, NULLIF(p_capture->>'company', ''),
    COALESCE(NULLIF(p_capture->>'requested_site', ''), v_conversation.selected_site),
    COALESCE(NULLIF(p_capture->>'requested_activity', ''), v_conversation.selected_activity),
    COALESCE(NULLIF(p_capture->>'group_size', ''), NULLIF(p_capture->>'group_size_bucket', '')),
    NULLIF(p_capture->>'preferred_date', '')
  ) RETURNING id INTO handoff_id;

  -- A landing reference may have linked this handoff to the existing lead.
  SELECT h.lead_id INTO lead_id FROM public.bot_handoffs h WHERE h.id = handoff_id;

  UPDATE public.bot_conversations
  SET status = 'awaiting_human', collected_fields = collected_fields || COALESCE(p_capture, '{}'::JSONB)
  WHERE id = p_conversation_id;

  RETURN NEXT;
END;
$$;

COMMIT;
