-- Apply only with a reviewed chatbot release. Customer inactivity uses database time,
-- never provider timestamps or outbound/staff activity.
ALTER TABLE public.bot_conversations ADD COLUMN last_customer_inbound_at TIMESTAMPTZ;

UPDATE public.bot_conversations c SET last_customer_inbound_at = COALESCE(
  (SELECT max(m.created_at) FROM public.bot_messages m
   WHERE m.conversation_id = c.id AND m.direction = 'inbound'),
  c.created_at
);

ALTER TABLE public.bot_conversations ALTER COLUMN last_customer_inbound_at SET DEFAULT now();
ALTER TABLE public.bot_conversations ALTER COLUMN last_customer_inbound_at SET NOT NULL;

CREATE FUNCTION public.prepare_bot_whatsapp_inbound(
  p_contact_id UUID, p_thread_id TEXT, p_content_version TEXT, p_event_id UUID,
  p_provider_message_id TEXT, p_message_kind TEXT, p_body TEXT,
  p_occurred_at TIMESTAMPTZ, p_sanitized_metadata JSONB, p_reset_body TEXT
) RETURNS TABLE (
  conversation_id UUID, conversation_status TEXT, current_state TEXT,
  parent_state TEXT, selected_site TEXT, selected_activity TEXT,
  collected_fields JSONB, reset_message_id UUID, reset_body TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_conversation public.bot_conversations%ROWTYPE;
  v_now TIMESTAMPTZ;
BEGIN
  IF p_contact_id IS NULL OR p_thread_id IS NULL OR p_thread_id = ''
    OR p_content_version IS NULL OR p_content_version = ''
    OR p_reset_body IS NULL OR length(p_reset_body) NOT BETWEEN 1 AND 4096
    OR p_message_kind IS NULL OR p_message_kind NOT IN ('text', 'interactive', 'attachment')
    OR p_sanitized_metadata IS NULL OR jsonb_typeof(p_sanitized_metadata) <> 'object'
  THEN RAISE EXCEPTION 'invalid_bot_inbound'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.bot_channel_events e
    WHERE e.id = p_event_id AND e.channel = 'whatsapp'
      AND e.event_kind = 'message' AND e.processing_status = 'claimed'
  ) THEN RAISE EXCEPTION 'unclaimed_bot_inbound'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.bot_contacts c WHERE c.id = p_contact_id
      AND c.channel = 'whatsapp' AND c.external_contact_id = p_thread_id
  ) THEN RAISE EXCEPTION 'invalid_bot_contact'; END IF;

  -- Serialize every inbound for this thread before testing the active conversation.
  PERFORM pg_advisory_xact_lock(hashtextextended('bot:whatsapp:' || p_thread_id, 0));
  SELECT * INTO v_conversation FROM public.bot_conversations c
    WHERE c.channel = 'whatsapp' AND c.thread_id = p_thread_id
      AND c.status IN ('automated', 'awaiting_human', 'human_active')
    FOR UPDATE;
  v_now := clock_timestamp();
  IF v_conversation.id IS NOT NULL AND v_conversation.contact_id <> p_contact_id THEN
    RAISE EXCEPTION 'bot_contact_mismatch';
  END IF;

  IF FOUND AND v_conversation.status = 'automated'
    AND v_conversation.last_customer_inbound_at <= v_now - INTERVAL '24 hours' THEN
    UPDATE public.bot_conversations SET status = 'closed', expires_at = v_now
      WHERE id = v_conversation.id;
    v_conversation.id := NULL;
    reset_body := p_reset_body;
  END IF;

  IF v_conversation.id IS NULL THEN
    INSERT INTO public.bot_conversations (
      contact_id, channel, thread_id, content_version, last_message_at,
      last_customer_inbound_at, current_state
    ) VALUES (
      p_contact_id, 'whatsapp', p_thread_id, p_content_version, v_now,
      v_now, CASE WHEN reset_body IS NULL THEN 'start' ELSE 'menu.main' END
    ) RETURNING * INTO v_conversation;
  ELSE
    UPDATE public.bot_conversations SET last_customer_inbound_at = v_now
      WHERE id = v_conversation.id;
  END IF;

  INSERT INTO public.bot_messages (
    conversation_id, trigger_event_id, channel, provider_message_id,
    direction, message_kind, body, sanitized_metadata, occurred_at
  ) VALUES (
    v_conversation.id, p_event_id, 'whatsapp', p_provider_message_id,
    'inbound', p_message_kind, p_body, p_sanitized_metadata, p_occurred_at
  );

  IF reset_body IS NOT NULL THEN
    INSERT INTO public.bot_messages (
      conversation_id, trigger_event_id, channel, direction, message_kind,
      body, response_id, delivery_status, occurred_at
    ) VALUES (
      v_conversation.id, p_event_id, 'whatsapp', 'outbound', 'text',
      reset_body, 'conversation.inactivity_reset', 'pending', v_now
    ) RETURNING id INTO reset_message_id;
  END IF;

  conversation_id := v_conversation.id;
  conversation_status := v_conversation.status;
  current_state := v_conversation.current_state;
  parent_state := v_conversation.parent_state;
  selected_site := v_conversation.selected_site;
  selected_activity := v_conversation.selected_activity;
  collected_fields := v_conversation.collected_fields;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_bot_whatsapp_inbound(
  UUID,TEXT,TEXT,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ,JSONB,TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_bot_whatsapp_inbound(
  UUID,TEXT,TEXT,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ,JSONB,TEXT
) TO service_role;
