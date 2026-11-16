-- A confirmed uncharged, expired hosted session can be closed without deleting
-- its immutable intent, billing snapshot, or payment history.
BEGIN;

CREATE TABLE public.physical_hosted_unpaid_confirmations (
  payment_id uuid PRIMARY KEY REFERENCES public.physical_payment_intents(payment_id) ON DELETE RESTRICT,
  hosted_transaction_id text NOT NULL UNIQUE,
  confirmation_source text NOT NULL CHECK (confirmation_source IN
    ('provider_phone_confirmation','provider_written_confirmation')),
  confirmation_date date NOT NULL,
  confirmation_reference text NOT NULL CHECK
    (length(btrim(confirmation_reference)) BETWEEN 12 AND 2000),
  expiry_observed_at timestamptz NOT NULL,
  expiry_code text NOT NULL CHECK (expiry_code='0003'),
  closed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.physical_hosted_unpaid_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.physical_hosted_unpaid_confirmations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.physical_hosted_unpaid_confirmations
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.close_physical_hosted_expired_unpaid(
  p_payment_id uuid,p_hosted_transaction_id text,p_confirmation_source text,
  p_confirmation_date date,p_confirmation_reference text,
  p_expiry_observed_at timestamptz,p_expiry_code text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.physical_payment_intents%ROWTYPE;
  p public.payment_transactions%ROWTYPE;
  o public.orders%ROWTYPE;
  prior public.physical_hosted_unpaid_confirmations%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO i FROM public.physical_payment_intents
    WHERE payment_id=p_payment_id FOR UPDATE;
  SELECT * INTO p FROM public.payment_transactions
    WHERE id=p_payment_id FOR UPDATE;
  IF i.payment_id IS NULL OR p.id IS NULL OR p.order_id IS NULL THEN
    RAISE EXCEPTION 'physical_hosted_attempt_missing' USING ERRCODE='23514'; END IF;
  SELECT * INTO o FROM public.orders WHERE id=p.order_id FOR UPDATE;
  SELECT * INTO prior FROM public.physical_hosted_unpaid_confirmations
    WHERE payment_id=p_payment_id;
  IF prior.payment_id IS NOT NULL THEN
    IF prior.hosted_transaction_id IS DISTINCT FROM p_hosted_transaction_id OR
      prior.confirmation_source IS DISTINCT FROM p_confirmation_source OR
      prior.confirmation_date IS DISTINCT FROM p_confirmation_date OR
      prior.confirmation_reference IS DISTINCT FROM p_confirmation_reference OR
      prior.expiry_observed_at IS DISTINCT FROM p_expiry_observed_at OR
      prior.expiry_code IS DISTINCT FROM p_expiry_code OR
      i.state<>'canceled' OR p.status<>'expired'
    THEN RAISE EXCEPTION 'physical_hosted_closure_conflict' USING ERRCODE='23514'; END IF;
    RETURN jsonb_build_object('paymentId',p_payment_id,'state','canceled',
      'paymentStatus','expired','orderId',o.id);
  END IF;
  IF i.route<>'hosted' OR i.state NOT IN ('pending','uncertain') OR
    i.dispatch_started_at IS NULL OR
    i.hosted_transaction_id IS DISTINCT FROM p_hosted_transaction_id OR
    i.hosted_redirect_url IS DISTINCT FROM
      ('https://gateway21.pelecard.biz/PaymentGW?transactionId='||p_hosted_transaction_id) AND
    i.hosted_redirect_url IS DISTINCT FROM
      ('https://gateway20.pelecard.biz/PaymentGW?transactionId='||p_hosted_transaction_id) OR
    i.provider_transaction_id IS NOT NULL OR i.provider_uid IS NOT NULL OR
    i.approval_id IS NOT NULL OR i.sale_id IS NOT NULL OR
    p.provider<>'pelecard' OR p.operation<>'payment' OR p.currency<>'ILS' OR
    p.status NOT IN ('initiated','pending_provider','timed_out') OR
    p.amount IS DISTINCT FROM i.amount_minor::numeric/100 OR
    p.sale_id IS NOT NULL OR p.provider_transaction_id IS NOT NULL OR
    p.approval_id IS NOT NULL OR p.verified_at IS NOT NULL OR
    p.provider_status_code='000' OR
    o.id IS NULL OR o.payment_status<>'לא שולם' OR o.status IN ('שולם','בוטל') OR
    o.total_price IS DISTINCT FROM p.amount OR
    EXISTS(SELECT 1 FROM public.sales s WHERE s.order_id=o.id OR
      s.payment_transaction_id=p_payment_id OR
      s.linked_order_info->>'order_number'=o.order_number) OR
    EXISTS(SELECT 1 FROM public.payper_document_ledger l WHERE
      l.payment_id=p_payment_id OR l.order_id=o.id) OR
    EXISTS(SELECT 1 FROM public.accounting_documents d WHERE
      d.source_id IN (p_payment_id::text,o.id::text)) OR
    EXISTS(SELECT 1 FROM public.payment_transactions other WHERE
      other.order_id=o.id AND other.id<>p_payment_id AND
      other.status IN ('initiated','pending_provider','timed_out','succeeded'))
  THEN RAISE EXCEPTION 'physical_hosted_unpaid_closure_forbidden' USING ERRCODE='23514'; END IF;
  IF p_confirmation_source NOT IN
      ('provider_phone_confirmation','provider_written_confirmation') OR
    p_confirmation_date IS NULL OR
    p_confirmation_date < (i.dispatch_started_at AT TIME ZONE 'Asia/Jerusalem')::date OR
    p_confirmation_date > (clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::date OR
    p_confirmation_reference IS NULL OR
    length(btrim(p_confirmation_reference)) NOT BETWEEN 12 AND 2000 OR
    p_expiry_code IS DISTINCT FROM '0003' OR
    p_expiry_observed_at IS NULL OR
    p_expiry_observed_at < i.dispatch_started_at OR
    p_expiry_observed_at > clock_timestamp()
  THEN RAISE EXCEPTION 'physical_hosted_confirmation_required' USING ERRCODE='23514'; END IF;
  INSERT INTO public.physical_hosted_unpaid_confirmations(
    payment_id,hosted_transaction_id,confirmation_source,confirmation_date,
    confirmation_reference,expiry_observed_at,expiry_code)
  VALUES(p_payment_id,p_hosted_transaction_id,p_confirmation_source,
    p_confirmation_date,p_confirmation_reference,p_expiry_observed_at,p_expiry_code);
  UPDATE public.physical_payment_intents SET state='canceled',updated_at=clock_timestamp()
    WHERE payment_id=p_payment_id;
  UPDATE public.payment_transactions SET status='expired'
    WHERE id=p_payment_id;
  RETURN jsonb_build_object('paymentId',p_payment_id,'state','canceled',
    'paymentStatus','expired','orderId',o.id);
END $$;
REVOKE ALL ON FUNCTION public.close_physical_hosted_expired_unpaid(
  uuid,text,text,date,text,timestamptz,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.close_physical_hosted_expired_unpaid(
  uuid,text,text,date,text,timestamptz,text) TO service_role;
COMMIT;
