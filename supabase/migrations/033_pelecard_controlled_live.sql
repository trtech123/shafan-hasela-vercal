-- Deploy disabled. Enabling requires separate explicit approval.
-- Exactly one commercial ORD-1039 attempt. This migration NEVER enables it.
BEGIN;
CREATE TABLE public.pelecard_controlled_live_control (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled BOOLEAN NOT NULL DEFAULT false,
  order_id UUID NOT NULL DEFAULT 'a57ebbc6-47a9-4e74-9208-3340f8508df7'
    CHECK (order_id='a57ebbc6-47a9-4e74-9208-3340f8508df7'),
  payment_id UUID UNIQUE REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
  dispatch_started_at TIMESTAMPTZ,
  transaction_id TEXT,
  confirmation_key TEXT,
  CHECK (dispatch_started_at IS NULL OR payment_id IS NOT NULL),
  CHECK ((transaction_id IS NULL AND confirmation_key IS NULL) OR
    (dispatch_started_at IS NOT NULL AND transaction_id IS NOT NULL AND confirmation_key IS NOT NULL))
);
INSERT INTO public.pelecard_controlled_live_control(singleton) VALUES (true);
ALTER TABLE public.pelecard_controlled_live_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pelecard_controlled_live_control FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pelecard_controlled_live_control FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.guard_pelecard_controlled_live_control() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'controlled_live_identity_immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.singleton IS DISTINCT FROM OLD.singleton OR NEW.order_id IS DISTINCT FROM OLD.order_id
    OR (OLD.payment_id IS NOT NULL AND NEW.payment_id IS DISTINCT FROM OLD.payment_id)
    OR (OLD.dispatch_started_at IS NOT NULL AND NEW.dispatch_started_at IS DISTINCT FROM OLD.dispatch_started_at)
    OR (OLD.transaction_id IS NOT NULL AND ROW(NEW.transaction_id,NEW.confirmation_key)
      IS DISTINCT FROM ROW(OLD.transaction_id,OLD.confirmation_key)) THEN
    RAISE EXCEPTION 'controlled_live_identity_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_controlled_live_control BEFORE UPDATE OR DELETE ON public.pelecard_controlled_live_control
FOR EACH ROW EXECUTE FUNCTION public.guard_pelecard_controlled_live_control();

CREATE FUNCTION public.reserve_pelecard_controlled_live(p_created_by UUID) RETURNS JSONB
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
  result := public.reserve_pelecard_order_payment(public.uuid_generate_v4(),c.order_id,p_created_by,
    'controlled-live-ORD-1039-v1',35,'ILS','{}'::jsonb);
  UPDATE public.pelecard_controlled_live_control SET payment_id=(result->>'id')::uuid;
  RETURN result;
END $$;

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pelecard_controlled_live_adapter') THEN
    CREATE ROLE pelecard_controlled_live_adapter NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO pelecard_controlled_live_adapter;
CREATE FUNCTION public.claim_pelecard_controlled_live_init(p_payment_id UUID)
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
  UPDATE public.pelecard_controlled_live_control SET dispatch_started_at=clock_timestamp();
  RETURN QUERY SELECT 3500,'ILS'::text,c.order_id;
END $$;

CREATE FUNCTION public.get_pelecard_controlled_live_attempt(p_payment_id UUID)
RETURNS TABLE(payment_id UUID,order_id UUID,amount_minor INTEGER,currency TEXT,transaction_id TEXT,confirmation_key TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT p.id,p.order_id,3500,p.currency,c.transaction_id,c.confirmation_key
  FROM public.pelecard_controlled_live_control c JOIN public.payment_transactions p ON p.id=c.payment_id
  WHERE p.id=p_payment_id AND p.order_id=c.order_id AND p.provider='pelecard' AND p.operation='payment'
    AND p.amount=35 AND p.currency='ILS' AND c.transaction_id IS NOT NULL AND c.confirmation_key IS NOT NULL
    AND c.dispatch_started_at IS NOT NULL;
$$;

CREATE FUNCTION public.save_pelecard_controlled_live_session(
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
  UPDATE public.pelecard_controlled_live_control SET transaction_id=p_transaction_id,confirmation_key=p_confirmation_key;
  RETURN public.complete_pelecard_initiation(p_payment_id,p_transaction_id,p_url);
END $$;

CREATE FUNCTION public.finalize_pelecard_controlled_live(
  p_payment_id UUID,p_provider_transaction_id TEXT,p_approval_id TEXT,p_provider_status_code TEXT,p_amount NUMERIC,p_currency TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.pelecard_controlled_live_control%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT c FROM public.pelecard_controlled_live_control FOR UPDATE;
  IF c.payment_id IS DISTINCT FROM p_payment_id OR c.transaction_id IS NULL
    OR c.transaction_id IS DISTINCT FROM p_provider_transaction_id OR c.dispatch_started_at IS NULL
    OR p_provider_status_code IS DISTINCT FROM '000' OR p_amount IS DISTINCT FROM 35::numeric OR p_currency IS DISTINCT FROM 'ILS' THEN
    RAISE EXCEPTION 'controlled_live_verification_mismatch' USING ERRCODE='23514';
  END IF;
  RETURN public.finalize_pelecard_payment(p_payment_id,p_provider_transaction_id,p_approval_id,p_provider_status_code,p_amount,p_currency);
END $$;

-- This guard also covers generic service-role RPCs and direct writes.
CREATE FUNCTION public.guard_pelecard_controlled_live_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.pelecard_controlled_live_control%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.order_id='a57ebbc6-47a9-4e74-9208-3340f8508df7' THEN
      -- Shares the same serialization point as the existing order reservation.
      PERFORM 1 FROM public.orders WHERE id=NEW.order_id FOR UPDATE;
      IF EXISTS(SELECT 1 FROM public.pelecard_controlled_live_control WHERE payment_id IS NOT NULL AND payment_id<>NEW.id) THEN
        RAISE EXCEPTION 'controlled_live_attempt_already_reserved' USING ERRCODE='23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO c FROM public.pelecard_controlled_live_control WHERE payment_id=OLD.id;
  IF NOT FOUND THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'controlled_live_payment_immutable' USING ERRCODE='23514'; END IF;
  IF ROW(NEW.id,NEW.order_id,NEW.amount,NEW.currency,NEW.checkout_snapshot,NEW.created_by,NEW.provider,NEW.operation,NEW.idempotency_key)
    IS DISTINCT FROM ROW(OLD.id,OLD.order_id,OLD.amount,OLD.currency,OLD.checkout_snapshot,OLD.created_by,OLD.provider,OLD.operation,OLD.idempotency_key) THEN
    RAISE EXCEPTION 'controlled_live_payment_immutable' USING ERRCODE='23514';
  END IF;
  IF (NEW.provider_session_id IS NOT NULL AND NEW.provider_session_id IS DISTINCT FROM c.transaction_id)
    OR (NEW.status='succeeded' AND (c.transaction_id IS NULL OR NEW.provider_transaction_id IS DISTINCT FROM c.transaction_id
      OR NEW.provider_status_code IS DISTINCT FROM '000' OR c.dispatch_started_at IS NULL)) THEN
    RAISE EXCEPTION 'controlled_live_verification_mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_controlled_live_payment BEFORE INSERT OR UPDATE OR DELETE ON public.payment_transactions
FOR EACH ROW EXECUTE FUNCTION public.guard_pelecard_controlled_live_payment();

-- Permanent hold is independent of the enabled switch and payment status.
-- Source IDs are checked irrespective of source_type so aliases cannot bypass it.
CREATE FUNCTION public.is_pelecard_controlled_live_accounting_held(p_source_id TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.pelecard_controlled_live_control c
    LEFT JOIN public.payment_transactions p ON p.id=c.payment_id
    WHERE c.payment_id IS NOT NULL AND lower(p_source_id) IN (c.payment_id::text,c.order_id::text,p.sale_id::text))
    OR EXISTS(SELECT 1 FROM public.sales s JOIN public.pelecard_controlled_live_control c ON s.order_id=c.order_id
      WHERE c.payment_id IS NOT NULL AND s.id::text=lower(p_source_id));
$$;
CREATE FUNCTION public.guard_pelecard_controlled_live_accounting() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF public.is_pelecard_controlled_live_accounting_held(NEW.source_id)
    OR (TG_OP='UPDATE' AND public.is_pelecard_controlled_live_accounting_held(OLD.source_id)) THEN
    -- The outbox trigger must not roll back successful commercial finalization.
    IF TG_TABLE_NAME='accounting_events' AND TG_OP='INSERT' THEN RETURN NULL; END IF;
    RAISE EXCEPTION 'controlled_live_accounting_hold' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_controlled_live_accounting_event BEFORE INSERT OR UPDATE ON public.accounting_events
FOR EACH ROW EXECUTE FUNCTION public.guard_pelecard_controlled_live_accounting();
CREATE TRIGGER guard_controlled_live_accounting_document BEFORE INSERT OR UPDATE ON public.accounting_documents
FOR EACH ROW EXECUTE FUNCTION public.guard_pelecard_controlled_live_accounting();

REVOKE ALL ON FUNCTION public.guard_pelecard_controlled_live_control(),public.guard_pelecard_controlled_live_payment(),
  public.guard_pelecard_controlled_live_accounting(),public.is_pelecard_controlled_live_accounting_held(TEXT),
  public.reserve_pelecard_controlled_live(UUID),public.claim_pelecard_controlled_live_init(UUID),
  public.get_pelecard_controlled_live_attempt(UUID),public.save_pelecard_controlled_live_session(UUID,TEXT,TEXT,TEXT),
  public.finalize_pelecard_controlled_live(UUID,TEXT,TEXT,TEXT,NUMERIC,TEXT)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_pelecard_controlled_live(UUID),
  public.get_pelecard_controlled_live_attempt(UUID),public.save_pelecard_controlled_live_session(UUID,TEXT,TEXT,TEXT),
  public.finalize_pelecard_controlled_live(UUID,TEXT,TEXT,TEXT,NUMERIC,TEXT),
  public.is_pelecard_controlled_live_accounting_held(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_pelecard_controlled_live_init(UUID),public.get_pelecard_controlled_live_attempt(UUID)
TO pelecard_controlled_live_adapter;
COMMENT ON TABLE public.pelecard_controlled_live_control IS 'Authorization only; commercial truth stays in payment_transactions. Permanent one-attempt reservation and permanent accounting hold. Disabled by default.';
COMMIT;
