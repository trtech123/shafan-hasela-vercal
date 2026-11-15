-- Hosted EMV is independent of the preserved direct J4 worker and digital checkout.
-- This migration alone enables neither initialization nor a financial transaction.
BEGIN;

ALTER TABLE public.physical_payment_intents
  ADD COLUMN route text NOT NULL DEFAULT 'direct' CHECK (route IN ('direct','hosted')),
  ADD COLUMN hosted_transaction_id text UNIQUE,
  ADD COLUMN hosted_confirmation_key text,
  ADD COLUMN hosted_redirect_url text,
  ADD CONSTRAINT physical_hosted_session_complete CHECK (
    (hosted_transaction_id IS NULL AND hosted_confirmation_key IS NULL AND hosted_redirect_url IS NULL)
    OR (route='hosted' AND hosted_transaction_id IS NOT NULL
      AND hosted_confirmation_key IS NOT NULL AND hosted_redirect_url IS NOT NULL));

-- Reject incomplete legacy order billing before a one-shot hosted claim can
-- strand the order. The snapshot is immutable after reservation.
CREATE FUNCTION public.guard_physical_billing_before_reservation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE billing jsonb:=NEW.billing_snapshot;
BEGIN
  IF billing->>'kind' NOT IN ('person','organization') OR
    coalesce(length(btrim(billing->>'name')),0) NOT BETWEEN 1 AND 200 OR
    coalesce(billing->>'identity','') !~ '^[0-9]{9}$' OR
    billing->>'identity'='000000000' OR
    (billing->>'kind'='person' AND
      NOT public.payper_valid_person_identity(billing->>'identity')) OR
    coalesce(billing->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR
    jsonb_typeof(billing->'vatApplicable') IS DISTINCT FROM 'boolean'
  THEN RAISE EXCEPTION 'physical_billing_or_vat_review_required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_physical_billing_before_reservation()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_physical_billing_before_reservation
  BEFORE INSERT ON public.physical_payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.guard_physical_billing_before_reservation();

ALTER TABLE public.payper_document_ledger
  ADD COLUMN physical_document_system_id text;
CREATE UNIQUE INDEX payper_physical_document_system_unique
  ON public.payper_document_ledger(physical_document_system_id)
  WHERE physical_document_system_id IS NOT NULL;

CREATE FUNCTION public.claim_physical_hosted_init(p_payment_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claimed boolean;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  UPDATE public.physical_payment_intents SET route='hosted',state='dispatching',
    dispatch_started_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE payment_id=p_payment_id AND state='reserved' AND dispatch_started_at IS NULL
      AND register_number='004' RETURNING true INTO claimed;
  RETURN coalesce(claimed,false);
END $$;
REVOKE ALL ON FUNCTION public.claim_physical_hosted_init(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_physical_hosted_init(uuid) TO service_role;

CREATE FUNCTION public.persist_physical_hosted_session(
  p_payment_id uuid,p_transaction_id text,p_confirmation_key text,p_redirect_url text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved boolean;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF p_transaction_id IS NULL OR p_transaction_id !~ '^[0-9A-Fa-f-]{36}$' OR
    p_confirmation_key IS NULL OR length(p_confirmation_key)>512 OR
      p_confirmation_key !~ '^[A-Za-z0-9_+/=-]+$' OR
    p_redirect_url IS NULL OR p_redirect_url !~
      ('^https://gateway(20|21)\.pelecard\.biz/PaymentGW\?transactionId='||p_transaction_id||'$')
  THEN RAISE EXCEPTION 'physical_hosted_session_invalid' USING ERRCODE='23514'; END IF;
  UPDATE public.physical_payment_intents SET state='pending',
    hosted_transaction_id=p_transaction_id,hosted_confirmation_key=p_confirmation_key,
    hosted_redirect_url=p_redirect_url,updated_at=clock_timestamp()
    WHERE payment_id=p_payment_id AND route='hosted' AND state='dispatching'
      AND hosted_transaction_id IS NULL RETURNING true INTO saved;
  IF NOT coalesce(saved,false) THEN
    RAISE EXCEPTION 'physical_hosted_session_conflict' USING ERRCODE='23514'; END IF;
  UPDATE public.payment_transactions SET status='pending_provider'
    WHERE id=p_payment_id AND status='initiated';
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.persist_physical_hosted_session(uuid,text,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.persist_physical_hosted_session(uuid,text,text,text) TO service_role;

CREATE FUNCTION public.get_physical_hosted_source(p_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.physical_payment_intents%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO i FROM public.physical_payment_intents WHERE payment_id=p_payment_id;
  IF NOT FOUND OR i.route<>'hosted' THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id',i.payment_id,'state',i.state,'register',i.register_number,
    'amountMinor',i.amount_minor,'merchantTerminal',i.terminal_number,
    'checkoutSnapshot',i.checkout_snapshot,'billingSnapshot',i.billing_snapshot,
    'transactionId',i.hosted_transaction_id,'confirmationKey',i.hosted_confirmation_key);
END $$;
REVOKE ALL ON FUNCTION public.get_physical_hosted_source(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_physical_hosted_source(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_physical_worker_intent(p_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.physical_payment_intents%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO i FROM public.physical_payment_intents WHERE payment_id=p_payment_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id',i.payment_id,'state',i.state,'route',i.route,
    'register',i.register_number,'amountMinor',i.amount_minor,
    'merchantTerminal',i.terminal_number,'transactionId',i.provider_transaction_id,
    'uid',i.provider_uid,'saleId',i.sale_id,
    'hostedTransactionId',i.hosted_transaction_id,
    'hostedConfirmationKey',i.hosted_confirmation_key,
    'hostedRedirectUrl',i.hosted_redirect_url);
END $$;

CREATE OR REPLACE FUNCTION public.list_physical_worker_intents()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('paymentId',payment_id,'state',state)
    ORDER BY created_at),'[]'::jsonb) INTO result
  FROM (SELECT payment_id,state,created_at FROM public.physical_payment_intents
    WHERE route='direct' AND state IN ('reserved','dispatching','pending','uncertain','approved')
    ORDER BY created_at LIMIT 40) pending;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.get_physical_payment(p_actor_id uuid,p_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.physical_payment_intents%ROWTYPE; order_id uuid;
  l public.payper_document_ledger%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO i FROM public.physical_payment_intents
    WHERE payment_id=p_payment_id AND created_by=p_actor_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT p.order_id INTO order_id FROM public.payment_transactions p WHERE p.id=i.payment_id;
  SELECT * INTO l FROM public.payper_document_ledger WHERE payment_id=i.payment_id;
  RETURN jsonb_build_object('paymentId',i.payment_id,'orderId',order_id,
    'state',i.state,'route',i.route,'registerNumber',i.register_number,
    'amountMinor',i.amount_minor,'saleId',i.sale_id,'createdAt',i.created_at,
    'redirectUrl',i.hosted_redirect_url,
    'documentState',l.state,'documentNumber',l.document_number,
    'documentUrl',l.document_url,'documentCode',l.reconciliation_code);
END $$;

CREATE FUNCTION public.record_physical_hosted_document(
  p_payment_id uuid,p_number text,p_url text,p_system_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.physical_payment_intents%ROWTYPE; p public.payment_transactions%ROWTYPE;
  s public.sales%ROWTYPE; l public.payper_document_ledger%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF p_number IS NULL OR p_number !~ '^[1-9][0-9]{0,29}$' OR
    p_url IS NULL OR p_url !~
      '^https://app\.payper\.co\.il/public/invoice_show/[1-9][0-9]{0,29}(\?ak=[A-Za-z0-9_-]{16,128})?$' OR
    split_part(split_part(p_url,'?',1),'/',6)<>p_number OR
    (p_system_id IS NOT NULL AND p_system_id !~ '^[1-9][0-9]{0,29}$')
  THEN RAISE EXCEPTION 'physical_document_invalid' USING ERRCODE='23514'; END IF;
  SELECT * INTO i FROM public.physical_payment_intents WHERE payment_id=p_payment_id FOR UPDATE;
  SELECT * INTO p FROM public.payment_transactions WHERE id=p_payment_id;
  SELECT * INTO l FROM public.payper_document_ledger WHERE payment_id=p_payment_id FOR UPDATE;
  SELECT * INTO s FROM public.sales WHERE id=l.sale_id;
  IF l.state='succeeded' AND l.document_number=p_number AND l.document_url=p_url
    AND l.physical_document_system_id IS NOT DISTINCT FROM p_system_id
  THEN RETURN true; END IF;
  IF i.payment_id IS NULL OR i.route<>'hosted' OR i.state<>'succeeded' OR
    i.register_number<>'004' OR i.hosted_transaction_id IS NULL OR
    i.provider_transaction_id IS NULL OR i.provider_uid IS NULL OR
    p.status<>'succeeded' OR p.provider<>'pelecard' OR p.operation<>'payment' OR
    p.currency<>'ILS' OR p.sale_id IS DISTINCT FROM i.sale_id OR
    p.provider_transaction_id IS DISTINCT FROM i.provider_transaction_id OR
    l.state<>'source_blocked' OR l.reconciliation_code<>'physical_provider_confirmation_required' OR
    l.sale_id IS DISTINCT FROM i.sale_id OR l.order_id IS DISTINCT FROM p.order_id OR
    s.id IS NULL OR s.payment_transaction_id IS DISTINCT FROM p_payment_id OR
    s.total IS DISTINCT FROM p.amount OR p.amount IS DISTINCT FROM i.amount_minor::numeric/100 OR
    EXISTS(SELECT 1 FROM public.accounting_documents d WHERE d.status='succeeded'
      AND d.source_id IN (p_payment_id::text,s.id::text))
  THEN RAISE EXCEPTION 'physical_document_reconciliation_required' USING ERRCODE='23514'; END IF;
  UPDATE public.payper_document_ledger SET state='succeeded',document_origin='automatic',
    source_facts=jsonb_build_object('physicalPaymentId',p_payment_id,
      'hostedTransactionId',i.hosted_transaction_id,
      'providerTransactionId',i.provider_transaction_id,'providerUid',i.provider_uid,
      'providerIssuedAutomatically',true),
    source_frozen_at=p.created_at,dispatch_reserved_at=p.verified_at,
    provider_trx_record_id=i.provider_transaction_id,
    document_number=p_number,document_url=p_url,physical_document_system_id=p_system_id,
    reconciliation_code=NULL,updated_at=clock_timestamp()
    WHERE payment_id=p_payment_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.record_physical_hosted_document(uuid,text,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_physical_hosted_document(uuid,text,text,text) TO service_role;

COMMIT;
