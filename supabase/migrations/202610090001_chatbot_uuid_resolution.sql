-- Resolve the existing UUID extension explicitly without widening search_path.
-- CREATE OR REPLACE preserves the existing owner and EXECUTE grants.
-- No bot/business rows, defaults, triggers or other functions are changed.
BEGIN;

CREATE OR REPLACE FUNCTION public.claim_bot_channel_event(
  p_channel TEXT,
  p_provider_event_id TEXT,
  p_provider_message_id TEXT,
  p_event_kind TEXT,
  p_payload_digest TEXT,
  p_occurred_at TIMESTAMPTZ,
  p_sanitized_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS TABLE(event_id UUID, claimed BOOLEAN, resumed BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id UUID := extensions.uuid_generate_v4();
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

  IF event_id IS NOT NULL THEN
    claimed := TRUE;
    resumed := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.bot_channel_events
  SET processing_status = 'claimed', retry_count = retry_count + 1,
      error_code = NULL, retry_after = NULL
  WHERE channel = p_channel AND provider_event_id = p_provider_event_id
    AND processing_status = 'failed'
    AND error_code = 'send_failed'
    AND (retry_after IS NULL OR retry_after <= NOW())
  RETURNING id INTO event_id;

  IF event_id IS NOT NULL THEN
    claimed := TRUE;
    resumed := TRUE;
  ELSE
    SELECT e.id INTO event_id
    FROM public.bot_channel_events e
    WHERE e.channel = p_channel AND e.provider_event_id = p_provider_event_id;
    claimed := FALSE;
    resumed := FALSE;
  END IF;
  RETURN NEXT;
END;
$$;

COMMIT;
