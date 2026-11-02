-- Production PostgREST preloads safeupdate. Preserve that protection.
-- Only bind updates to the already locked singleton/order/attempt.
-- No gate, row, ACL, role or provider changes. CREATE OR REPLACE preserves grants.
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
  UPDATE public.pelecard_controlled_live_control AS ctl SET payment_id=(result->>'id')::uuid
    WHERE ctl.singleton = c.singleton AND ctl.order_id = c.order_id AND ctl.payment_id IS NULL;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.claim_pelecard_controlled_live_init(p_payment_id UUID)
RETURNS TABLE(amount_minor INTEGER,currency TEXT,order_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.pelecard_controlled_live_control%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.pelecard_controlled_live_control WHERE singleton FOR UPDATE;
  IF NOT c.enabled OR c.payment_id IS DISTINCT FROM p_payment_id OR c.dispatch_started_at IS NOT NULL THEN RETURN; END IF;
  PERFORM 1 FROM public.payment_transactions p JOIN public.orders o ON o.id=p.order_id
    WHERE p.id=p_payment_id AND p.provider='pelecard' AND p.operation='payment'
      AND p.amount=35 AND p.currency='ILS' AND p.status='initiated' AND p.provider_session_id IS NULL
      AND o.id=c.order_id AND o.order_number='ORD-1039' AND o.total_price=35
      AND o.payment_status='לא שולם' AND o.status NOT IN ('שולם','בוטל')
      AND NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.order_id=o.id)
      AND NOT EXISTS(SELECT 1 FROM public.payment_transactions other WHERE other.order_id=o.id AND other.id<>p.id)
    FOR UPDATE OF p,o;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.pelecard_controlled_live_control AS ctl SET dispatch_started_at=clock_timestamp()
    WHERE ctl.singleton = c.singleton AND ctl.order_id = c.order_id AND ctl.payment_id = p_payment_id AND ctl.dispatch_started_at IS NULL;
  RETURN QUERY SELECT 3500,'ILS'::text,c.order_id;
END $$;

CREATE OR REPLACE FUNCTION public.save_pelecard_controlled_live_session(
  p_payment_id UUID,p_transaction_id TEXT,p_confirmation_key TEXT,p_url TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.pelecard_controlled_live_control%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT c FROM public.pelecard_controlled_live_control FOR UPDATE;
  IF c.payment_id IS DISTINCT FROM p_payment_id OR c.dispatch_started_at IS NULL THEN
    RAISE EXCEPTION 'controlled_live_attempt_mismatch' USING ERRCODE='23514';
  END IF;
  IF p_transaction_id IS NULL OR p_transaction_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR p_confirmation_key IS NULL OR length(p_confirmation_key) NOT BETWEEN 1 AND 512 OR p_confirmation_key !~ '^[A-Za-z0-9_+/=-]+$'
    OR p_url IS DISTINCT FROM ('https://gateway20.pelecard.biz/PaymentGW?transactionId='||p_transaction_id) THEN
    RAISE EXCEPTION 'controlled_live_invalid_session' USING ERRCODE='23514';
  END IF;
  IF c.transaction_id IS NOT NULL AND ROW(c.transaction_id,c.confirmation_key) IS DISTINCT FROM ROW(p_transaction_id,p_confirmation_key) THEN
    RAISE EXCEPTION 'controlled_live_session_mismatch' USING ERRCODE='23514';
  END IF;
  UPDATE public.pelecard_controlled_live_control AS ctl SET transaction_id=p_transaction_id,confirmation_key=p_confirmation_key
    WHERE ctl.singleton = c.singleton AND ctl.order_id = c.order_id AND ctl.payment_id = p_payment_id;
  RETURN public.complete_pelecard_initiation(p_payment_id,p_transaction_id,p_url);
END $$;

CREATE OR REPLACE FUNCTION public.persist_pelecard_controlled_live_adapter_session(
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
  UPDATE public.pelecard_controlled_live_control AS ctl SET transaction_id=p_transaction_id,confirmation_key=p_confirmation_key
    WHERE ctl.singleton = c.singleton AND ctl.order_id = c.order_id AND ctl.payment_id = p_payment_id;
  UPDATE public.payment_transactions SET provider_session_id=p_transaction_id,provider_redirect_url=p_url,
    status='pending_provider',failure_code=NULL,failure_message=NULL
    WHERE id=p_payment_id RETURNING * INTO p;
  RETURN to_jsonb(p);
END $$;
COMMIT;
