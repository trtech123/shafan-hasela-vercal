-- No gate changes or attempt resets. Correct production extension-schema assumptions.
BEGIN;
CREATE OR REPLACE FUNCTION public.reserve_pelecard_controlled_live(p_created_by UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.pelecard_controlled_live_control%ROWTYPE; o public.orders%ROWTYPE; result JSONB;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_created_by AND role::text='admin') THEN
    RAISE EXCEPTION 'controlled_live_admin_required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT c FROM public.pelecard_controlled_live_control FOR UPDATE;
  IF NOT c.enabled THEN RAISE EXCEPTION 'controlled_live_disabled' USING ERRCODE='23514'; END IF;
  IF c.payment_id IS NOT NULL THEN
    SELECT to_jsonb(p)||jsonb_build_object('created',false) INTO STRICT result
      FROM public.payment_transactions p WHERE p.id=c.payment_id;
    RETURN result;
  END IF;
  SELECT * INTO o FROM public.orders WHERE id=c.order_id FOR UPDATE;
  IF NOT FOUND OR o.order_number IS DISTINCT FROM 'ORD-1039' OR o.total_price IS DISTINCT FROM 35.00
    OR o.payment_status IS DISTINCT FROM 'לא שולם' OR o.status IN ('שולם','בוטל')
    OR EXISTS(SELECT 1 FROM public.sales WHERE order_id=c.order_id OR linked_order_info->>'order_number'='ORD-1039')
    OR EXISTS(SELECT 1 FROM public.payment_transactions WHERE order_id=c.order_id OR checkout_snapshot->'linked_order_info'->>'order_number'='ORD-1039') THEN
    RAISE EXCEPTION 'controlled_live_order_not_payable' USING ERRCODE='23514';
  END IF;
  result := public.reserve_pelecard_order_payment(pg_catalog.gen_random_uuid(),c.order_id,p_created_by,
    'controlled-live-ORD-1039-v1',35,'ILS','{}'::jsonb);
  UPDATE public.pelecard_controlled_live_control SET payment_id=(result->>'id')::uuid;
  RETURN result;
END $$;
-- Node records the already-claimed provider response before returning it to
-- Edge. Only this narrow role can use the no-JWT adapter entrypoint.
CREATE FUNCTION public.persist_pelecard_controlled_live_adapter_session(
  p_payment_id UUID,p_transaction_id TEXT,p_confirmation_key TEXT,p_url TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.pelecard_controlled_live_control%ROWTYPE; p public.payment_transactions%ROWTYPE;
BEGIN
  SELECT * INTO STRICT c FROM public.pelecard_controlled_live_control FOR UPDATE;
  IF c.payment_id IS DISTINCT FROM p_payment_id OR c.dispatch_started_at IS NULL THEN
    RAISE EXCEPTION 'controlled_live_attempt_mismatch' USING ERRCODE='23514';
  END IF;
  SELECT * INTO STRICT p FROM public.payment_transactions WHERE id=p_payment_id FOR UPDATE;
  IF p.order_id IS DISTINCT FROM c.order_id OR p.amount IS DISTINCT FROM 35::numeric
    OR p.currency IS DISTINCT FROM 'ILS' OR p.provider IS DISTINCT FROM 'pelecard'
    OR p.operation IS DISTINCT FROM 'payment' OR p.status NOT IN ('initiated','pending_provider') THEN
    RAISE EXCEPTION 'controlled_live_attempt_mismatch' USING ERRCODE='23514';
  END IF;
  IF p_transaction_id IS NULL OR p_transaction_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR p_confirmation_key IS NULL OR length(p_confirmation_key) NOT BETWEEN 1 AND 512 OR p_confirmation_key !~ '^[A-Za-z0-9_+/=-]+$'
    OR p_url IS DISTINCT FROM ('https://gateway20.pelecard.biz/PaymentGW?transactionId='||p_transaction_id) THEN
    RAISE EXCEPTION 'controlled_live_invalid_session' USING ERRCODE='23514';
  END IF;
  IF (c.transaction_id IS NOT NULL AND ROW(c.transaction_id,c.confirmation_key) IS DISTINCT FROM ROW(p_transaction_id,p_confirmation_key))
    OR (p.provider_session_id IS NOT NULL AND ROW(p.provider_session_id,p.provider_redirect_url) IS DISTINCT FROM ROW(p_transaction_id,p_url)) THEN
    RAISE EXCEPTION 'controlled_live_session_mismatch' USING ERRCODE='23514';
  END IF;
  IF p.provider_session_id IS NOT NULL THEN RETURN to_jsonb(p); END IF;
  IF p.status <> 'initiated' THEN RAISE EXCEPTION 'controlled_live_attempt_mismatch' USING ERRCODE='23514'; END IF;
  UPDATE public.pelecard_controlled_live_control SET transaction_id=p_transaction_id,confirmation_key=p_confirmation_key;
  UPDATE public.payment_transactions SET provider_session_id=p_transaction_id,provider_redirect_url=p_url,
    status='pending_provider',failure_code=NULL,failure_message=NULL
    WHERE id=p_payment_id RETURNING * INTO p;
  RETURN to_jsonb(p);
END $$;
REVOKE ALL ON FUNCTION public.persist_pelecard_controlled_live_adapter_session(UUID,TEXT,TEXT,TEXT)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.persist_pelecard_controlled_live_adapter_session(UUID,TEXT,TEXT,TEXT)
  TO pelecard_controlled_live_adapter;
COMMENT ON FUNCTION public.persist_pelecard_controlled_live_adapter_session(UUID,TEXT,TEXT,TEXT) IS
  'Persist an already dispatched controlled provider session before HTTP response; no gate enable, new attempt, claim release, finalization or accounting privileges.';
-- The ordinary accounting lease uses the same production-safe core UUID function.
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
      lease_token = pg_catalog.gen_random_uuid(),
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
COMMIT;
