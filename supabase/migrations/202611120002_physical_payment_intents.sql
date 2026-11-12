-- Isolated card-present intent ledger. Applying this migration creates no charge,
-- invoice, activation, worker or production configuration change.
BEGIN;

CREATE TABLE public.physical_payment_intents (
  payment_id uuid PRIMARY KEY REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
  request_key uuid NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  workstation_code text NOT NULL REFERENCES public.cash_registers(code),
  register_number text NOT NULL REFERENCES public.physical_terminal_devices(register_number),
  terminal_number text NOT NULL CHECK (terminal_number='2814926015'),
  amount_minor integer NOT NULL CHECK (amount_minor BETWEEN 1 AND 2147483647),
  checkout_snapshot jsonb NOT NULL CHECK (jsonb_typeof(checkout_snapshot)='object'),
  billing_snapshot jsonb NOT NULL CHECK (jsonb_typeof(billing_snapshot)='object'),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN
    ('reserved','dispatching','pending','uncertain','approved','declined','succeeded')),
  dispatch_started_at timestamptz,
  provider_transaction_id text UNIQUE,
  approval_id text,
  sale_id uuid UNIQUE REFERENCES public.sales(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (dispatch_started_at IS NULL OR state<>'reserved'),
  CHECK (state NOT IN ('approved','succeeded') OR
    (provider_transaction_id IS NOT NULL AND approval_id IS NOT NULL)),
  CHECK (state<>'succeeded' OR sale_id IS NOT NULL)
);
CREATE UNIQUE INDEX physical_one_unresolved_per_register
  ON public.physical_payment_intents(register_number)
  WHERE state IN ('reserved','dispatching','pending','uncertain','approved');
ALTER TABLE public.physical_payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.physical_payment_intents FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.physical_payment_intents FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.guard_physical_intent_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'physical_intent_immutable' USING ERRCODE='23514'; END IF;
  IF ROW(NEW.payment_id,NEW.request_key,NEW.created_by,NEW.workstation_code,
    NEW.register_number,NEW.terminal_number,NEW.amount_minor,NEW.checkout_snapshot,
    NEW.billing_snapshot,NEW.created_at) IS DISTINCT FROM
    ROW(OLD.payment_id,OLD.request_key,OLD.created_by,OLD.workstation_code,
    OLD.register_number,OLD.terminal_number,OLD.amount_minor,OLD.checkout_snapshot,
    OLD.billing_snapshot,OLD.created_at) OR
    (OLD.dispatch_started_at IS NOT NULL AND NEW.dispatch_started_at IS DISTINCT FROM OLD.dispatch_started_at) OR
    (OLD.provider_transaction_id IS NOT NULL AND NEW.provider_transaction_id IS DISTINCT FROM OLD.provider_transaction_id) OR
    (OLD.approval_id IS NOT NULL AND NEW.approval_id IS DISTINCT FROM OLD.approval_id) OR
    (OLD.sale_id IS NOT NULL AND NEW.sale_id IS DISTINCT FROM OLD.sale_id) OR
    (OLD.state='succeeded' AND NEW.state<>'succeeded')
  THEN RAISE EXCEPTION 'physical_intent_immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_physical_intent_mutation BEFORE UPDATE OR DELETE ON public.physical_payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.guard_physical_intent_mutation();
REVOKE ALL ON FUNCTION public.guard_physical_intent_mutation() FROM PUBLIC,anon,authenticated,service_role;

-- All callers are server-side service-role code. The cashier never chooses a
-- register; the enabled admin assignment is read under a row lock.
CREATE FUNCTION public.reserve_physical_payment(
  p_actor_id uuid,p_request_key uuid,p_workstation_code text,p_amount_minor integer,
  p_checkout_snapshot jsonb,p_billing_snapshot jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.physical_payment_intents%ROWTYPE; d public.physical_terminal_devices%ROWTYPE;
  payment_id uuid; role_name text; total numeric; subtotal numeric:=0; line jsonb;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT role::text INTO role_name FROM public.profiles WHERE id=p_actor_id;
  IF role_name NOT IN ('admin','cashier') OR p_request_key IS NULL OR
    p_workstation_code IS NULL OR p_amount_minor NOT BETWEEN 1 AND 2147483647 OR
    jsonb_typeof(p_checkout_snapshot->'items')<>'array' OR
    jsonb_array_length(p_checkout_snapshot->'items') NOT BETWEEN 1 AND 100 OR
    jsonb_typeof(p_billing_snapshot)<>'object'
  THEN RAISE EXCEPTION 'physical_reservation_invalid' USING ERRCODE='23514'; END IF;
  SELECT * INTO i FROM public.physical_payment_intents WHERE request_key=p_request_key;
  IF FOUND THEN
    IF i.created_by IS DISTINCT FROM p_actor_id OR i.workstation_code IS DISTINCT FROM p_workstation_code OR
      i.amount_minor IS DISTINCT FROM p_amount_minor OR i.checkout_snapshot IS DISTINCT FROM p_checkout_snapshot
    THEN RAISE EXCEPTION 'physical_request_conflict' USING ERRCODE='23514'; END IF;
    RETURN jsonb_build_object('paymentId',i.payment_id,'state',i.state,'registerNumber',i.register_number);
  END IF;
  SELECT * INTO d FROM public.physical_terminal_devices
    WHERE cash_register_code=p_workstation_code AND enabled FOR SHARE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.cash_registers
      WHERE code=p_workstation_code AND active)
  THEN RAISE EXCEPTION 'physical_register_unassigned' USING ERRCODE='23514'; END IF;
  -- The trusted server reprices each catalog row. Recheck frozen arithmetic in
  -- the reservation transaction before this amount can ever be dispatched.
  FOR line IN SELECT value FROM jsonb_array_elements(p_checkout_snapshot->'items') LOOP
    IF jsonb_typeof(line)<>'object' OR line->>'qty' !~ '^[1-9][0-9]{0,3}$' OR
      (line->>'qty')::integer>1000 OR
      line->>'customPrice' !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' OR
      (line->>'customPrice')::numeric<=0 OR nullif(btrim(line->>'name'),'') IS NULL
    THEN RAISE EXCEPTION 'physical_snapshot_invalid' USING ERRCODE='23514'; END IF;
    subtotal:=subtotal+(line->>'qty')::integer*(line->>'customPrice')::numeric;
  END LOOP;
  total:=p_amount_minor::numeric/100;
  IF p_checkout_snapshot->'discount' IS NULL OR p_checkout_snapshot->'discount'='null'::jsonb THEN
    IF subtotal IS DISTINCT FROM total THEN RAISE EXCEPTION 'physical_amount_mismatch' USING ERRCODE='23514'; END IF;
  ELSIF jsonb_typeof(p_checkout_snapshot->'discount')<>'object' OR
    jsonb_typeof(p_checkout_snapshot->'discount'->'original_total')<>'number' OR
    jsonb_typeof(p_checkout_snapshot->'discount'->'final_total')<>'number' OR
    (p_checkout_snapshot->'discount'->>'original_total')::numeric IS DISTINCT FROM subtotal OR
    (p_checkout_snapshot->'discount'->>'final_total')::numeric IS DISTINCT FROM total OR
    total>=subtotal
  THEN RAISE EXCEPTION 'physical_amount_mismatch' USING ERRCODE='23514'; END IF;
  payment_id:=gen_random_uuid();
  INSERT INTO public.payment_transactions(id,provider,operation,order_id,amount,currency,status,
    idempotency_key,checkout_snapshot,created_by)
  VALUES(payment_id,'pelecard','payment',NULL,total,'ILS','initiated',
    'physical-'||payment_id::text,p_checkout_snapshot,p_actor_id);
  INSERT INTO public.physical_payment_intents(payment_id,request_key,created_by,workstation_code,
    register_number,terminal_number,amount_minor,checkout_snapshot,billing_snapshot)
  VALUES(payment_id,p_request_key,p_actor_id,p_workstation_code,d.register_number,
    '2814926015',p_amount_minor,p_checkout_snapshot,p_billing_snapshot);
  RETURN jsonb_build_object('paymentId',payment_id,'state','reserved','registerNumber',d.register_number);
END $$;
REVOKE ALL ON FUNCTION public.reserve_physical_payment(uuid,uuid,text,integer,jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_physical_payment(uuid,uuid,text,integer,jsonb,jsonb) TO service_role;

-- The one-shot claim is persisted before the external financial call. An
-- uncertain send cannot be claimed again, even after process or browser death.
CREATE FUNCTION public.claim_physical_dispatch(p_payment_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claimed boolean;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  UPDATE public.physical_payment_intents SET state='dispatching',
    dispatch_started_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE payment_id=p_payment_id AND state='reserved' AND dispatch_started_at IS NULL
    RETURNING true INTO claimed;
  RETURN coalesce(claimed,false);
END $$;
REVOKE ALL ON FUNCTION public.claim_physical_dispatch(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_physical_dispatch(uuid) TO service_role;

CREATE FUNCTION public.mark_physical_uncertain(p_payment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  UPDATE public.physical_payment_intents SET state='uncertain',updated_at=clock_timestamp()
    WHERE payment_id=p_payment_id AND state IN ('dispatching','pending');
END $$;
REVOKE ALL ON FUNCTION public.mark_physical_uncertain(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mark_physical_uncertain(uuid) TO service_role;

CREATE FUNCTION public.mark_physical_pending(p_payment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  UPDATE public.physical_payment_intents SET state='pending',updated_at=clock_timestamp()
    WHERE payment_id=p_payment_id AND state='dispatching';
END $$;
REVOKE ALL ON FUNCTION public.mark_physical_pending(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mark_physical_pending(uuid) TO service_role;

-- Only a server lookup that matches the frozen intent may record a terminal
-- result. The provider adapter must authenticate the lookup before this RPC.
CREATE FUNCTION public.observe_physical_result(p_payment_id uuid,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.physical_payment_intents%ROWTYPE; p public.payment_transactions%ROWTYPE;
  provider_id text; approval text; result_status text;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT i FROM public.physical_payment_intents WHERE payment_id=p_payment_id FOR UPDATE;
  SELECT * INTO STRICT p FROM public.payment_transactions WHERE id=p_payment_id FOR UPDATE;
  IF i.state='succeeded' THEN RETURN jsonb_build_object('state','succeeded','saleId',i.sale_id); END IF;
  IF i.state NOT IN ('dispatching','pending','uncertain','approved') OR i.dispatch_started_at IS NULL OR
    p_result->>'intentId' IS DISTINCT FROM i.payment_id::text OR
    p_result->>'merchantTerminal' IS DISTINCT FROM i.terminal_number OR
    p_result->>'register' IS DISTINCT FROM i.register_number OR
    p_result->>'amountMinor' IS DISTINCT FROM i.amount_minor::text
  THEN RAISE EXCEPTION 'physical_result_mismatch' USING ERRCODE='23514'; END IF;
  result_status:=p_result->>'status';
  provider_id:=p_result->>'transactionId';
  approval:=p_result->>'approvalId';
  IF result_status NOT IN ('approved','declined') OR provider_id IS NULL OR
    provider_id !~ '^[A-Za-z0-9_-]{1,100}$' OR
    (result_status='approved' AND (approval IS NULL OR approval !~ '^[A-Za-z0-9_-]{1,100}$'))
  THEN RAISE EXCEPTION 'physical_result_invalid' USING ERRCODE='23514'; END IF;
  IF i.provider_transaction_id IS NOT NULL AND i.provider_transaction_id IS DISTINCT FROM provider_id
  THEN RAISE EXCEPTION 'physical_result_conflict' USING ERRCODE='23514'; END IF;
  IF i.state='approved' AND result_status<>'approved'
  THEN RAISE EXCEPTION 'physical_result_conflict' USING ERRCODE='23514'; END IF;
  UPDATE public.physical_payment_intents SET state=result_status,provider_transaction_id=provider_id,
    approval_id=CASE WHEN result_status='approved' THEN approval ELSE NULL END,
    updated_at=clock_timestamp() WHERE payment_id=p_payment_id;
  IF result_status='declined' THEN
    UPDATE public.payment_transactions SET status='failed',provider_transaction_id=provider_id
      WHERE id=p_payment_id AND status IN ('initiated','pending_provider','timed_out');
  ELSE
    UPDATE public.payment_transactions SET status='pending_provider'
      WHERE id=p_payment_id AND status='initiated';
  END IF;
  RETURN jsonb_build_object('state',result_status,'paymentId',p_payment_id);
END $$;
REVOKE ALL ON FUNCTION public.observe_physical_result(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.observe_physical_result(uuid,jsonb) TO service_role;

-- Prevent an unrelated caller from bypassing the physical approval fence by
-- calling the shared sale finalizer directly. This trigger applies only when a
-- physical intent exists; hosted payments retain their existing behavior.
CREATE FUNCTION public.guard_physical_payment_success() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.physical_payment_intents%ROWTYPE;
BEGIN
  IF NEW.status<>'succeeded' OR OLD.status='succeeded' THEN RETURN NEW; END IF;
  SELECT * INTO i FROM public.physical_payment_intents WHERE payment_id=NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF i.state<>'approved' OR i.provider_transaction_id IS DISTINCT FROM NEW.provider_transaction_id OR
    i.approval_id IS DISTINCT FROM NEW.approval_id OR i.amount_minor IS DISTINCT FROM (NEW.amount*100)::integer
  THEN RAISE EXCEPTION 'physical_approval_required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_physical_payment_success BEFORE UPDATE OF status ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_physical_payment_success();
REVOKE ALL ON FUNCTION public.guard_physical_payment_success() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.finalize_physical_payment(p_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.physical_payment_intents%ROWTYPE; result jsonb; sale uuid;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT i FROM public.physical_payment_intents WHERE payment_id=p_payment_id FOR UPDATE;
  IF i.state='succeeded' THEN
    RETURN jsonb_build_object('state','succeeded','paymentId',p_payment_id,'saleId',i.sale_id);
  END IF;
  IF i.state<>'approved' OR i.provider_transaction_id IS NULL OR i.approval_id IS NULL
  THEN RAISE EXCEPTION 'physical_approval_required' USING ERRCODE='23514'; END IF;
  result:=public.finalize_pelecard_payment(p_payment_id,i.provider_transaction_id,i.approval_id,
    '000',i.amount_minor::numeric/100,'ILS');
  sale:=(result->>'sale_id')::uuid;
  UPDATE public.sales SET method='תשלום במסופון פיזי',
    sale_date=(clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::date WHERE id=sale;
  UPDATE public.physical_payment_intents SET state='succeeded',sale_id=sale,
    updated_at=clock_timestamp() WHERE payment_id=p_payment_id;
  RETURN jsonb_build_object('state','succeeded','paymentId',p_payment_id,'saleId',sale);
END $$;
REVOKE ALL ON FUNCTION public.finalize_physical_payment(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finalize_physical_payment(uuid) TO service_role;

CREATE FUNCTION public.get_physical_payment(p_actor_id uuid,p_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.physical_payment_intents%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO i FROM public.physical_payment_intents WHERE payment_id=p_payment_id AND created_by=p_actor_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('paymentId',i.payment_id,'state',i.state,'registerNumber',i.register_number,
    'amountMinor',i.amount_minor,'saleId',i.sale_id,'createdAt',i.created_at);
END $$;
REVOKE ALL ON FUNCTION public.get_physical_payment(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_physical_payment(uuid,uuid) TO service_role;

CREATE FUNCTION public.get_physical_payment_by_request(p_actor_id uuid,p_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE payment uuid;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT payment_id INTO payment FROM public.physical_payment_intents
    WHERE request_key=p_request_key AND created_by=p_actor_id;
  IF payment IS NULL THEN RETURN NULL; END IF;
  RETURN public.get_physical_payment(p_actor_id,payment);
END $$;
REVOKE ALL ON FUNCTION public.get_physical_payment_by_request(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_physical_payment_by_request(uuid,uuid) TO service_role;

CREATE FUNCTION public.get_physical_worker_intent(p_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.physical_payment_intents%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO i FROM public.physical_payment_intents WHERE payment_id=p_payment_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id',i.payment_id,'state',i.state,'register',i.register_number,
    'amountMinor',i.amount_minor,'merchantTerminal',i.terminal_number,
    'transactionId',i.provider_transaction_id,'saleId',i.sale_id);
END $$;
REVOKE ALL ON FUNCTION public.get_physical_worker_intent(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_physical_worker_intent(uuid) TO service_role;

COMMIT;
