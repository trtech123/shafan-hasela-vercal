-- Prospective Cash Register checkout. Applying this migration does not start a
-- payment or enable Payper. The owner confirmed regular VAT for all POS items.
BEGIN;

CREATE TABLE public.pos_pelecard_intents (
  payment_id uuid PRIMARY KEY REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
  request_key uuid NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  source_lines jsonb NOT NULL,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  vat_applicable boolean NOT NULL,
  billing_kind text CHECK (billing_kind IN ('person','organization')),
  billing_name text,
  billing_identity text,
  billing_email text,
  dispatch_started_at timestamptz,
  transaction_id text UNIQUE,
  confirmation_key text,
  hosted_expires_at timestamptz,
  hosted_state text NOT NULL DEFAULT 'unknown' CHECK (hosted_state IN ('unknown','usable','expired')),
  last_lookup_status text,
  last_transaction_status text,
  correlation_valid boolean,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((transaction_id IS NULL AND confirmation_key IS NULL) OR
    (transaction_id IS NOT NULL AND confirmation_key IS NOT NULL AND dispatch_started_at IS NOT NULL))
);
ALTER TABLE public.pos_pelecard_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_pelecard_intents FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_pelecard_intents FROM PUBLIC,anon,authenticated,service_role,pelecard_controlled_live_adapter;

CREATE FUNCTION public.guard_pos_pelecard_intent() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'pos_intent_immutable' USING ERRCODE='23514'; END IF;
  IF ROW(NEW.payment_id,NEW.request_key,NEW.created_by,NEW.source_lines,NEW.amount,NEW.vat_applicable,
    NEW.billing_kind,NEW.billing_name,NEW.billing_identity,NEW.billing_email,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.payment_id,OLD.request_key,OLD.created_by,OLD.source_lines,OLD.amount,OLD.vat_applicable,
    OLD.billing_kind,OLD.billing_name,OLD.billing_identity,OLD.billing_email,OLD.created_at)
    OR (OLD.dispatch_started_at IS NOT NULL AND NEW.dispatch_started_at IS DISTINCT FROM OLD.dispatch_started_at)
    OR (OLD.transaction_id IS NOT NULL AND ROW(NEW.transaction_id,NEW.confirmation_key,NEW.hosted_expires_at)
      IS DISTINCT FROM ROW(OLD.transaction_id,OLD.confirmation_key,OLD.hosted_expires_at))
  THEN RAISE EXCEPTION 'pos_intent_immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_pos_pelecard_intent BEFORE UPDATE OR DELETE ON public.pos_pelecard_intents
  FOR EACH ROW EXECUTE FUNCTION public.guard_pos_pelecard_intent();
REVOKE ALL ON FUNCTION public.guard_pos_pelecard_intent() FROM PUBLIC,anon,authenticated,service_role;

-- No browser amount, name, price or VAT value is accepted. The only payable
-- values are catalog rows read and frozen inside this transaction.
CREATE FUNCTION public.reserve_pos_pelecard(
  p_actor_id uuid, p_request_key uuid, p_lines jsonb, p_discount jsonb, p_billing jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  role_name text; line jsonb; catalog_id uuid; kind text; qty integer;
  item_name text; unit_price numeric; cart_vat boolean:=true;
  subtotal numeric:=0; total numeric; deduction numeric:=0;
  frozen jsonb:='[]'::jsonb; intent public.pos_pelecard_intents%ROWTYPE;
  payment_id uuid;
  billing_kind text; billing_name text; billing_identity text; billing_email text;
  discount_snapshot jsonb;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT role::text INTO role_name FROM public.profiles WHERE id=p_actor_id FOR UPDATE;
  IF role_name IS NULL OR role_name NOT IN ('admin','cashier') OR p_request_key IS NULL THEN RAISE EXCEPTION 'pos_payment_forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO intent FROM public.pos_pelecard_intents WHERE request_key=p_request_key;
  IF FOUND THEN
    IF intent.created_by IS DISTINCT FROM p_actor_id THEN RAISE EXCEPTION 'request_key_conflict' USING ERRCODE='23514'; END IF;
    RETURN pg_catalog.jsonb_build_object('paymentId',intent.payment_id,'created',false,'amountMinor',(intent.amount*100)::integer);
  END IF;
  IF EXISTS (SELECT 1 FROM public.pos_pelecard_intents i JOIN public.payment_transactions p ON p.id=i.payment_id
    WHERE i.created_by=p_actor_id AND p.status IN ('initiated','pending_provider','timed_out'))
  THEN RAISE EXCEPTION 'pos_payment_in_progress' USING ERRCODE='23514'; END IF;
  IF pg_catalog.jsonb_typeof(p_lines)<>'array' OR pg_catalog.jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100
  THEN RAISE EXCEPTION 'cart_invalid' USING ERRCODE='23514'; END IF;
  FOR line IN SELECT value FROM pg_catalog.jsonb_array_elements(p_lines) LOOP
    IF pg_catalog.jsonb_typeof(line)<>'object' OR
      (SELECT pg_catalog.array_agg(key ORDER BY key) FROM pg_catalog.jsonb_object_keys(line) key)
       IS DISTINCT FROM ARRAY['id','kind','qty']::text[] OR
      line->>'id' !~ '^[0-9a-fA-F-]{36}$' OR line->>'kind' IS NULL OR
      line->>'kind' NOT IN ('product','service') OR
      pg_catalog.jsonb_typeof(line->'qty')<>'number' OR line->>'qty' !~ '^[0-9]{1,4}$'
    THEN RAISE EXCEPTION 'cart_line_invalid' USING ERRCODE='23514'; END IF;
    catalog_id:=(line->>'id')::uuid; kind:=line->>'kind'; qty:=(line->>'qty')::integer;
    IF qty NOT BETWEEN 1 AND 1000 OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(frozen) prior
      WHERE prior.value->>'id'=catalog_id::text)
    THEN RAISE EXCEPTION 'cart_line_invalid' USING ERRCODE='23514'; END IF;
    IF kind='product' THEN
      SELECT nullif(pg_catalog.btrim(name),''),price INTO item_name,unit_price
      FROM public.products WHERE id=catalog_id AND status='פעיל' FOR SHARE;
    ELSE
      SELECT nullif(pg_catalog.btrim(name),''),price_per_person INTO item_name,unit_price
      FROM public.activities WHERE id=catalog_id AND status='פעיל' FOR SHARE;
    END IF;
    IF item_name IS NULL OR pg_catalog.length(item_name)>200 OR unit_price IS NULL OR unit_price<=0
      OR unit_price*100<>pg_catalog.trunc(unit_price*100)
    THEN RAISE EXCEPTION 'catalog_item_unavailable' USING ERRCODE='23514'; END IF;
    subtotal:=subtotal+unit_price*qty;
    IF subtotal*100>2147483647 THEN RAISE EXCEPTION 'cart_amount_invalid' USING ERRCODE='23514'; END IF;
    frozen:=frozen||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id',catalog_id::text,'name',item_name,'qty',qty,'customPrice',unit_price));
  END LOOP;
  IF p_discount IS NOT NULL AND p_discount<>'null'::jsonb THEN
    IF role_name<>'admin' OR pg_catalog.jsonb_typeof(p_discount)<>'object' OR
      (SELECT pg_catalog.array_agg(key ORDER BY key) FROM pg_catalog.jsonb_object_keys(p_discount) key)
       IS DISTINCT FROM ARRAY['mode','type','value']::text[] OR
      p_discount->>'type' IS NULL OR p_discount->>'type' NOT IN ('הנחת עובד','הנחת נכה','הנחה כללית') OR
      p_discount->>'mode' IS NULL OR p_discount->>'mode' NOT IN ('fixed','percentage') OR
      pg_catalog.jsonb_typeof(p_discount->'value')<>'number' OR
      p_discount->>'value' !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$'
    THEN RAISE EXCEPTION 'discount_invalid' USING ERRCODE='23514'; END IF;
    IF p_discount->>'mode'='fixed' THEN deduction:=(p_discount->>'value')::numeric;
    ELSE
      IF (p_discount->>'value')::numeric>100 THEN RAISE EXCEPTION 'discount_invalid' USING ERRCODE='23514'; END IF;
      deduction:=pg_catalog.round(subtotal*(p_discount->>'value')::numeric/100,2);
    END IF;
    IF deduction<=0 THEN RAISE EXCEPTION 'discount_invalid' USING ERRCODE='23514'; END IF;
    discount_snapshot:=p_discount||pg_catalog.jsonb_build_object('original_total',subtotal,'final_total',subtotal-deduction);
  END IF;
  total:=subtotal-deduction;
  IF total<=0 OR total*100>2147483647 THEN RAISE EXCEPTION 'cart_amount_invalid' USING ERRCODE='23514'; END IF;
  billing_kind:=nullif(p_billing->>'kind','');
  IF billing_kind NOT IN ('person','organization') THEN billing_kind:=NULL; END IF;
  billing_name:=nullif(pg_catalog.btrim(p_billing->>'name'),'');
  IF pg_catalog.length(billing_name)>200 THEN billing_name:=NULL; END IF;
  billing_identity:=nullif(pg_catalog.btrim(p_billing->>'identity'),'');
  IF billing_identity !~ '^[0-9]{9}$' OR billing_identity='000000000' OR
    (billing_kind='person' AND NOT public.payper_valid_person_identity(billing_identity))
  THEN billing_identity:=NULL; END IF;
  billing_email:=nullif(pg_catalog.btrim(p_billing->>'email'),'');
  IF pg_catalog.length(billing_email)>320 OR billing_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  THEN billing_email:=NULL; END IF;
  payment_id:=pg_catalog.gen_random_uuid();
  INSERT INTO public.payment_transactions(id,provider,operation,order_id,amount,currency,status,
    idempotency_key,checkout_snapshot,created_by)
  VALUES(payment_id,'pelecard','payment',NULL,total,'ILS','initiated',
    'pos-'||payment_id::text,pg_catalog.jsonb_build_object('schema_version',1,'items',frozen,
      'discount',discount_snapshot,'linked_order_info',NULL,'sale_date',
      (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::date::text),p_actor_id);
  INSERT INTO public.pos_pelecard_intents(payment_id,request_key,created_by,source_lines,amount,vat_applicable,
    billing_kind,billing_name,billing_identity,billing_email)
  VALUES(payment_id,p_request_key,p_actor_id,p_lines,total,cart_vat,
    billing_kind,billing_name,billing_identity,billing_email);
  INSERT INTO public.payper_payment_billing_snapshots(payment_id,order_id,customer_kind,
    billing_name,billing_identity,billing_email,vat_applicable)
  VALUES(payment_id,NULL,billing_kind,billing_name,billing_identity,billing_email,cart_vat);
  RETURN pg_catalog.jsonb_build_object('paymentId',payment_id,'created',true,'amountMinor',(total*100)::integer);
END $$;
REVOKE ALL ON FUNCTION public.reserve_pos_pelecard(uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_pos_pelecard(uuid,uuid,jsonb,jsonb,jsonb) TO service_role;

ALTER TABLE public.payper_payment_billing_snapshots ALTER COLUMN order_id DROP NOT NULL;

-- The Node gateway adapter has a restricted database login. Each claim is
-- one-shot: an uncertain init remains reserved for reconciliation.
CREATE FUNCTION public.claim_pos_pelecard_init(p_payment_id uuid)
RETURNS TABLE(amount_minor integer,currency text) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.pos_pelecard_intents%ROWTYPE; p public.payment_transactions%ROWTYPE;
BEGIN
  SELECT * INTO i FROM public.pos_pelecard_intents WHERE payment_id=p_payment_id FOR UPDATE;
  IF NOT FOUND OR i.dispatch_started_at IS NOT NULL THEN RETURN; END IF;
  SELECT * INTO p FROM public.payment_transactions WHERE id=p_payment_id FOR UPDATE;
  IF p.order_id IS NOT NULL OR p.status<>'initiated' OR p.amount IS DISTINCT FROM i.amount OR
    p.currency<>'ILS' OR p.provider<>'pelecard' OR p.operation<>'payment' OR p.provider_session_id IS NOT NULL
  THEN RETURN; END IF;
  UPDATE public.pos_pelecard_intents SET dispatch_started_at=pg_catalog.clock_timestamp() WHERE payment_id=p_payment_id;
  RETURN QUERY SELECT (p.amount*100)::integer,p.currency;
END $$;
REVOKE ALL ON FUNCTION public.claim_pos_pelecard_init(uuid) FROM PUBLIC,anon,authenticated,service_role,pelecard_controlled_live_adapter;
GRANT EXECUTE ON FUNCTION public.claim_pos_pelecard_init(uuid) TO pelecard_controlled_live_adapter;

CREATE FUNCTION public.get_pos_pelecard_attempt(p_payment_id uuid)
RETURNS TABLE(payment_id uuid,amount_minor integer,currency text,transaction_id text,confirmation_key text,
  hosted_state text,hosted_expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT p.id,(p.amount*100)::integer,p.currency,i.transaction_id,i.confirmation_key,
    CASE WHEN i.hosted_expires_at<=pg_catalog.clock_timestamp() THEN 'expired' ELSE i.hosted_state END,
    i.hosted_expires_at
  FROM public.pos_pelecard_intents i JOIN public.payment_transactions p ON p.id=i.payment_id
  WHERE p.id=p_payment_id AND p.order_id IS NULL AND p.currency='ILS' AND p.provider='pelecard'
    AND p.operation='payment' AND i.transaction_id IS NOT NULL AND i.confirmation_key IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.get_pos_pelecard_attempt(uuid) FROM PUBLIC,anon,authenticated,service_role,pelecard_controlled_live_adapter;
GRANT EXECUTE ON FUNCTION public.get_pos_pelecard_attempt(uuid) TO service_role,pelecard_controlled_live_adapter;

CREATE FUNCTION public.persist_pos_pelecard_session(p_payment_id uuid,p_transaction_id text,p_confirmation_key text,p_url text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.pos_pelecard_intents%ROWTYPE; p public.payment_transactions%ROWTYPE;
BEGIN
  SELECT * INTO STRICT i FROM public.pos_pelecard_intents WHERE payment_id=p_payment_id FOR UPDATE;
  SELECT * INTO STRICT p FROM public.payment_transactions WHERE id=p_payment_id FOR UPDATE;
  IF i.dispatch_started_at IS NULL OR p.order_id IS NOT NULL OR p.amount IS DISTINCT FROM i.amount OR
    p.status NOT IN ('initiated','pending_provider') OR p.currency<>'ILS' OR p.operation<>'payment'
  THEN RAISE EXCEPTION 'pos_session_mismatch' USING ERRCODE='23514'; END IF;
  IF p_transaction_id IS NULL OR p_transaction_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' OR
    p_confirmation_key IS NULL OR pg_catalog.length(p_confirmation_key) NOT BETWEEN 1 AND 512 OR
    p_confirmation_key !~ '^[A-Za-z0-9_+/=-]+$' OR
    p_url IS DISTINCT FROM 'https://gateway20.pelecard.biz/PaymentGW?transactionId='||p_transaction_id
  THEN RAISE EXCEPTION 'pos_session_invalid' USING ERRCODE='23514'; END IF;
  IF i.transaction_id IS NOT NULL THEN
    IF ROW(i.transaction_id,i.confirmation_key) IS DISTINCT FROM ROW(p_transaction_id,p_confirmation_key)
    THEN RAISE EXCEPTION 'pos_session_conflict' USING ERRCODE='23514'; END IF;
    RETURN to_jsonb(p);
  END IF;
  UPDATE public.pos_pelecard_intents SET transaction_id=p_transaction_id,confirmation_key=p_confirmation_key,
    hosted_state='usable',hosted_expires_at=pg_catalog.clock_timestamp()+interval '15 minutes' WHERE payment_id=p_payment_id;
  UPDATE public.payment_transactions SET provider_session_id=p_transaction_id,provider_redirect_url=p_url,
    status='pending_provider' WHERE id=p_payment_id RETURNING * INTO p;
  RETURN to_jsonb(p);
END $$;
REVOKE ALL ON FUNCTION public.persist_pos_pelecard_session(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role,pelecard_controlled_live_adapter;
GRANT EXECUTE ON FUNCTION public.persist_pos_pelecard_session(uuid,text,text,text) TO pelecard_controlled_live_adapter;

CREATE FUNCTION public.observe_pos_pelecard(p_payment_id uuid,p_hosted_state text,p_lookup_status text,
  p_transaction_status text,p_correlation_valid boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.pos_pelecard_intents%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF p_hosted_state NOT IN ('unknown','usable','expired') OR
    p_lookup_status IS NOT NULL AND p_lookup_status !~ '^[0-9]{1,4}$' OR
    p_transaction_status IS NOT NULL AND p_transaction_status !~ '^[0-9]{1,4}$'
  THEN RAISE EXCEPTION 'observation_invalid' USING ERRCODE='23514'; END IF;
  SELECT * INTO STRICT i FROM public.pos_pelecard_intents WHERE payment_id=p_payment_id FOR UPDATE;
  UPDATE public.pos_pelecard_intents SET hosted_state=CASE WHEN i.hosted_state='expired' THEN 'expired' ELSE p_hosted_state END,
    last_lookup_status=p_lookup_status,last_transaction_status=p_transaction_status,
    correlation_valid=p_correlation_valid WHERE payment_id=p_payment_id;
  RETURN pg_catalog.jsonb_build_object('paymentId',p_payment_id,'approved',p_lookup_status='000' AND
    p_transaction_status='000' AND p_correlation_valid);
END $$;
REVOKE ALL ON FUNCTION public.observe_pos_pelecard(uuid,text,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.observe_pos_pelecard(uuid,text,text,text,boolean) TO service_role;

-- Existing atomic finalizer creates exactly one sale while holding the payment
-- row lock. The POS fence below requires prior provider correlation evidence.
CREATE FUNCTION public.finalize_pos_pelecard(p_payment_id uuid,p_approval_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.pos_pelecard_intents%ROWTYPE; p public.payment_transactions%ROWTYPE; result jsonb;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT i FROM public.pos_pelecard_intents WHERE payment_id=p_payment_id FOR UPDATE;
  SELECT * INTO STRICT p FROM public.payment_transactions WHERE id=p_payment_id FOR UPDATE;
  IF p.status='succeeded' THEN
    RETURN to_jsonb(p)||(SELECT pg_catalog.jsonb_build_object('receipt_number',s.receipt_number)
      FROM public.sales s WHERE s.id=p.sale_id);
  END IF;
  IF i.transaction_id IS NULL OR i.correlation_valid IS DISTINCT FROM true OR
    i.last_lookup_status IS DISTINCT FROM '000' OR i.last_transaction_status IS DISTINCT FROM '000' OR
    p.provider_session_id IS DISTINCT FROM i.transaction_id OR p.amount IS DISTINCT FROM i.amount OR
    p.status<>'pending_provider'
  THEN RAISE EXCEPTION 'pos_verification_required' USING ERRCODE='23514'; END IF;
  result:=public.finalize_pelecard_payment(p_payment_id,i.transaction_id,p_approval_id,'000',i.amount,'ILS');
  UPDATE public.sales SET sale_date=(pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::date
    WHERE id=(result->>'sale_id')::uuid;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.finalize_pos_pelecard(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finalize_pos_pelecard(uuid,text) TO service_role;

CREATE FUNCTION public.guard_pos_pelecard_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.pos_pelecard_intents%ROWTYPE;
BEGIN
  SELECT * INTO i FROM public.pos_pelecard_intents WHERE payment_id=OLD.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF ROW(NEW.order_id,NEW.amount,NEW.currency,NEW.checkout_snapshot,NEW.created_by,NEW.idempotency_key)
    IS DISTINCT FROM ROW(OLD.order_id,OLD.amount,OLD.currency,OLD.checkout_snapshot,OLD.created_by,OLD.idempotency_key)
    OR NEW.status NOT IN ('initiated','pending_provider','timed_out','succeeded','failed') OR
    (NEW.status='failed' AND (i.dispatch_started_at IS NOT NULL OR OLD.status<>'initiated')) OR
    (NEW.status='succeeded' AND (i.correlation_valid IS DISTINCT FROM true OR
      i.last_lookup_status IS DISTINCT FROM '000' OR i.last_transaction_status IS DISTINCT FROM '000' OR
      NEW.provider_transaction_id IS DISTINCT FROM i.transaction_id))
  THEN RAISE EXCEPTION 'pos_payment_immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_pos_pelecard_payment BEFORE UPDATE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_pos_pelecard_payment();
REVOKE ALL ON FUNCTION public.guard_pos_pelecard_payment() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.guard_pos_pelecard_sale() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.pos_pelecard_intents%ROWTYPE;
BEGIN
  IF NEW.payment_transaction_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO i FROM public.pos_pelecard_intents WHERE payment_id=NEW.payment_transaction_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF coalesce(auth.role(),'')<>'service_role' OR NEW.order_id IS NOT NULL OR
    NEW.method<>'פלאקארד' OR NEW.total IS DISTINCT FROM i.amount OR
    i.correlation_valid IS DISTINCT FROM true OR i.last_lookup_status IS DISTINCT FROM '000' OR
    i.last_transaction_status IS DISTINCT FROM '000'
  THEN RAISE EXCEPTION 'pos_sale_not_verified' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_pos_pelecard_sale BEFORE INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.guard_pos_pelecard_sale();
REVOKE ALL ON FUNCTION public.guard_pos_pelecard_sale() FROM PUBLIC,anon,authenticated,service_role;

-- A POS payment belongs to the Payper/manual-review path even while the
-- activation cutoff is NULL. The pre-existing Rivhit cutoff fence only covers
-- post-cutoff payments, so hold POS Rivhit events independently of that cutoff.
CREATE FUNCTION public.hold_pos_rivhit_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.accounting_provider='rivhit' AND NEW.purpose='payment_success' AND
    ((NEW.source_type='payment_transaction' AND EXISTS
      (SELECT 1 FROM public.pos_pelecard_intents i WHERE i.payment_id::text=NEW.source_id)) OR
     (NEW.source_type='sale' AND EXISTS
      (SELECT 1 FROM public.pos_pelecard_intents i JOIN public.payment_transactions p ON p.id=i.payment_id
       WHERE p.sale_id::text=NEW.source_id)))
  THEN
    IF TG_OP='INSERT' THEN
      NEW.status:='configuration_required';
      NEW.last_error:='{"code":"pos_payper_only"}'::jsonb;
    ELSIF NEW.status='processing' THEN
      RAISE EXCEPTION 'pos_rivhit_issuance_held' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_hold_pos_rivhit_event BEFORE INSERT OR UPDATE OF status ON public.accounting_events
  FOR EACH ROW EXECUTE FUNCTION public.hold_pos_rivhit_event();
REVOKE ALL ON FUNCTION public.hold_pos_rivhit_event() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.hold_pos_rivhit_document() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.provider='rivhit' AND NEW.status='processing' AND
    ((NEW.source_type='payment_transaction' AND EXISTS
      (SELECT 1 FROM public.pos_pelecard_intents i WHERE i.payment_id::text=NEW.source_id)) OR
     (NEW.source_type='sale' AND EXISTS
      (SELECT 1 FROM public.pos_pelecard_intents i JOIN public.payment_transactions p ON p.id=i.payment_id
       WHERE p.sale_id::text=NEW.source_id)))
  THEN RAISE EXCEPTION 'pos_rivhit_issuance_held' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_hold_pos_rivhit_document BEFORE INSERT OR UPDATE OF status ON public.accounting_documents
  FOR EACH ROW EXECUTE FUNCTION public.hold_pos_rivhit_document();
REVOKE ALL ON FUNCTION public.hold_pos_rivhit_document() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_pos_pelecard_view(p_payment_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
    (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text IN ('admin','cashier'))
  THEN RAISE EXCEPTION 'pos_view_forbidden' USING ERRCODE='42501'; END IF;
  SELECT pg_catalog.jsonb_build_object('paymentId',p.id,'amountMinor',(p.amount*100)::integer,
    'currency',p.currency,'status',p.status,'saleId',p.sale_id,'receiptNumber',s.receipt_number,
    'dispatchStarted',i.dispatch_started_at IS NOT NULL,
    'hostedState',i.hosted_state,'hostedExpiresAt',i.hosted_expires_at,
    'canVerify',i.transaction_id IS NOT NULL AND p.status='pending_provider',
    'redirectUrl',CASE WHEN i.transaction_id IS NOT NULL AND i.hosted_state='usable'
      AND i.hosted_expires_at>pg_catalog.clock_timestamp() THEN p.provider_redirect_url ELSE NULL END)
    INTO result FROM public.pos_pelecard_intents i JOIN public.payment_transactions p ON p.id=i.payment_id
    LEFT JOIN public.sales s ON s.id=p.sale_id WHERE i.payment_id=p_payment_id AND
      (i.created_by=p_actor_id OR EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin'));
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_pos_pelecard_view(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_pos_pelecard_view(uuid,uuid) TO service_role;

CREATE FUNCTION public.get_pos_pelecard_view_by_request(p_request_key uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE payment_id uuid;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT i.payment_id INTO payment_id FROM public.pos_pelecard_intents i WHERE i.request_key=p_request_key
    AND (i.created_by=p_actor_id OR EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin'));
  IF payment_id IS NULL THEN RETURN NULL; END IF;
  RETURN public.get_pos_pelecard_view(payment_id,p_actor_id);
END $$;
REVOKE ALL ON FUNCTION public.get_pos_pelecard_view_by_request(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_pos_pelecard_view_by_request(uuid,uuid) TO service_role;

CREATE FUNCTION public.cancel_pos_pelecard_prepared(p_request_key uuid,p_actor_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.pos_pelecard_intents%ROWTYPE; p public.payment_transactions%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
    (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text IN ('admin','cashier'))
  THEN RAISE EXCEPTION 'pos_payment_forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO i FROM public.pos_pelecard_intents WHERE request_key=p_request_key AND created_by=p_actor_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO p FROM public.payment_transactions WHERE id=i.payment_id FOR UPDATE;
  IF p.status='failed' AND p.failure_code='cashier_cancelled' THEN RETURN true; END IF;
  IF i.dispatch_started_at IS NOT NULL OR p.status<>'initiated' THEN RAISE EXCEPTION 'payment_attempt_in_progress' USING ERRCODE='23514'; END IF;
  UPDATE public.payment_transactions SET status='failed',failure_code='cashier_cancelled' WHERE id=p.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.cancel_pos_pelecard_prepared(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cancel_pos_pelecard_prepared(uuid,uuid) TO service_role;

-- The existing order ledger remains untouched. A standalone sale is a second
-- source kind, with the same prospective cutoff and disabled dispatch gate.
ALTER TABLE public.payper_document_ledger ALTER COLUMN order_id DROP NOT NULL;

CREATE FUNCTION public.capture_pos_payper_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cutoff timestamptz; b public.payper_payment_billing_snapshots%ROWTYPE;
  i public.pos_pelecard_intents%ROWTYPE; review_code text;
BEGIN
  IF NEW.provider<>'pelecard' OR NEW.operation<>'payment' OR NEW.status<>'succeeded' OR
    NEW.order_id IS NOT NULL OR NEW.sale_id IS NULL OR NEW.verified_at IS NULL OR
    NEW.provider_transaction_id IS NULL OR
    (TG_OP='UPDATE' AND OLD.status='succeeded')
  THEN RETURN NEW; END IF;
  SELECT activation_cutoff_utc INTO cutoff FROM public.payper_dispatch_control WHERE singleton;
  SELECT * INTO i FROM public.pos_pelecard_intents WHERE payment_id=NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT * INTO b FROM public.payper_payment_billing_snapshots WHERE payment_id=NEW.id;
  review_code:=CASE
    WHEN b.payment_id IS NULL OR b.order_id IS NOT NULL THEN 'billing_snapshot_required'
    WHEN b.vat_applicable IS DISTINCT FROM i.vat_applicable THEN 'vat_treatment_required'
    WHEN b.customer_kind IS NULL OR nullif(pg_catalog.btrim(b.billing_name),'') IS NULL OR
      b.billing_identity IS NULL OR b.billing_identity !~ '^[0-9]{9}$' OR b.billing_identity='000000000' OR
      (b.customer_kind='person' AND NOT public.payper_valid_person_identity(b.billing_identity))
      THEN 'billing_identity_required'
    WHEN b.billing_email IS NULL OR b.billing_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      THEN 'billing_email_required'
    WHEN pg_catalog.jsonb_typeof(NEW.checkout_snapshot->'items')<>'array' OR
      pg_catalog.jsonb_array_length(NEW.checkout_snapshot->'items')=0
      THEN 'service_description_required'
    ELSE NULL END;
  -- Before activation, only incomplete sources become manual obligations.
  -- Complete pre-cutoff payments remain outside the Payper ledger forever.
  IF cutoff IS NULL OR NEW.created_at<cutoff OR NEW.verified_at<cutoff OR NEW.verified_at<NEW.created_at THEN
    IF review_code IS NULL THEN RETURN NEW; END IF;
    INSERT INTO public.payper_document_ledger(payment_id,order_id,sale_id,state,reconciliation_code)
      VALUES(NEW.id,NULL,NEW.sale_id,'source_blocked',review_code) ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;
  INSERT INTO public.payper_document_ledger(payment_id,order_id,sale_id,state,reconciliation_code)
    VALUES(NEW.id,NULL,NEW.sale_id,CASE WHEN review_code IS NULL THEN 'eligible' ELSE 'source_blocked' END,review_code)
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_capture_pos_payper_payment AFTER INSERT OR UPDATE OF status ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.capture_pos_payper_payment();
REVOKE ALL ON FUNCTION public.capture_pos_payper_payment() FROM PUBLIC,anon,authenticated,service_role;

-- Preserve the reviewed order source logic byte-for-byte by dispatching to
-- the original function. Only sale-only ledgers enter the new branch.
ALTER FUNCTION public.freeze_payper_source(uuid) RENAME TO freeze_payper_order_source;
CREATE FUNCTION public.freeze_payper_source(p_payment_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.payper_document_ledger%ROWTYPE; p public.payment_transactions%ROWTYPE;
  s public.sales%ROWTYPE; b public.payper_payment_billing_snapshots%ROWTYPE;
  i public.pos_pelecard_intents%ROWTYPE; facts jsonb; cutoff timestamptz;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO l FROM public.payper_document_ledger WHERE payment_id=p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payper_payment_not_eligible'; END IF;
  IF l.order_id IS NOT NULL THEN RETURN public.freeze_payper_order_source(p_payment_id); END IF;
  IF l.state<>'eligible' THEN RETURN l.source_facts; END IF;
  SELECT activation_cutoff_utc INTO cutoff FROM public.payper_dispatch_control WHERE singleton;
  SELECT * INTO p FROM public.payment_transactions WHERE id=l.payment_id;
  SELECT * INTO s FROM public.sales WHERE id=l.sale_id;
  SELECT * INTO b FROM public.payper_payment_billing_snapshots WHERE payment_id=l.payment_id;
  SELECT * INTO i FROM public.pos_pelecard_intents WHERE payment_id=l.payment_id;
  IF cutoff IS NULL OR p.provider IS DISTINCT FROM 'pelecard' OR p.operation IS DISTINCT FROM 'payment'
    OR p.status IS DISTINCT FROM 'succeeded' OR p.verified_at IS NULL OR p.provider_transaction_id IS NULL
    OR p.created_at<cutoff OR p.verified_at<cutoff OR p.verified_at<p.created_at OR p.currency<>'ILS'
    OR p.order_id IS NOT NULL OR p.sale_id IS DISTINCT FROM s.id OR s.order_id IS NOT NULL
    OR s.payment_transaction_id IS DISTINCT FROM p.id OR s.total IS DISTINCT FROM p.amount
    OR p.amount IS DISTINCT FROM i.amount OR b.payment_id IS NULL OR b.order_id IS NOT NULL
    OR b.vat_applicable IS DISTINCT FROM i.vat_applicable OR
    b.customer_kind IS NULL OR b.customer_kind NOT IN ('person','organization') OR nullif(pg_catalog.btrim(b.billing_name),'') IS NULL
    OR b.billing_identity IS NULL OR b.billing_identity !~ '^[0-9]{9}$' OR b.billing_identity='000000000'
    OR (b.customer_kind='person' AND NOT public.payper_valid_person_identity(b.billing_identity))
    OR b.billing_email IS NULL OR b.billing_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR p.checkout_snapshot->'items' IS DISTINCT FROM s.items OR
    pg_catalog.jsonb_typeof(p.checkout_snapshot->'items')<>'array' OR
    pg_catalog.jsonb_array_length(p.checkout_snapshot->'items')=0
  THEN RAISE EXCEPTION 'payper_source_incomplete'; END IF;
  facts:=pg_catalog.jsonb_build_object('paymentId',p.id,'pelecardTransactionId',p.provider_transaction_id,
    'paymentCreatedAt',p.created_at,'verifiedAt',p.verified_at,'activationCutoffUtc',cutoff,
    'amount',p.amount,'currency',p.currency,'checkoutSnapshot',p.checkout_snapshot,
    'saleId',s.id,'orderId',NULL,'orderNumber',s.receipt_number,'sourceType','sale',
    'customerKind',b.customer_kind,'billing',pg_catalog.jsonb_build_object(
      'vat_applicable',b.vat_applicable,'billing_institution_name',b.billing_name,
      'billing_company_id',b.billing_identity,'billing_accounting_email',b.billing_email));
  UPDATE public.payper_document_ledger SET state='source_frozen',source_facts=facts,
    source_frozen_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() WHERE id=l.id;
  RETURN facts;
END $$;
REVOKE ALL ON FUNCTION public.freeze_payper_source(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.freeze_payper_source(uuid) TO service_role;

COMMIT;
