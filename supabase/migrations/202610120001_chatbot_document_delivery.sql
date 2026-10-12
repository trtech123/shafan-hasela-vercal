-- Local migration only: dedicated private brochures, no financial table changes.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('chatbot-assets', 'chatbot-assets', false, 15728640, ARRAY['application/pdf', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE SET public = false,
  file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- No anon/authenticated Storage policies: only the server service role accesses this bucket.
ALTER TABLE public.bot_messages
  ADD COLUMN asset_id TEXT,
  ADD COLUMN asset_checksum TEXT,
  ADD COLUMN attachment_attempted_at TIMESTAMPTZ,
  ADD CONSTRAINT bot_messages_asset_identity CHECK (
    (asset_id IS NULL AND asset_checksum IS NULL)
    OR (direction = 'outbound' AND channel = 'whatsapp' AND message_kind = 'attachment'
      AND asset_id IS NOT NULL AND asset_checksum IS NOT NULL
      AND asset_checksum ~ '^[a-f0-9]{64}$')
  );

ALTER TABLE public.bot_messages DROP CONSTRAINT bot_messages_delivery_status_check;
ALTER TABLE public.bot_messages ADD CONSTRAINT bot_messages_delivery_status_check
  CHECK (delivery_status IS NULL OR delivery_status IN
    ('pending', 'sending', 'uncertain', 'accepted', 'sent', 'delivered', 'read', 'failed'));

CREATE UNIQUE INDEX bot_attachment_event_asset_unique
  ON public.bot_messages(trigger_event_id, asset_id)
  WHERE direction = 'outbound' AND asset_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_bot_attachment(p_message_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_conversation_id UUID;
  v_status TEXT;
  v_occurred_at TIMESTAMPTZ;
BEGIN
  SELECT conversation_id INTO v_conversation_id FROM public.bot_messages WHERE id = p_message_id;
  IF v_conversation_id IS NULL THEN RETURN 'unavailable'; END IF;
  -- Lock in the same order as the existing staff handoff operations.
  SELECT status INTO v_status FROM public.bot_conversations WHERE id = v_conversation_id FOR UPDATE;
  IF v_status IS DISTINCT FROM 'automated' THEN RETURN 'locked'; END IF;
  SELECT e.occurred_at INTO v_occurred_at
    FROM public.bot_messages m JOIN public.bot_channel_events e ON e.id = m.trigger_event_id
    WHERE m.id = p_message_id AND m.delivery_status = 'pending' AND m.attachment_attempted_at IS NULL;
  IF v_occurred_at <= NOW() - INTERVAL '23 hours' OR v_occurred_at > NOW() + INTERVAL '5 minutes' THEN
    UPDATE public.bot_messages SET delivery_status = 'failed' WHERE id = p_message_id;
    RETURN 'expired';
  END IF;
  UPDATE public.bot_messages m
    SET delivery_status = 'sending', attachment_attempted_at = NOW()
    FROM public.bot_channel_events e
    WHERE m.id = p_message_id AND m.trigger_event_id = e.id
      AND m.direction = 'outbound' AND m.channel = 'whatsapp' AND m.message_kind = 'attachment'
      AND m.asset_id IS NOT NULL AND m.asset_checksum IS NOT NULL
      AND m.delivery_status = 'pending' AND m.attachment_attempted_at IS NULL
      AND e.channel = 'whatsapp' AND e.event_kind = 'message'
      AND e.occurred_at > NOW() - INTERVAL '23 hours'
      AND e.occurred_at <= NOW() + INTERVAL '5 minutes';
  IF FOUND THEN RETURN 'claimed'; END IF;
  RETURN 'unavailable';
END;
$$;
REVOKE ALL ON FUNCTION public.claim_bot_attachment(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_bot_attachment(UUID) TO service_role;

COMMENT ON COLUMN public.bot_messages.attachment_attempted_at IS
  'At-most-once attachment claim. Never clear automatically; sending/uncertain require staff reconciliation.';
