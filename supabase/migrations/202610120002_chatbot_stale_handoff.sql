-- Targeted local migration. Apply once, only after review. Preserve handoff history.
ALTER TABLE public.bot_handoffs
  ADD COLUMN auto_released_at TIMESTAMPTZ,
  ADD COLUMN auto_release_event_id UUID REFERENCES public.bot_channel_events(id),
  ADD CONSTRAINT bot_handoffs_auto_release_identity CHECK (
    (auto_released_at IS NULL AND auto_release_event_id IS NULL) OR
    (auto_released_at IS NOT NULL AND auto_release_event_id IS NOT NULL
      AND status = 'closed' AND assigned_to IS NULL AND claimed_at IS NULL)
  );
CREATE UNIQUE INDEX bot_handoffs_auto_release_event_unique
  ON public.bot_handoffs(auto_release_event_id) WHERE auto_release_event_id IS NOT NULL;

CREATE FUNCTION public.release_stale_bot_handoff(
  p_conversation_id UUID, p_event_id UUID, p_reset_body TEXT
) RETURNS SETOF public.bot_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_handoff public.bot_handoffs%ROWTYPE;
  v_conversation public.bot_conversations%ROWTYPE;
  v_now TIMESTAMPTZ;
BEGIN
  -- Require a genuinely claimed WhatsApp event already persisted on this conversation.
  IF NOT EXISTS (
    SELECT 1 FROM public.bot_channel_events e JOIN public.bot_messages m ON m.trigger_event_id=e.id
    WHERE e.id=p_event_id AND e.processing_status='claimed' AND e.channel='whatsapp'
      AND e.event_kind='message' AND m.conversation_id=p_conversation_id
      AND m.direction='inbound' AND m.channel='whatsapp'
  ) THEN RETURN; END IF;
  IF p_reset_body IS NULL OR length(p_reset_body) NOT BETWEEN 1 AND 4096 THEN
    RAISE EXCEPTION 'invalid_reset_body';
  END IF;
  -- Match operator claim/close/resume order: handoff first, then conversation.
  -- Concurrent operator claim wins OR expiry wins; never overwrite human ownership.
  SELECT * INTO v_handoff FROM public.bot_handoffs
    WHERE conversation_id=p_conversation_id AND status IN ('waiting','active')
    FOR UPDATE;
  IF NOT FOUND OR v_handoff.status <> 'waiting'
    OR v_handoff.assigned_to IS NOT NULL OR v_handoff.claimed_at IS NOT NULL THEN RETURN; END IF;
  SELECT * INTO v_conversation FROM public.bot_conversations
    WHERE id=p_conversation_id FOR UPDATE;
  v_now := clock_timestamp(); -- Database clock after lock acquisition; no customer timestamps.
  IF v_conversation.status <> 'awaiting_human' OR v_conversation.channel <> 'whatsapp'
    OR v_handoff.created_at > v_now - INTERVAL '10 minutes' THEN RETURN; END IF;

  UPDATE public.bot_handoffs SET status='closed', closed_at=v_now,
    auto_released_at=v_now, auto_release_event_id=p_event_id WHERE id=v_handoff.id;
  UPDATE public.bot_conversations SET status='automated', current_state='menu.main',
    parent_state=NULL, selected_site=NULL, selected_activity=NULL, collected_fields='{}',
    expires_at=NULL, last_message_at=v_now WHERE id=p_conversation_id;
  -- Persist the single text intent atomically with expiry. Never create an attachment here.
  RETURN QUERY INSERT INTO public.bot_messages (
    conversation_id,trigger_event_id,channel,direction,message_kind,body,response_id,
    delivery_status,occurred_at
  ) VALUES (p_conversation_id,p_event_id,'whatsapp','outbound','text',p_reset_body,
    'handoff.auto_reset','pending',v_now) RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.release_stale_bot_handoff(UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.release_stale_bot_handoff(UUID,UUID,TEXT) TO service_role;
