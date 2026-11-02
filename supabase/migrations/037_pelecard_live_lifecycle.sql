-- Permanent order ownership. No financial finality is inferred from expiry,
-- decline, timeout, 510 or browser input. Existing controlled records are read only.
BEGIN;
CREATE TABLE public.pelecard_live_attempts (
 payment_id uuid PRIMARY KEY REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
 order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
 dispatch_started_at timestamptz,
 transaction_id text UNIQUE,
 confirmation_key text,
 hosted_state text NOT NULL DEFAULT 'unknown' CHECK(hosted_state IN ('unknown','usable','expired')),
 last_lookup_status text CHECK(last_lookup_status ~ '^[0-9]{1,4}$'),
 last_transaction_status text CHECK(last_transaction_status ~ '^[0-9]{1,4}$'),
 correlation_valid boolean,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((transaction_id IS NULL AND confirmation_key IS NULL) OR
  (transaction_id IS NOT NULL AND confirmation_key IS NOT NULL AND dispatch_started_at IS NOT NULL))
);
CREATE TABLE public.pelecard_live_audit (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 payment_id uuid NOT NULL REFERENCES public.pelecard_live_attempts(payment_id),
 event_type text NOT NULL CHECK(event_type IN ('reserved','imported','dispatch_claimed','session_persisted','observed','finalized')),
 hosted_state text CHECK(hosted_state IN ('unknown','usable','expired')),
 lookup_status text CHECK(lookup_status ~ '^[0-9]{1,4}$'),
 transaction_status text CHECK(transaction_status ~ '^[0-9]{1,4}$'),
 correlation_valid boolean,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.pelecard_live_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pelecard_live_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pelecard_live_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pelecard_live_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pelecard_live_attempts,public.pelecard_live_audit FROM PUBLIC,anon,authenticated,service_role,pelecard_controlled_live_adapter;
INSERT INTO public.pelecard_live_attempts(payment_id,order_id,dispatch_started_at,transaction_id,confirmation_key)
 SELECT payment_id,order_id,dispatch_started_at,transaction_id,confirmation_key
 FROM public.pelecard_controlled_live_control WHERE payment_id IS NOT NULL;
INSERT INTO public.pelecard_live_audit(payment_id,event_type) SELECT payment_id,'imported' FROM public.pelecard_live_attempts;

CREATE FUNCTION public.guard_pelecard_live_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='pelecard_live_audit' THEN RAISE EXCEPTION 'live_audit_append_only' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'live_identity_immutable' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.payment_id,NEW.order_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.payment_id,OLD.order_id,OLD.created_at)
 OR (OLD.dispatch_started_at IS NOT NULL AND NEW.dispatch_started_at IS DISTINCT FROM OLD.dispatch_started_at)
 OR (OLD.transaction_id IS NOT NULL AND ROW(NEW.transaction_id,NEW.confirmation_key) IS DISTINCT FROM ROW(OLD.transaction_id,OLD.confirmation_key)) THEN
  RAISE EXCEPTION 'live_identity_immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_live_identity BEFORE UPDATE OR DELETE ON public.pelecard_live_attempts FOR EACH ROW EXECUTE FUNCTION public.guard_pelecard_live_identity();
CREATE TRIGGER guard_live_audit BEFORE UPDATE OR DELETE ON public.pelecard_live_audit FOR EACH ROW EXECUTE FUNCTION public.guard_pelecard_live_identity();

CREATE FUNCTION public.reserve_pelecard_live_order(p_order_id uuid,p_actor_id uuid,p_expected_amount_minor integer,p_previous_payment_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; a public.pelecard_live_attempts%ROWTYPE; result jsonb; new_id uuid;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin') THEN RAISE EXCEPTION 'payment_admin_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'order_not_payable' USING ERRCODE='23514'; END IF;
 IF o.total_price IS NULL OR o.total_price<=0 OR o.total_price*100>2147483647 OR o.total_price*100 IS DISTINCT FROM p_expected_amount_minor::numeric THEN
  RAISE EXCEPTION 'order_amount_mismatch' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM public.pelecard_live_attempts WHERE order_id=p_order_id;
 IF FOUND THEN
  IF p_previous_payment_id IS NOT NULL AND p_previous_payment_id<>a.payment_id THEN RAISE EXCEPTION 'stale_payment_attempt' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('id',a.payment_id,'created',false);
 END IF;
 IF p_previous_payment_id IS NOT NULL THEN RAISE EXCEPTION 'stale_payment_attempt' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.payment_transactions WHERE order_id=p_order_id OR checkout_snapshot->'linked_order_info'->>'order_number'=o.order_number)
 OR EXISTS(SELECT 1 FROM public.sales WHERE order_id=p_order_id OR linked_order_info->>'order_number'=o.order_number)
 OR EXISTS(SELECT 1 FROM public.pelecard_controlled_live_control WHERE order_id=p_order_id) THEN
  RAISE EXCEPTION 'order_payment_in_progress' USING ERRCODE='23514'; END IF;
 new_id:=pg_catalog.gen_random_uuid();
 result:=public.reserve_pelecard_order_payment(new_id,p_order_id,p_actor_id,'live-'||new_id::text,o.total_price,'ILS','{}');
 INSERT INTO public.pelecard_live_attempts(payment_id,order_id) VALUES(new_id,p_order_id);
 INSERT INTO public.pelecard_live_audit(payment_id,event_type) VALUES(new_id,'reserved');
 RETURN jsonb_build_object('id',new_id,'created',true);
END $$;

CREATE FUNCTION public.claim_pelecard_live_init(p_payment_id uuid)
RETURNS TABLE(amount_minor integer,currency text,order_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.pelecard_live_attempts%ROWTYPE; p public.payment_transactions%ROWTYPE;
BEGIN
 -- Order first matches reservation/finalization lock order.
 PERFORM 1 FROM public.orders o JOIN public.pelecard_live_attempts la ON la.order_id=o.id WHERE la.payment_id=p_payment_id FOR UPDATE OF o;
 SELECT * INTO a FROM public.pelecard_live_attempts WHERE payment_id=p_payment_id FOR UPDATE;
 IF NOT FOUND OR a.dispatch_started_at IS NOT NULL THEN RETURN; END IF;
 SELECT pt.* INTO p FROM public.payment_transactions pt JOIN public.orders o ON o.id=pt.order_id
 WHERE pt.id=p_payment_id AND pt.order_id=a.order_id AND pt.amount=o.total_price AND pt.currency='ILS'
 AND pt.provider='pelecard' AND pt.operation='payment' AND pt.status='initiated' AND pt.provider_session_id IS NULL
 AND o.payment_status='לא שולם' AND o.status NOT IN ('שולם','בוטל')
 AND NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.order_id=o.id)
 FOR UPDATE OF pt;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.pelecard_live_attempts SET dispatch_started_at=clock_timestamp(),updated_at=clock_timestamp() WHERE payment_id=p_payment_id;
 INSERT INTO public.pelecard_live_audit(payment_id,event_type) VALUES(p_payment_id,'dispatch_claimed');
 RETURN QUERY SELECT (p.amount*100)::integer,p.currency,p.order_id;
END $$;

CREATE FUNCTION public.get_pelecard_live_attempt(p_payment_id uuid)
RETURNS TABLE(payment_id uuid,order_id uuid,amount_minor integer,currency text,transaction_id text,confirmation_key text,hosted_state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p.id,p.order_id,(p.amount*100)::integer,p.currency,a.transaction_id,a.confirmation_key,a.hosted_state
 FROM public.pelecard_live_attempts a JOIN public.payment_transactions p ON p.id=a.payment_id
 WHERE p.id=p_payment_id AND p.order_id=a.order_id AND p.provider='pelecard' AND p.operation='payment' AND p.currency='ILS'
 AND a.dispatch_started_at IS NOT NULL AND a.transaction_id IS NOT NULL AND a.confirmation_key IS NOT NULL;
$$;

CREATE FUNCTION public.persist_pelecard_live_adapter_session(p_payment_id uuid,p_transaction_id text,p_confirmation_key text,p_url text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.pelecard_live_attempts%ROWTYPE; p public.payment_transactions%ROWTYPE;
BEGIN
 SELECT * INTO STRICT a FROM public.pelecard_live_attempts WHERE payment_id=p_payment_id FOR UPDATE;
 SELECT * INTO STRICT p FROM public.payment_transactions WHERE id=p_payment_id FOR UPDATE;
 IF a.dispatch_started_at IS NULL OR p.order_id IS DISTINCT FROM a.order_id OR p.provider<>'pelecard' OR p.operation<>'payment'
 OR p.currency<>'ILS' OR p.status NOT IN ('initiated','pending_provider') THEN RAISE EXCEPTION 'live_attempt_mismatch' USING ERRCODE='23514'; END IF;
 IF p_transaction_id IS NULL OR p_transaction_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 OR p_confirmation_key IS NULL OR length(p_confirmation_key) NOT BETWEEN 1 AND 512 OR p_confirmation_key !~ '^[A-Za-z0-9_+/=-]+$'
 OR p_url IS DISTINCT FROM ('https://gateway20.pelecard.biz/PaymentGW?transactionId='||p_transaction_id) THEN RAISE EXCEPTION 'live_invalid_session' USING ERRCODE='23514'; END IF;
 IF (a.transaction_id IS NOT NULL AND ROW(a.transaction_id,a.confirmation_key) IS DISTINCT FROM ROW(p_transaction_id,p_confirmation_key))
 OR (p.provider_session_id IS NOT NULL AND ROW(p.provider_session_id,p.provider_redirect_url) IS DISTINCT FROM ROW(p_transaction_id,p_url)) THEN RAISE EXCEPTION 'live_session_mismatch' USING ERRCODE='23514'; END IF;
 IF p.provider_session_id IS NOT NULL THEN RETURN to_jsonb(p); END IF;
 UPDATE public.pelecard_live_attempts SET transaction_id=p_transaction_id,confirmation_key=p_confirmation_key,hosted_state='usable',updated_at=clock_timestamp() WHERE payment_id=p_payment_id;
 UPDATE public.payment_transactions SET provider_session_id=p_transaction_id,provider_redirect_url=p_url,status='pending_provider' WHERE id=p_payment_id RETURNING * INTO p;
 INSERT INTO public.pelecard_live_audit(payment_id,event_type,hosted_state) VALUES(p_payment_id,'session_persisted','usable');
 RETURN to_jsonb(p);
END $$;

CREATE FUNCTION public.observe_pelecard_live_attempt(p_payment_id uuid,p_hosted_state text,p_lookup_status text,p_transaction_status text,p_correlation_valid boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.pelecard_live_attempts%ROWTYPE;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 IF p_hosted_state IS NOT NULL AND p_hosted_state NOT IN ('unknown','usable','expired')
 OR p_lookup_status IS NOT NULL AND p_lookup_status !~ '^[0-9]{1,4}$'
 OR p_transaction_status IS NOT NULL AND p_transaction_status !~ '^[0-9]{1,4}$' THEN RAISE EXCEPTION 'live_invalid_observation' USING ERRCODE='23514'; END IF;
 SELECT * INTO STRICT a FROM public.pelecard_live_attempts WHERE payment_id=p_payment_id FOR UPDATE;
 -- Expiry is monotonic: a stale concurrent verifier cannot revive the page.
 p_hosted_state:=CASE WHEN a.hosted_state='expired' THEN 'expired' ELSE coalesce(p_hosted_state,a.hosted_state) END;
 UPDATE public.pelecard_live_attempts SET hosted_state=p_hosted_state,last_lookup_status=p_lookup_status,
 last_transaction_status=p_transaction_status,correlation_valid=p_correlation_valid,updated_at=clock_timestamp() WHERE payment_id=p_payment_id;
 INSERT INTO public.pelecard_live_audit(payment_id,event_type,hosted_state,lookup_status,transaction_status,correlation_valid)
 VALUES(p_payment_id,'observed',p_hosted_state,p_lookup_status,p_transaction_status,p_correlation_valid);
 RETURN jsonb_build_object('id',p_payment_id,'hosted_state',coalesce(p_hosted_state,a.hosted_state),'can_replace',false);
END $$;

CREATE FUNCTION public.finalize_pelecard_live(p_payment_id uuid,p_provider_transaction_id text,p_approval_id text,p_provider_status_code text,p_amount numeric,p_currency text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.pelecard_live_attempts%ROWTYPE; p public.payment_transactions%ROWTYPE; result jsonb;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.orders o JOIN public.pelecard_live_attempts la ON la.order_id=o.id WHERE la.payment_id=p_payment_id FOR UPDATE OF o;
 SELECT * INTO STRICT a FROM public.pelecard_live_attempts WHERE payment_id=p_payment_id FOR UPDATE;
 SELECT * INTO STRICT p FROM public.payment_transactions WHERE id=p_payment_id FOR UPDATE;
 IF a.transaction_id IS NULL OR a.transaction_id IS DISTINCT FROM p_provider_transaction_id OR a.dispatch_started_at IS NULL
 OR a.correlation_valid IS DISTINCT FROM true OR a.last_lookup_status IS DISTINCT FROM '000' OR a.last_transaction_status IS DISTINCT FROM '000'
 OR p.amount IS DISTINCT FROM p_amount OR p.currency IS DISTINCT FROM p_currency OR p_currency IS DISTINCT FROM 'ILS' OR p_provider_status_code IS DISTINCT FROM '000'
 THEN RAISE EXCEPTION 'live_verification_mismatch' USING ERRCODE='23514'; END IF;
 result:=public.finalize_pelecard_payment(p_payment_id,p_provider_transaction_id,p_approval_id,p_provider_status_code,p_amount,p_currency);
 IF p.status<>'succeeded' THEN INSERT INTO public.pelecard_live_audit(payment_id,event_type) VALUES(p_payment_id,'finalized'); END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.guard_pelecard_live_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.pelecard_live_attempts%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM 1 FROM public.orders WHERE id=NEW.order_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.pelecard_live_attempts WHERE order_id=NEW.order_id AND payment_id<>NEW.id) THEN RAISE EXCEPTION 'live_attempt_already_reserved' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO a FROM public.pelecard_live_attempts WHERE payment_id=OLD.id;
 IF NOT FOUND THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'live_identity_immutable' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.id,NEW.order_id,NEW.amount,NEW.currency,NEW.checkout_snapshot,NEW.created_by,NEW.provider,NEW.operation,NEW.idempotency_key)
 IS DISTINCT FROM ROW(OLD.id,OLD.order_id,OLD.amount,OLD.currency,OLD.checkout_snapshot,OLD.created_by,OLD.provider,OLD.operation,OLD.idempotency_key)
 THEN RAISE EXCEPTION 'live_identity_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('pending_provider','succeeded','timed_out') THEN RAISE EXCEPTION 'live_financial_transition_forbidden' USING ERRCODE='23514'; END IF;
 IF (NEW.provider_session_id IS NOT NULL AND NEW.provider_session_id IS DISTINCT FROM a.transaction_id)
 OR (NEW.status='succeeded' AND (a.transaction_id IS NULL OR NEW.provider_transaction_id IS DISTINCT FROM a.transaction_id
 OR NEW.provider_status_code IS DISTINCT FROM '000' OR a.correlation_valid IS DISTINCT FROM true OR a.last_lookup_status IS DISTINCT FROM '000' OR a.last_transaction_status IS DISTINCT FROM '000'))
 THEN RAISE EXCEPTION 'live_verification_mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_live_payment BEFORE INSERT OR UPDATE OR DELETE ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION public.guard_pelecard_live_payment();

-- Serialize manual-sale entry with reservation, including order-number aliases.
-- Keep existing untracked-order sales behavior while closing the parallel cashier path.
CREATE FUNCTION public.guard_pelecard_live_sale() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; a public.pelecard_live_attempts%ROWTYPE; p public.payment_transactions%ROWTYPE;
 old_order_id uuid; old_order_number text; old_payment_id uuid;
BEGIN
 IF TG_OP='UPDATE' THEN
  old_order_id:=OLD.order_id; old_order_number:=OLD.linked_order_info->>'order_number'; old_payment_id:=OLD.payment_transaction_id;
 END IF;
 FOR o IN SELECT ord.* FROM public.orders ord WHERE ord.id=NEW.order_id OR ord.id=old_order_id
  OR ord.order_number=NEW.linked_order_info->>'order_number' OR ord.order_number=old_order_number
  OR ord.id IN(SELECT la.order_id FROM public.pelecard_live_attempts la WHERE la.payment_id=NEW.payment_transaction_id OR la.payment_id=old_payment_id)
  ORDER BY ord.id FOR UPDATE
 LOOP
  SELECT * INTO a FROM public.pelecard_live_attempts WHERE order_id=o.id;
  IF FOUND THEN
   SELECT * INTO STRICT p FROM public.payment_transactions WHERE id=a.payment_id;
   IF coalesce(auth.role(),'')<>'service_role' OR NEW.payment_transaction_id IS DISTINCT FROM a.payment_id
    OR NEW.order_id IS DISTINCT FROM o.id OR NEW.total IS DISTINCT FROM p.amount OR NEW.method IS DISTINCT FROM 'פלאקארד'
    OR a.transaction_id IS NULL OR a.correlation_valid IS DISTINCT FROM true
    OR a.last_lookup_status IS DISTINCT FROM '000' OR a.last_transaction_status IS DISTINCT FROM '000'
   THEN RAISE EXCEPTION 'live_order_sale_reserved' USING ERRCODE='23514'; END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_live_sale BEFORE INSERT OR UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.guard_pelecard_live_sale();

CREATE OR REPLACE FUNCTION public.is_pelecard_controlled_live_accounting_held(p_source_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.pelecard_controlled_live_control c LEFT JOIN public.payment_transactions p ON p.id=c.payment_id
 WHERE c.payment_id IS NOT NULL AND lower(p_source_id) IN(c.payment_id::text,c.order_id::text,p.sale_id::text))
 OR EXISTS(SELECT 1 FROM public.sales s JOIN public.pelecard_controlled_live_control c ON s.order_id=c.order_id WHERE c.payment_id IS NOT NULL AND s.id::text=lower(p_source_id))
 OR EXISTS(SELECT 1 FROM public.pelecard_live_attempts a JOIN public.payment_transactions p ON p.id=a.payment_id
 WHERE lower(p_source_id) IN(a.payment_id::text,a.order_id::text,p.sale_id::text))
 OR EXISTS(SELECT 1 FROM public.sales s JOIN public.pelecard_live_attempts a ON s.order_id=a.order_id WHERE s.id::text=lower(p_source_id));
$$;

CREATE OR REPLACE FUNCTION public.get_pelecard_order_payment_ui(p_order_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin') THEN RAISE EXCEPTION 'payment_admin_required' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('order_id',o.id,'order_number',o.order_number,'amount',o.total_price,'payment_status',o.payment_status,'order_status',o.status,
 'payment_id',p.id,'payment_state',p.status,'payment_amount',p.amount,'payment_currency',p.currency,'sale_id',p.sale_id,
 'provider_session_id',p.provider_session_id,'provider_redirect_url',p.provider_redirect_url,
 'controlled',coalesce(c.order_id=o.id AND(p.id=c.payment_id OR(p.id IS NULL AND c.payment_id IS NULL)),false),
 'accounting_held',public.is_pelecard_controlled_live_accounting_held(p.id::text),
 'init_enabled',c.order_id IS NULL AND p.id IS NULL AND o.payment_status='לא שולם' AND o.status NOT IN ('שולם','בוטל') AND o.total_price>0
 AND NOT EXISTS(SELECT 1 FROM public.payment_transactions x WHERE x.order_id=o.id OR x.checkout_snapshot->'linked_order_info'->>'order_number'=o.order_number)
 AND NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.order_id=o.id OR s.linked_order_info->>'order_number'=o.order_number),
 'hosted_state',coalesce(a.hosted_state,'unknown'),'last_lookup_status',a.last_lookup_status,'last_transaction_status',a.last_transaction_status,
 'correlation_valid',a.correlation_valid,'can_replace',false)
 INTO result FROM public.orders o LEFT JOIN LATERAL(SELECT pt.* FROM public.payment_transactions pt WHERE pt.order_id=o.id AND pt.provider='pelecard' AND pt.operation='payment' ORDER BY pt.created_at DESC,pt.id DESC LIMIT 1)p ON true
 LEFT JOIN public.pelecard_live_attempts a ON a.payment_id=p.id LEFT JOIN public.pelecard_controlled_live_control c ON c.order_id=o.id WHERE o.id=p_order_id;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.guard_pelecard_live_identity(),public.guard_pelecard_live_payment(),public.guard_pelecard_live_sale(),public.reserve_pelecard_live_order(uuid,uuid,integer,uuid),public.claim_pelecard_live_init(uuid),public.get_pelecard_live_attempt(uuid),public.persist_pelecard_live_adapter_session(uuid,text,text,text),public.observe_pelecard_live_attempt(uuid,text,text,text,boolean),public.finalize_pelecard_live(uuid,text,text,text,numeric,text) FROM PUBLIC,anon,authenticated,service_role,pelecard_controlled_live_adapter;
GRANT EXECUTE ON FUNCTION public.reserve_pelecard_live_order(uuid,uuid,integer,uuid),public.get_pelecard_live_attempt(uuid),public.observe_pelecard_live_attempt(uuid,text,text,text,boolean),public.finalize_pelecard_live(uuid,text,text,text,numeric,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_pelecard_live_init(uuid),public.get_pelecard_live_attempt(uuid),public.persist_pelecard_live_adapter_session(uuid,text,text,text) TO pelecard_controlled_live_adapter;
NOTIFY pgrst,'reload schema';
COMMIT;
