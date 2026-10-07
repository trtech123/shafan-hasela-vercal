-- Hosted expiry is not financial finality. Only separately attributable provider
-- confirmation may close an unpaid attempt. No commercial row is closed here.
BEGIN;
ALTER TABLE public.pelecard_live_attempts ADD COLUMN hosted_expires_at timestamptz,
 ADD COLUMN closed_unpaid_at timestamptz;
UPDATE public.pelecard_live_attempts SET hosted_expires_at=dispatch_started_at+interval '15 minutes' WHERE dispatch_started_at IS NOT NULL;
ALTER TABLE public.pelecard_live_attempts ADD CONSTRAINT live_deadline_matches_dispatch CHECK(hosted_expires_at IS NOT DISTINCT FROM dispatch_started_at+interval '15 minutes');
ALTER TABLE public.pelecard_live_attempts DROP CONSTRAINT pelecard_live_attempts_order_id_key;
ALTER TABLE public.pelecard_live_attempts ALTER CONSTRAINT pelecard_live_attempts_payment_id_fkey DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX pelecard_live_one_active_order ON public.pelecard_live_attempts(order_id) WHERE closed_unpaid_at IS NULL;
CREATE TABLE public.pelecard_live_unpaid_confirmations (
 payment_id uuid PRIMARY KEY REFERENCES public.pelecard_live_attempts(payment_id),
 provider_transaction_id text NOT NULL,
 confirmation_source text NOT NULL CHECK(confirmation_source IN ('provider_phone_confirmation','provider_written_confirmation')),
 confirmation_date date NOT NULL,
 confirmation_reference text NOT NULL CHECK(length(btrim(confirmation_reference)) BETWEEN 12 AND 2000),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.pelecard_live_unpaid_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pelecard_live_unpaid_confirmations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pelecard_live_unpaid_confirmations FROM PUBLIC,anon,authenticated,service_role,pelecard_controlled_live_adapter;
ALTER TABLE public.pelecard_live_audit DROP CONSTRAINT pelecard_live_audit_event_type_check;
ALTER TABLE public.pelecard_live_audit ADD CONSTRAINT pelecard_live_audit_event_type_check CHECK(event_type IN ('reserved','imported','dispatch_claimed','session_persisted','observed','finalized','closed_unpaid'));
ALTER TABLE public.payment_transactions DROP CONSTRAINT payment_transactions_status_check;
ALTER TABLE public.payment_transactions ADD CONSTRAINT payment_transactions_status_check CHECK(status IN ('initiated','pending_provider','succeeded','failed','timed_out','refund_pending','refunded','void_pending','voided','expired'));
ALTER TABLE public.payment_transaction_events DROP CONSTRAINT payment_transaction_events_status_check;
ALTER TABLE public.payment_transaction_events ADD CONSTRAINT payment_transaction_events_status_check CHECK(status IN ('initiated','pending_provider','succeeded','failed','timed_out','refund_pending','refunded','void_pending','voided','expired'));
CREATE OR REPLACE FUNCTION public.guard_pelecard_live_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME IN ('pelecard_live_audit','pelecard_live_unpaid_confirmations') THEN RAISE EXCEPTION 'live_audit_append_only' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'live_identity_immutable' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.payment_id,NEW.order_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.payment_id,OLD.order_id,OLD.created_at)
 OR (OLD.dispatch_started_at IS NOT NULL AND NEW.dispatch_started_at IS DISTINCT FROM OLD.dispatch_started_at)
 OR (OLD.transaction_id IS NOT NULL AND ROW(NEW.transaction_id,NEW.confirmation_key) IS DISTINCT FROM ROW(OLD.transaction_id,OLD.confirmation_key)) THEN
  RAISE EXCEPTION 'live_identity_immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.closed_unpaid_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'live_closed_terminal' USING ERRCODE='23514'; END IF;
 IF OLD.hosted_expires_at IS NOT NULL AND NEW.hosted_expires_at IS DISTINCT FROM OLD.hosted_expires_at THEN
  RAISE EXCEPTION 'live_identity_immutable' USING ERRCODE='23514'; END IF;
 IF OLD.dispatch_started_at IS NULL AND NEW.dispatch_started_at IS NOT NULL THEN
  NEW.hosted_expires_at:=NEW.dispatch_started_at+interval '15 minutes'; END IF;
 IF NEW.closed_unpaid_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.pelecard_live_unpaid_confirmations e WHERE e.payment_id=NEW.payment_id AND e.provider_transaction_id=NEW.transaction_id) THEN
  RAISE EXCEPTION 'live_confirmation_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_live_unpaid_confirmation BEFORE UPDATE OR DELETE ON public.pelecard_live_unpaid_confirmations FOR EACH ROW EXECUTE FUNCTION public.guard_pelecard_live_identity();

-- Shared eligibility used by reservation and server UI. Every historical payment
-- must be tracked and terminally closed, including order-number aliases.
CREATE FUNCTION public.can_replace_pelecard_live(p_order_id uuid,p_payment_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.orders o JOIN public.pelecard_live_attempts a ON a.order_id=o.id
 JOIN public.payment_transactions p ON p.id=a.payment_id
 JOIN public.pelecard_live_unpaid_confirmations e ON e.payment_id=a.payment_id
 WHERE o.id=p_order_id AND a.payment_id=p_payment_id AND a.closed_unpaid_at IS NOT NULL AND p.status='expired'
 AND o.payment_status='לא שולם' AND o.status NOT IN ('שולם','בוטל') AND o.total_price>0
 AND a.payment_id=(SELECT la.payment_id FROM public.pelecard_live_attempts la WHERE la.order_id=o.id ORDER BY la.created_at DESC,la.payment_id DESC LIMIT 1)
 AND NOT EXISTS(SELECT 1 FROM public.pelecard_live_attempts la WHERE la.order_id=o.id AND la.closed_unpaid_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.order_id=o.id OR s.linked_order_info->>'order_number'=o.order_number)
 AND NOT EXISTS(SELECT 1 FROM public.payment_transactions x LEFT JOIN public.pelecard_live_attempts la ON la.payment_id=x.id
 WHERE (x.order_id=o.id OR x.checkout_snapshot->'linked_order_info'->>'order_number'=o.order_number)
 AND (la.payment_id IS NULL OR la.order_id<>o.id OR la.closed_unpaid_at IS NULL OR x.status<>'expired'
 OR NOT EXISTS(SELECT 1 FROM public.pelecard_live_unpaid_confirmations e2 WHERE e2.payment_id=x.id))));
$$;
CREATE OR REPLACE FUNCTION public.reserve_pelecard_live_order(p_order_id uuid,p_actor_id uuid,p_expected_amount_minor integer,p_previous_payment_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; a public.pelecard_live_attempts%ROWTYPE; result jsonb; new_id uuid;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin') THEN RAISE EXCEPTION 'payment_admin_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'order_not_payable' USING ERRCODE='23514'; END IF;
 IF o.total_price IS NULL OR o.total_price<=0 OR o.total_price*100>2147483647 OR o.total_price*100 IS DISTINCT FROM p_expected_amount_minor::numeric THEN
  RAISE EXCEPTION 'order_amount_mismatch' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM public.pelecard_live_attempts WHERE order_id=p_order_id ORDER BY created_at DESC,payment_id DESC LIMIT 1;
 IF FOUND THEN
  IF p_previous_payment_id IS NOT NULL AND p_previous_payment_id<>a.payment_id THEN RAISE EXCEPTION 'stale_payment_attempt' USING ERRCODE='23514'; END IF;
  IF a.closed_unpaid_at IS NULL THEN RETURN jsonb_build_object('id',a.payment_id,'created',false); END IF;
  IF p_previous_payment_id IS DISTINCT FROM a.payment_id THEN RAISE EXCEPTION 'stale_payment_attempt' USING ERRCODE='23514'; END IF;
  IF NOT public.can_replace_pelecard_live(p_order_id,a.payment_id) THEN RAISE EXCEPTION 'order_payment_in_progress' USING ERRCODE='23514'; END IF;
 ELSE
 IF p_previous_payment_id IS NOT NULL THEN RAISE EXCEPTION 'stale_payment_attempt' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.payment_transactions WHERE order_id=p_order_id OR checkout_snapshot->'linked_order_info'->>'order_number'=o.order_number)
 OR EXISTS(SELECT 1 FROM public.sales WHERE order_id=p_order_id OR linked_order_info->>'order_number'=o.order_number)
 OR EXISTS(SELECT 1 FROM public.pelecard_controlled_live_control WHERE order_id=p_order_id) THEN
  RAISE EXCEPTION 'order_payment_in_progress' USING ERRCODE='23514'; END IF;
 END IF;
 new_id:=pg_catalog.gen_random_uuid();
 INSERT INTO public.pelecard_live_attempts(payment_id,order_id) VALUES(new_id,p_order_id);
 result:=public.reserve_pelecard_order_payment(new_id,p_order_id,p_actor_id,'live-'||new_id::text,o.total_price,'ILS','{}');
 INSERT INTO public.pelecard_live_audit(payment_id,event_type) VALUES(new_id,'reserved');
 RETURN jsonb_build_object('id',new_id,'created',true);
END $$;
DROP FUNCTION public.get_pelecard_live_attempt(uuid);
CREATE FUNCTION public.get_pelecard_live_attempt(p_payment_id uuid)
RETURNS TABLE(payment_id uuid,order_id uuid,amount_minor integer,currency text,transaction_id text,confirmation_key text,hosted_state text,hosted_expires_at timestamptz,closed_unpaid_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p.id,p.order_id,(p.amount*100)::integer,p.currency,a.transaction_id,a.confirmation_key,CASE WHEN a.hosted_expires_at<=statement_timestamp() THEN 'expired' ELSE a.hosted_state END,a.hosted_expires_at,a.closed_unpaid_at
 FROM public.pelecard_live_attempts a JOIN public.payment_transactions p ON p.id=a.payment_id
 WHERE p.id=p_payment_id AND p.order_id=a.order_id AND p.provider='pelecard' AND p.operation='payment' AND p.currency='ILS'
 AND a.dispatch_started_at IS NOT NULL AND a.transaction_id IS NOT NULL AND a.confirmation_key IS NOT NULL;
$$;
CREATE OR REPLACE FUNCTION public.observe_pelecard_live_attempt(p_payment_id uuid,p_hosted_state text,p_lookup_status text,p_transaction_status text,p_correlation_valid boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.pelecard_live_attempts%ROWTYPE;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 IF p_hosted_state IS NOT NULL AND p_hosted_state NOT IN ('unknown','usable','expired')
 OR p_lookup_status IS NOT NULL AND p_lookup_status !~ '^[0-9]{1,4}$'
 OR p_transaction_status IS NOT NULL AND p_transaction_status !~ '^[0-9]{1,4}$' THEN RAISE EXCEPTION 'live_invalid_observation' USING ERRCODE='23514'; END IF;
 SELECT * INTO STRICT a FROM public.pelecard_live_attempts WHERE payment_id=p_payment_id FOR UPDATE;
 IF a.closed_unpaid_at IS NOT NULL THEN RETURN jsonb_build_object('id',p_payment_id,'hosted_state','expired','can_replace',public.can_replace_pelecard_live(a.order_id,p_payment_id)); END IF;
 -- Expiry is monotonic: a stale concurrent verifier cannot revive the page.
 p_hosted_state:=CASE WHEN a.hosted_state='expired' OR a.hosted_expires_at<=clock_timestamp() THEN 'expired' ELSE coalesce(p_hosted_state,a.hosted_state) END;
 UPDATE public.pelecard_live_attempts SET hosted_state=p_hosted_state,last_lookup_status=p_lookup_status,
 last_transaction_status=p_transaction_status,correlation_valid=p_correlation_valid,updated_at=clock_timestamp() WHERE payment_id=p_payment_id;
 INSERT INTO public.pelecard_live_audit(payment_id,event_type,hosted_state,lookup_status,transaction_status,correlation_valid)
 VALUES(p_payment_id,'observed',p_hosted_state,p_lookup_status,p_transaction_status,p_correlation_valid);
 RETURN jsonb_build_object('id',p_payment_id,'hosted_state',coalesce(p_hosted_state,a.hosted_state),'can_replace',false);
END $$;
CREATE OR REPLACE FUNCTION public.finalize_pelecard_live(p_payment_id uuid,p_provider_transaction_id text,p_approval_id text,p_provider_status_code text,p_amount numeric,p_currency text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.pelecard_live_attempts%ROWTYPE; p public.payment_transactions%ROWTYPE; result jsonb;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.orders o JOIN public.pelecard_live_attempts la ON la.order_id=o.id WHERE la.payment_id=p_payment_id FOR UPDATE OF o;
 SELECT * INTO STRICT a FROM public.pelecard_live_attempts WHERE payment_id=p_payment_id FOR UPDATE;
 SELECT * INTO STRICT p FROM public.payment_transactions WHERE id=p_payment_id FOR UPDATE;
 IF a.closed_unpaid_at IS NOT NULL THEN RAISE EXCEPTION 'live_closed_terminal' USING ERRCODE='23514'; END IF;
 IF a.transaction_id IS NULL OR a.transaction_id IS DISTINCT FROM p_provider_transaction_id OR a.dispatch_started_at IS NULL
 OR a.correlation_valid IS DISTINCT FROM true OR a.last_lookup_status IS DISTINCT FROM '000' OR a.last_transaction_status IS DISTINCT FROM '000'
 OR p.amount IS DISTINCT FROM p_amount OR p.currency IS DISTINCT FROM p_currency OR p_currency IS DISTINCT FROM 'ILS' OR p_provider_status_code IS DISTINCT FROM '000'
 THEN RAISE EXCEPTION 'live_verification_mismatch' USING ERRCODE='23514'; END IF;
 result:=public.finalize_pelecard_payment(p_payment_id,p_provider_transaction_id,p_approval_id,p_provider_status_code,p_amount,p_currency);
 IF p.status<>'succeeded' THEN INSERT INTO public.pelecard_live_audit(payment_id,event_type) VALUES(p_payment_id,'finalized'); END IF;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.guard_pelecard_live_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.pelecard_live_attempts%ROWTYPE; reserved_order uuid;
BEGIN
 IF TG_OP='INSERT' THEN
  FOR reserved_order IN SELECT id FROM public.orders WHERE id=NEW.order_id OR order_number=NEW.checkout_snapshot->'linked_order_info'->>'order_number' ORDER BY id FOR UPDATE LOOP
  IF EXISTS(SELECT 1 FROM public.pelecard_live_attempts WHERE order_id=reserved_order AND payment_id<>NEW.id AND (closed_unpaid_at IS NULL OR NOT EXISTS(SELECT 1 FROM public.pelecard_live_attempts own WHERE own.payment_id=NEW.id AND own.order_id=reserved_order))) THEN RAISE EXCEPTION 'live_attempt_already_reserved' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NEW;
 END IF;
 SELECT * INTO a FROM public.pelecard_live_attempts WHERE payment_id=OLD.id;
 IF NOT FOUND THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'live_identity_immutable' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.id,NEW.order_id,NEW.amount,NEW.currency,NEW.checkout_snapshot,NEW.created_by,NEW.provider,NEW.operation,NEW.idempotency_key)
 IS DISTINCT FROM ROW(OLD.id,OLD.order_id,OLD.amount,OLD.currency,OLD.checkout_snapshot,OLD.created_by,OLD.provider,OLD.operation,OLD.idempotency_key)
 THEN RAISE EXCEPTION 'live_identity_immutable' USING ERRCODE='23514'; END IF;
 IF a.closed_unpaid_at IS NOT NULL AND (NEW.status<>'expired' OR NEW.sale_id IS NOT NULL OR NEW.approval_id IS NOT NULL OR NEW.provider_status_code='000' OR NEW.provider_transaction_id IS NOT NULL) THEN
 RAISE EXCEPTION 'live_closed_terminal' USING ERRCODE='23514'; END IF;
 IF NEW.status='expired' AND (a.closed_unpaid_at IS NULL OR NOT EXISTS(SELECT 1 FROM public.pelecard_live_unpaid_confirmations e WHERE e.payment_id=OLD.id)) THEN
 RAISE EXCEPTION 'live_confirmation_required' USING ERRCODE='23514'; END IF;
 IF OLD.status='expired' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'live_closed_terminal' USING ERRCODE='23514'; END IF;
 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('pending_provider','succeeded','timed_out','expired') THEN RAISE EXCEPTION 'live_financial_transition_forbidden' USING ERRCODE='23514'; END IF;
 IF (NEW.provider_session_id IS NOT NULL AND NEW.provider_session_id IS DISTINCT FROM a.transaction_id)
 OR (NEW.status='succeeded' AND (a.transaction_id IS NULL OR NEW.provider_transaction_id IS DISTINCT FROM a.transaction_id
 OR NEW.provider_status_code IS DISTINCT FROM '000' OR a.correlation_valid IS DISTINCT FROM true OR a.last_lookup_status IS DISTINCT FROM '000' OR a.last_transaction_status IS DISTINCT FROM '000'))
 THEN RAISE EXCEPTION 'live_verification_mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.guard_pelecard_live_sale() RETURNS trigger
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
  IF EXISTS(SELECT 1 FROM public.pelecard_live_attempts WHERE order_id=o.id) THEN
   SELECT * INTO a FROM public.pelecard_live_attempts WHERE order_id=o.id AND payment_id=NEW.payment_transaction_id;
   IF NOT FOUND OR a.closed_unpaid_at IS NOT NULL THEN RAISE EXCEPTION 'live_order_sale_reserved' USING ERRCODE='23514'; END IF;
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
CREATE OR REPLACE FUNCTION public.guard_pelecard_controlled_live_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.pelecard_controlled_live_control%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.order_id='a57ebbc6-47a9-4e74-9208-3340f8508df7' THEN
      -- Shares the same serialization point as the existing order reservation.
      PERFORM 1 FROM public.orders WHERE id=NEW.order_id FOR UPDATE;
      IF EXISTS(SELECT 1 FROM public.pelecard_controlled_live_control WHERE payment_id IS NOT NULL AND payment_id<>NEW.id
       AND NOT EXISTS(SELECT 1 FROM public.pelecard_live_attempts prior JOIN public.pelecard_live_unpaid_confirmations e ON e.payment_id=prior.payment_id
         JOIN public.pelecard_live_attempts own ON own.payment_id=NEW.id AND own.order_id=NEW.order_id
         WHERE prior.payment_id=pelecard_controlled_live_control.payment_id AND prior.closed_unpaid_at IS NOT NULL)) THEN
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
 'init_enabled',public.can_replace_pelecard_live(o.id,p.id) OR (c.order_id IS NULL AND p.id IS NULL AND o.payment_status='לא שולם' AND o.status NOT IN ('שולם','בוטל') AND o.total_price>0
 AND NOT EXISTS(SELECT 1 FROM public.payment_transactions x WHERE x.order_id=o.id OR x.checkout_snapshot->'linked_order_info'->>'order_number'=o.order_number)
 AND NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.order_id=o.id OR s.linked_order_info->>'order_number'=o.order_number)),
 'hosted_expires_at',a.hosted_expires_at,'closed_unpaid_at',a.closed_unpaid_at,
 'hosted_state',CASE WHEN a.hosted_expires_at<=statement_timestamp() THEN 'expired' ELSE coalesce(a.hosted_state,'unknown') END,'last_lookup_status',a.last_lookup_status,'last_transaction_status',a.last_transaction_status,
 'correlation_valid',a.correlation_valid,'can_replace',public.can_replace_pelecard_live(o.id,p.id))
 INTO result FROM public.orders o LEFT JOIN LATERAL(SELECT pt.* FROM public.payment_transactions pt WHERE pt.order_id=o.id AND pt.provider='pelecard' AND pt.operation='payment' ORDER BY coalesce((SELECT la.created_at FROM public.pelecard_live_attempts la WHERE la.payment_id=pt.id),pt.created_at) DESC,pt.id DESC LIMIT 1)p ON true
 LEFT JOIN public.pelecard_live_attempts a ON a.payment_id=p.id LEFT JOIN public.pelecard_controlled_live_control c ON c.order_id=o.id WHERE o.id=p_order_id;
 RETURN result;
END $$;

CREATE FUNCTION public.close_pelecard_live_expired_unpaid(
 p_order_id uuid,p_payment_id uuid,p_provider_transaction_id text,
 p_confirmation_source text,p_confirmation_date date,p_confirmation_reference text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; a public.pelecard_live_attempts%ROWTYPE; p public.payment_transactions%ROWTYPE;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 SELECT * INTO STRICT a FROM public.pelecard_live_attempts WHERE payment_id=p_payment_id FOR UPDATE;
 SELECT * INTO STRICT p FROM public.payment_transactions WHERE id=p_payment_id FOR UPDATE;
 IF a.order_id IS DISTINCT FROM p_order_id OR p.order_id IS DISTINCT FROM p_order_id
 OR a.transaction_id IS DISTINCT FROM p_provider_transaction_id OR a.transaction_id IS NULL
 OR p.provider_session_id IS DISTINCT FROM a.transaction_id THEN RAISE EXCEPTION 'live_attempt_mismatch' USING ERRCODE='23514'; END IF;
 IF a.closed_unpaid_at IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.pelecard_live_unpaid_confirmations e WHERE e.payment_id=p_payment_id
   AND e.confirmation_source=p_confirmation_source AND e.confirmation_date=p_confirmation_date
   AND e.confirmation_reference=p_confirmation_reference) THEN RAISE EXCEPTION 'live_confirmation_conflict' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('id',p_payment_id,'hosted_state','expired','closed_unpaid_at',a.closed_unpaid_at,'can_replace',public.can_replace_pelecard_live(p_order_id,p_payment_id));
 END IF;
 IF a.hosted_expires_at IS NULL OR a.hosted_expires_at>clock_timestamp()
 OR p.status NOT IN ('initiated','pending_provider','timed_out') OR p.sale_id IS NOT NULL
 OR p.approval_id IS NOT NULL OR p.verified_at IS NOT NULL OR p.provider_transaction_id IS NOT NULL OR p.provider_status_code='000'
 OR a.last_transaction_status='000'
 OR EXISTS(SELECT 1 FROM public.pelecard_live_audit audit WHERE audit.payment_id=p_payment_id AND (audit.transaction_status='000' OR audit.event_type='finalized'))
 OR o.payment_status IS DISTINCT FROM 'לא שולם' OR o.status IN ('שולם','בוטל')
 OR EXISTS(SELECT 1 FROM public.sales s WHERE s.order_id=o.id OR s.linked_order_info->>'order_number'=o.order_number OR s.payment_transaction_id=p_payment_id)
 OR p_payment_id IS DISTINCT FROM (SELECT la.payment_id FROM public.pelecard_live_attempts la WHERE la.order_id=o.id ORDER BY la.created_at DESC,la.payment_id DESC LIMIT 1)
 THEN RAISE EXCEPTION 'live_unpaid_closure_forbidden' USING ERRCODE='23514'; END IF;
 IF p_confirmation_source IS NULL OR p_confirmation_source NOT IN ('provider_phone_confirmation','provider_written_confirmation')
 OR p_confirmation_date IS NULL OR p_confirmation_date<a.dispatch_started_at::date OR p_confirmation_date>CURRENT_DATE
 OR p_confirmation_reference IS NULL OR length(btrim(p_confirmation_reference)) NOT BETWEEN 12 AND 2000
 THEN RAISE EXCEPTION 'live_confirmation_required' USING ERRCODE='23514'; END IF;
 INSERT INTO public.pelecard_live_unpaid_confirmations(payment_id,provider_transaction_id,confirmation_source,confirmation_date,confirmation_reference)
 VALUES(p_payment_id,p_provider_transaction_id,p_confirmation_source,p_confirmation_date,p_confirmation_reference);
 UPDATE public.pelecard_live_attempts SET closed_unpaid_at=clock_timestamp(),hosted_state='expired',updated_at=clock_timestamp() WHERE payment_id=p_payment_id RETURNING * INTO a;
 UPDATE public.payment_transactions SET status='expired' WHERE id=p_payment_id;
 INSERT INTO public.pelecard_live_audit(payment_id,event_type,hosted_state) VALUES(p_payment_id,'closed_unpaid','expired');
 RETURN jsonb_build_object('id',p_payment_id,'hosted_state','expired','closed_unpaid_at',a.closed_unpaid_at,'can_replace',public.can_replace_pelecard_live(p_order_id,p_payment_id));
END $$;
REVOKE ALL ON FUNCTION public.can_replace_pelecard_live(uuid,uuid),public.close_pelecard_live_expired_unpaid(uuid,uuid,text,text,date,text),public.get_pelecard_live_attempt(uuid) FROM PUBLIC,anon,authenticated,service_role,pelecard_controlled_live_adapter;
GRANT EXECUTE ON FUNCTION public.close_pelecard_live_expired_unpaid(uuid,uuid,text,text,date,text),public.get_pelecard_live_attempt(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_pelecard_live_attempt(uuid) TO pelecard_controlled_live_adapter;
NOTIFY pgrst,'reload schema';
COMMIT;
