-- Customer navigation cancels only an unclaimed WhatsApp handoff. The handoff
-- remains as an audited closed record; an operator-owned handoff is untouched.
ALTER TABLE public.bot_handoffs
  ADD COLUMN customer_cancelled_at TIMESTAMPTZ,
  ADD COLUMN customer_cancel_event_id UUID REFERENCES public.bot_channel_events(id),
  ADD CONSTRAINT bot_handoffs_customer_cancel_identity CHECK (
    (customer_cancelled_at IS NULL AND customer_cancel_event_id IS NULL) OR
    (customer_cancelled_at IS NOT NULL AND customer_cancel_event_id IS NOT NULL
      AND status = 'closed' AND assigned_to IS NULL AND claimed_at IS NULL)
  );

CREATE UNIQUE INDEX bot_handoffs_customer_cancel_event_unique
  ON public.bot_handoffs(customer_cancel_event_id)
  WHERE customer_cancel_event_id IS NOT NULL;

CREATE FUNCTION public.cancel_pending_bot_handoff_for_menu(
  p_conversation_id UUID, p_event_id UUID, p_menu_body TEXT
) RETURNS SETOF public.bot_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_handoff public.bot_handoffs%ROWTYPE;
  v_conversation public.bot_conversations%ROWTYPE;
  v_open_count INTEGER;
  v_now TIMESTAMPTZ;
BEGIN
  -- The webhook must have claimed and persisted this inbound message first.
  IF NOT EXISTS (
    SELECT 1 FROM public.bot_channel_events e
    JOIN public.bot_messages m ON m.trigger_event_id = e.id
    WHERE e.id = p_event_id AND e.processing_status = 'claimed'
      AND e.channel = 'whatsapp' AND e.event_kind = 'message'
      AND m.conversation_id = p_conversation_id
      AND m.direction = 'inbound' AND m.channel = 'whatsapp'
  ) THEN RETURN; END IF;
  IF p_menu_body IS NULL OR length(p_menu_body) NOT BETWEEN 1 AND 4096 THEN
    RAISE EXCEPTION 'invalid_menu_body';
  END IF;

  -- Match the operator claim/close order: handoff, then conversation.
  -- A concurrent claim or a second open handoff makes cancellation fail closed.
  SELECT count(*) INTO v_open_count FROM public.bot_handoffs
    WHERE conversation_id = p_conversation_id AND status IN ('waiting', 'active');
  IF v_open_count <> 1 THEN RETURN; END IF;
  SELECT * INTO v_handoff FROM public.bot_handoffs
    WHERE conversation_id = p_conversation_id AND status IN ('waiting', 'active')
    FOR UPDATE;
  IF NOT FOUND OR v_handoff.status <> 'waiting'
    OR v_handoff.assigned_to IS NOT NULL OR v_handoff.claimed_at IS NOT NULL THEN RETURN; END IF;
  SELECT * INTO v_conversation FROM public.bot_conversations
    WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND OR v_conversation.status <> 'awaiting_human'
    OR v_conversation.channel <> 'whatsapp' THEN RETURN; END IF;
  -- Recheck after locks in case another handoff was opened while waiting.
  SELECT count(*) INTO v_open_count FROM public.bot_handoffs
    WHERE conversation_id = p_conversation_id AND status IN ('waiting', 'active');
  IF v_open_count <> 1 THEN RETURN; END IF;

  v_now := clock_timestamp();
  UPDATE public.bot_handoffs SET status = 'closed', closed_at = v_now,
    customer_cancelled_at = v_now, customer_cancel_event_id = p_event_id,
    updated_at = v_now WHERE id = v_handoff.id;
  UPDATE public.bot_conversations SET status = 'automated', current_state = 'menu.main',
    parent_state = NULL, selected_site = NULL, selected_activity = NULL,
    collected_fields = '{}'::jsonb, expires_at = NULL, last_message_at = v_now,
    updated_at = v_now WHERE id = p_conversation_id;
  RETURN QUERY INSERT INTO public.bot_messages (
    conversation_id, trigger_event_id, channel, direction, message_kind,
    body, response_id, delivery_status, occurred_at
  ) VALUES (
    p_conversation_id, p_event_id, 'whatsapp', 'outbound', 'text',
    p_menu_body, 'navigation.main_menu', 'pending', v_now
  ) RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_pending_bot_handoff_for_menu(UUID,UUID,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_pending_bot_handoff_for_menu(UUID,UUID,TEXT)
  TO service_role;
