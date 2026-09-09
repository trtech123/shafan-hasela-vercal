-- ============================================================
-- Migration 027: durable payment accounting orchestration
--
-- Additive only. Existing successful payments are deliberately not backfilled.
-- Accounting state can fail independently and never mutates payment, sale, or
-- order success. The semantic purpose is mapped to a numeric document type by
-- provider configuration outside this migration.
-- ============================================================

CREATE OR REPLACE FUNCTION public.accounting_event_error_is_safe(payload JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT jsonb_typeof(payload) = 'object'
    AND octet_length(payload::TEXT) <= 4096
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_object_keys(payload) AS keys(key_name)
      WHERE key_name <> ALL (ARRAY[
        'message', 'errorCode', 'httpStatus', 'clientMessage', 'debugMessage',
        'code', 'providerCode', 'retryable', 'reconciliationRequired'
      ]::TEXT[])
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_each(payload) AS fields(key_name, field_value)
      WHERE jsonb_typeof(field_value) NOT IN ('string', 'number', 'boolean', 'null')
         OR length(field_value #>> '{}') > 1000
    )
$$;

REVOKE ALL ON FUNCTION public.accounting_event_error_is_safe(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.accounting_events (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_type          TEXT NOT NULL CHECK (
    source_type = btrim(source_type) AND length(source_type) BETWEEN 1 AND 50
  ),
  source_id            TEXT NOT NULL CHECK (
    source_id = btrim(source_id) AND length(source_id) BETWEEN 1 AND 200
  ),
  purpose              TEXT NOT NULL CHECK (
    purpose = btrim(purpose) AND length(purpose) BETWEEN 1 AND 100
  ),
  accounting_provider  TEXT NOT NULL CHECK (
    accounting_provider = btrim(accounting_provider)
    AND length(accounting_provider) BETWEEN 1 AND 50
  ),
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'processing',
    'succeeded',
    'retryable_error',
    'permanent_error',
    'reconciliation_required',
    'configuration_required'
  )),
  attempt_count        INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  worker_id            TEXT CHECK (
    worker_id IS NULL OR (
      worker_id = btrim(worker_id) AND length(worker_id) BETWEEN 1 AND 200
    )
  ),
  lease_token          UUID,
  lease_expires_at     TIMESTAMPTZ,
  last_attempt_at      TIMESTAMPTZ,
  next_attempt_at      TIMESTAMPTZ,
  last_error           JSONB CHECK (
    last_error IS NULL OR public.accounting_event_error_is_safe(last_error)
  ),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_type, source_id, purpose, accounting_provider),
  CONSTRAINT accounting_events_lease_shape CHECK (
    (status = 'processing'
      AND worker_id IS NOT NULL
      AND lease_token IS NOT NULL
      AND lease_expires_at IS NOT NULL)
    OR
    (status <> 'processing'
      AND worker_id IS NULL
      AND lease_token IS NULL
      AND lease_expires_at IS NULL)
  ),
  CONSTRAINT accounting_events_retry_shape CHECK (
    (status = 'retryable_error' AND next_attempt_at IS NOT NULL)
    OR (status <> 'retryable_error' AND next_attempt_at IS NULL)
  )
);

CREATE INDEX idx_accounting_events_claim
  ON public.accounting_events(status, next_attempt_at, lease_expires_at, created_at)
  WHERE status IN ('pending', 'processing', 'retryable_error', 'configuration_required');

CREATE INDEX idx_accounting_events_source
  ON public.accounting_events(source_type, source_id);

CREATE INDEX idx_accounting_events_updated_at
  ON public.accounting_events(updated_at DESC);

CREATE TRIGGER trg_accounting_events_updated_at
  BEFORE UPDATE ON public.accounting_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.accounting_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accounting events: admin/ops read"
  ON public.accounting_events FOR SELECT
  USING (public.is_admin_or_ops());

REVOKE ALL ON public.accounting_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.accounting_events TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enqueue_verified_pelecard_accounting_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.provider = 'pelecard'
     AND NEW.operation = 'payment'
     AND NEW.status = 'succeeded'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'succeeded')
     AND NEW.verified_at IS NOT NULL
     AND NEW.provider_transaction_id IS NOT NULL
     AND NEW.sale_id IS NOT NULL THEN
    INSERT INTO public.accounting_events (
      source_type,
      source_id,
      purpose,
      accounting_provider,
      status
    ) VALUES (
      'payment_transaction',
      NEW.id::TEXT,
      'payment_success',
      'rivhit',
      'pending'
    )
    ON CONFLICT (source_type, source_id, purpose, accounting_provider) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_verified_pelecard_accounting_event()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_payment_transactions_accounting_event
  AFTER INSERT OR UPDATE OF status ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_verified_pelecard_accounting_event();

CREATE OR REPLACE FUNCTION public.claim_accounting_event(
  p_event_id UUID,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 300,
  p_force_retry BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id UUID,
  source_type TEXT,
  source_id TEXT,
  purpose TEXT,
  accounting_provider TEXT,
  status TEXT,
  claimed BOOLEAN,
  attempt_count INTEGER,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  last_error JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event public.accounting_events%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_worker_id IS NULL
     OR length(btrim(p_worker_id)) NOT BETWEEN 1 AND 200
     OR p_lease_seconds IS NULL
     OR p_lease_seconds NOT BETWEEN 30 AND 3600 THEN
    RAISE EXCEPTION 'invalid accounting event lease request' USING ERRCODE = '22023';
  END IF;

  SELECT ae.*
  INTO v_event
  FROM public.accounting_events AS ae
  WHERE ae.id = p_event_id
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      p_event_id, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT,
      FALSE, NULL::INTEGER, NULL::UUID, NULL::TIMESTAMPTZ,
      NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::JSONB;
    RETURN;
  END IF;

  IF NOT (
    v_event.status = 'pending'
    OR (v_event.status = 'retryable_error' AND v_event.next_attempt_at <= NOW())
    OR (v_event.status = 'configuration_required' AND p_force_retry)
    OR (v_event.status = 'processing' AND v_event.lease_expires_at <= NOW())
  ) THEN
    RETURN QUERY SELECT
      v_event.id, v_event.source_type, v_event.source_id, v_event.purpose,
      v_event.accounting_provider, v_event.status, FALSE,
      v_event.attempt_count, v_event.lease_token, v_event.lease_expires_at,
      v_event.last_attempt_at, v_event.next_attempt_at, v_event.last_error;
    RETURN;
  END IF;

  UPDATE public.accounting_events AS ae
  SET status = 'processing',
      attempt_count = ae.attempt_count + 1,
      worker_id = btrim(p_worker_id),
      lease_token = public.uuid_generate_v4(),
      lease_expires_at = NOW() + make_interval(secs => p_lease_seconds),
      last_attempt_at = NOW(),
      next_attempt_at = NULL,
      last_error = NULL
  WHERE ae.id = v_event.id
  RETURNING ae.* INTO v_event;

  RETURN QUERY SELECT
    v_event.id, v_event.source_type, v_event.source_id, v_event.purpose,
    v_event.accounting_provider, v_event.status, TRUE,
    v_event.attempt_count, v_event.lease_token, v_event.lease_expires_at,
    v_event.last_attempt_at, v_event.next_attempt_at, v_event.last_error;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_accounting_event(
  p_event_id UUID,
  p_attempt_count INTEGER,
  p_lease_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.accounting_events
  SET status = 'succeeded',
      worker_id = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      next_attempt_at = NULL,
      last_error = NULL
  WHERE id = p_event_id
    AND attempt_count = p_attempt_count
    AND lease_token = p_lease_token
    AND status = 'processing';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_accounting_event(
  p_event_id UUID,
  p_attempt_count INTEGER,
  p_lease_token UUID,
  p_status TEXT,
  p_next_attempt_at TIMESTAMPTZ,
  p_last_error JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL
     OR p_status NOT IN ('retryable_error', 'permanent_error', 'reconciliation_required', 'configuration_required') THEN
    RAISE EXCEPTION 'invalid accounting event failure status' USING ERRCODE = '22023';
  END IF;
  IF p_last_error IS NULL OR NOT public.accounting_event_error_is_safe(p_last_error) THEN
    RAISE EXCEPTION 'accounting event error must be sanitized' USING ERRCODE = '22023';
  END IF;

  UPDATE public.accounting_events
  SET status = p_status,
      worker_id = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      next_attempt_at = CASE
        WHEN p_status = 'retryable_error' THEN GREATEST(
          COALESCE(p_next_attempt_at, NOW() + INTERVAL '1 minute'),
          NOW() + INTERVAL '1 second'
        )
        ELSE NULL
      END,
      last_error = p_last_error
  WHERE id = p_event_id
    AND attempt_count = p_attempt_count
    AND lease_token = p_lease_token
    AND status = 'processing';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_accounting_event(UUID, TEXT, INTEGER, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_accounting_event(UUID, TEXT, INTEGER, BOOLEAN)
  TO service_role;

REVOKE ALL ON FUNCTION public.complete_accounting_event(UUID, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_accounting_event(UUID, INTEGER, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.fail_accounting_event(UUID, INTEGER, UUID, TEXT, TIMESTAMPTZ, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fail_accounting_event(UUID, INTEGER, UUID, TEXT, TIMESTAMPTZ, JSONB)
  TO service_role;

CREATE VIEW public.payment_accounting_operations
WITH (security_invoker = true)
AS
SELECT
  ae.id AS event_id,
  ae.source_type,
  ae.source_id,
  ae.purpose,
  ae.accounting_provider,
  p.id AS payment_transaction_id,
  p.provider_transaction_id,
  p.order_id,
  o.order_number,
  p.sale_id,
  s.receipt_number AS local_receipt_number,
  p.amount,
  p.currency,
  p.status AS payment_status,
  p.verified_at AS payment_succeeded_at,
  ae.status AS accounting_status,
  ad.id AS accounting_document_id,
  ad.status AS accounting_document_status,
  ad.external_document_number,
  ad.document_url,
  ae.attempt_count,
  ae.last_attempt_at,
  ae.last_error,
  ae.next_attempt_at,
  (ae.status = 'reconciliation_required') AS reconciliation_required,
  CASE
    WHEN ae.status = 'pending' THEN TRUE
    WHEN ae.status = 'retryable_error' AND ae.next_attempt_at <= NOW() THEN TRUE
    WHEN ae.status = 'configuration_required' THEN TRUE
    WHEN ae.status = 'processing' AND ae.lease_expires_at <= NOW() THEN TRUE
    ELSE FALSE
  END AS retry_allowed,
  ae.created_at,
  ae.updated_at
FROM public.accounting_events AS ae
LEFT JOIN public.payment_transactions AS p
  ON ae.source_type = 'payment_transaction'
 AND p.id::TEXT = ae.source_id
LEFT JOIN public.orders AS o ON o.id = p.order_id
LEFT JOIN public.sales AS s ON s.id = p.sale_id
LEFT JOIN LATERAL (
  SELECT d.*
  FROM public.accounting_documents AS d
  WHERE d.provider = ae.accounting_provider
    AND d.source_type = ae.source_type
    AND d.source_id = ae.source_id
    AND d.document_type_key = ae.purpose
  ORDER BY d.updated_at DESC, d.id
  LIMIT 1
) AS ad ON TRUE;

REVOKE ALL ON public.payment_accounting_operations
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.payment_accounting_operations TO authenticated, service_role;

COMMENT ON TABLE public.accounting_events IS
  'Provider-neutral durable accounting outbox. Payment success is authoritative and independent of accounting lifecycle.';
COMMENT ON COLUMN public.accounting_events.purpose IS
  'Semantic accounting mapping key such as payment_success; never a provider numeric document type.';
COMMENT ON VIEW public.payment_accounting_operations IS
  'Read-only admin/operations payment accounting status, document result, retry eligibility, and reconciliation state.';
