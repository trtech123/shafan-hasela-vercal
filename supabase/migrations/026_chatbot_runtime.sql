-- ============================================================
-- Migration 026: deterministic chatbot runtime and staff handoff queue
-- No provider secrets or raw webhook payloads are stored here.
-- ============================================================

CREATE TABLE public.bot_contacts (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel               TEXT NOT NULL CHECK (channel IN ('whatsapp', 'facebook_messenger', 'instagram_dm', 'email')),
  external_contact_id   TEXT NOT NULL,
  display_name          TEXT,
  phone                 TEXT,
  email                 TEXT,
  verification_source   TEXT NOT NULL,
  verified_at           TIMESTAMPTZ NOT NULL,
  opted_out_at          TIMESTAMPTZ,
  blocked_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel, external_contact_id)
);

CREATE TABLE public.bot_conversations (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id            UUID NOT NULL REFERENCES public.bot_contacts(id) ON DELETE RESTRICT,
  channel               TEXT NOT NULL CHECK (channel IN ('whatsapp', 'facebook_messenger', 'instagram_dm', 'email')),
  thread_id             TEXT NOT NULL,
  content_version       TEXT NOT NULL,
  current_state         TEXT NOT NULL DEFAULT 'start',
  parent_state          TEXT,
  selected_site         TEXT,
  selected_activity     TEXT,
  collected_fields      JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(collected_fields) = 'object'),
  status                TEXT NOT NULL DEFAULT 'automated' CHECK (status IN ('automated', 'awaiting_human', 'human_active', 'resolved', 'closed')),
  last_message_at       TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.bot_messages (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id       UUID NOT NULL REFERENCES public.bot_conversations(id) ON DELETE CASCADE,
  channel               TEXT NOT NULL CHECK (channel IN ('whatsapp', 'facebook_messenger', 'instagram_dm', 'email')),
  provider_message_id   TEXT,
  direction             TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_kind          TEXT NOT NULL CHECK (message_kind IN ('text', 'interactive', 'attachment', 'status', 'staff_reply')),
  body                  TEXT,
  response_id           TEXT,
  delivery_status       TEXT CHECK (delivery_status IS NULL OR delivery_status IN ('pending', 'accepted', 'sent', 'delivered', 'read', 'failed')),
  sanitized_metadata    JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(sanitized_metadata) = 'object'),
  occurred_at           TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.bot_channel_events (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel               TEXT NOT NULL CHECK (channel IN ('whatsapp', 'facebook_messenger', 'instagram_dm', 'email')),
  provider_event_id     TEXT NOT NULL,
  provider_message_id   TEXT,
  event_kind            TEXT NOT NULL CHECK (event_kind IN ('message', 'status', 'verification', 'unsupported')),
  payload_digest        TEXT NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  processing_status     TEXT NOT NULL DEFAULT 'claimed' CHECK (processing_status IN ('claimed', 'completed', 'failed')),
  retry_count           INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  error_code            TEXT,
  sanitized_metadata    JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(sanitized_metadata) = 'object'),
  occurred_at           TIMESTAMPTZ NOT NULL,
  processed_at          TIMESTAMPTZ,
  retry_after           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel, provider_event_id)
);

CREATE TABLE public.bot_handoffs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id       UUID NOT NULL REFERENCES public.bot_conversations(id) ON DELETE RESTRICT,
  lead_id               UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  reason                TEXT NOT NULL,
  priority              TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
  summary               TEXT NOT NULL,
  customer_name         TEXT,
  callback_phone        TEXT,
  callback_email        TEXT,
  company               TEXT,
  requested_site        TEXT,
  requested_activity    TEXT,
  group_size            TEXT,
  preferred_date        TEXT,
  status                TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'resolved', 'closed')),
  assigned_to           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  claimed_at            TIMESTAMPTZ,
  first_human_response_at TIMESTAMPTZ,
  resolved_at           TIMESTAMPTZ,
  closed_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX bot_conversations_one_active
  ON public.bot_conversations(channel, thread_id)
  WHERE status IN ('automated', 'awaiting_human', 'human_active');

CREATE INDEX bot_conversations_contact_idx ON public.bot_conversations(contact_id, last_message_at DESC);

CREATE UNIQUE INDEX bot_messages_provider_message_unique
  ON public.bot_messages(channel, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX bot_messages_conversation_idx ON public.bot_messages(conversation_id, occurred_at, created_at);

CREATE INDEX bot_channel_events_retry_idx
  ON public.bot_channel_events(retry_after, created_at)
  WHERE processing_status = 'failed';

CREATE INDEX bot_handoffs_queue_idx
  ON public.bot_handoffs(status, priority, created_at, assigned_to)
  WHERE status IN ('waiting', 'active');

CREATE UNIQUE INDEX bot_handoffs_one_open_per_conversation
  ON public.bot_handoffs(conversation_id)
  WHERE status IN ('waiting', 'active');

CREATE TRIGGER trg_bot_contacts_updated_at
  BEFORE UPDATE ON public.bot_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_bot_conversations_updated_at
  BEFORE UPDATE ON public.bot_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_bot_channel_events_updated_at
  BEFORE UPDATE ON public.bot_channel_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_bot_handoffs_updated_at
  BEFORE UPDATE ON public.bot_handoffs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.bot_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_channel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_handoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bot contacts: admin/ops read"
  ON public.bot_contacts FOR SELECT USING (public.is_admin_or_ops());
CREATE POLICY "bot conversations: admin/ops read"
  ON public.bot_conversations FOR SELECT USING (public.is_admin_or_ops());
CREATE POLICY "bot messages: admin/ops read"
  ON public.bot_messages FOR SELECT USING (public.is_admin_or_ops());
CREATE POLICY "bot events: admin/ops read"
  ON public.bot_channel_events FOR SELECT USING (public.is_admin_or_ops());
CREATE POLICY "bot handoffs: admin/ops read"
  ON public.bot_handoffs FOR SELECT USING (public.is_admin_or_ops());

REVOKE ALL ON public.bot_contacts, public.bot_conversations, public.bot_messages, public.bot_channel_events, public.bot_handoffs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bot_contacts, public.bot_conversations, public.bot_messages, public.bot_channel_events, public.bot_handoffs TO authenticated;
GRANT ALL ON public.bot_contacts, public.bot_conversations, public.bot_messages, public.bot_channel_events, public.bot_handoffs TO service_role;

CREATE OR REPLACE FUNCTION public.claim_bot_channel_event(
  p_channel TEXT,
  p_provider_event_id TEXT,
  p_provider_message_id TEXT,
  p_event_kind TEXT,
  p_payload_digest TEXT,
  p_occurred_at TIMESTAMPTZ,
  p_sanitized_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS TABLE(event_id UUID, claimed BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id UUID := uuid_generate_v4();
BEGIN
  INSERT INTO public.bot_channel_events (
    id, channel, provider_event_id, provider_message_id, event_kind,
    payload_digest, occurred_at, sanitized_metadata
  ) VALUES (
    v_event_id, p_channel, p_provider_event_id, p_provider_message_id, p_event_kind,
    p_payload_digest, p_occurred_at, COALESCE(p_sanitized_metadata, '{}'::JSONB)
  )
  ON CONFLICT (channel, provider_event_id) DO NOTHING
  RETURNING id INTO event_id;

  IF event_id IS NULL THEN
    SELECT e.id INTO event_id
    FROM public.bot_channel_events e
    WHERE e.channel = p_channel AND e.provider_event_id = p_provider_event_id;
    claimed := FALSE;
  ELSE
    claimed := TRUE;
  END IF;
  RETURN NEXT;
END;
$$;

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

  UPDATE public.bot_conversations
  SET status = 'awaiting_human', collected_fields = collected_fields || COALESCE(p_capture, '{}'::JSONB)
  WHERE id = p_conversation_id;

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_bot_handoff(p_handoff_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conversation_id UUID;
BEGIN
  IF NOT public.is_admin_or_ops() THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.bot_handoffs
  SET status = 'active', assigned_to = auth.uid(), claimed_at = NOW()
  WHERE id = p_handoff_id AND status = 'waiting' AND assigned_to IS NULL
  RETURNING conversation_id INTO v_conversation_id;
  IF v_conversation_id IS NULL THEN RETURN FALSE; END IF;
  UPDATE public.bot_conversations SET status = 'human_active' WHERE id = v_conversation_id;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.resume_bot_conversation(p_handoff_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conversation_id UUID;
BEGIN
  IF NOT public.is_admin_or_ops() THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.bot_handoffs
  SET status = 'resolved', resolved_at = NOW()
  WHERE id = p_handoff_id AND status = 'active'
    AND (assigned_to = auth.uid() OR public.is_admin())
  RETURNING conversation_id INTO v_conversation_id;
  IF v_conversation_id IS NULL THEN RETURN FALSE; END IF;
  UPDATE public.bot_conversations
  SET status = 'automated', current_state = 'menu.main', parent_state = NULL
  WHERE id = v_conversation_id;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_bot_handoff(p_handoff_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conversation_id UUID;
BEGIN
  IF NOT public.is_admin_or_ops() THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.bot_handoffs SET status = 'resolved', resolved_at = NOW()
  WHERE id = p_handoff_id AND status IN ('waiting', 'active')
    AND (assigned_to IS NULL OR assigned_to = auth.uid() OR public.is_admin())
  RETURNING conversation_id INTO v_conversation_id;
  IF v_conversation_id IS NULL THEN RETURN FALSE; END IF;
  UPDATE public.bot_conversations SET status = 'resolved' WHERE id = v_conversation_id;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_bot_handoff(p_handoff_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conversation_id UUID;
BEGIN
  IF NOT public.is_admin_or_ops() THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.bot_handoffs SET status = 'closed', closed_at = NOW()
  WHERE id = p_handoff_id AND status IN ('waiting', 'active', 'resolved')
    AND (assigned_to IS NULL OR assigned_to = auth.uid() OR public.is_admin())
  RETURNING conversation_id INTO v_conversation_id;
  IF v_conversation_id IS NULL THEN RETURN FALSE; END IF;
  UPDATE public.bot_conversations SET status = 'closed' WHERE id = v_conversation_id;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_bot_channel_event(TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_bot_handoff(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_bot_channel_event(TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_bot_handoff(UUID, TEXT, TEXT, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.claim_bot_handoff(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resume_bot_conversation(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_bot_handoff(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_bot_handoff(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_bot_handoff(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_bot_conversation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_bot_handoff(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_bot_handoff(UUID) TO authenticated;
