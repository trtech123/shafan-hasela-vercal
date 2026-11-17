-- Audit a provider-confirmed unpaid Direct J4 attempt before freeing register 004.
-- This migration creates the guarded mechanism only; it closes no attempt.
BEGIN;

CREATE TABLE public.physical_direct_unpaid_confirmations (
  payment_id uuid PRIMARY KEY REFERENCES public.physical_payment_intents(payment_id) ON DELETE RESTRICT,
  confirmation_source text NOT NULL CHECK (confirmation_source IN
    ('provider_phone_confirmation','provider_written_confirmation')),
  confirmation_date date NOT NULL,
  confirmation_reference text NOT NULL CHECK
    (length(btrim(confirmation_reference)) BETWEEN 20 AND 2000),
  no_charge_confirmed boolean NOT NULL CHECK (no_charge_confirmed),
  no_document_confirmed boolean NOT NULL CHECK (no_document_confirmed),
  cannot_settle_confirmed boolean NOT NULL CHECK (cannot_settle_confirmed),
  closed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.physical_direct_unpaid_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.physical_direct_unpaid_confirmations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.physical_direct_unpaid_confirmations
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.close_ord1060_direct_j4_confirmed_unpaid(
  p_payment_id uuid,p_confirmation_source text,p_confirmation_date date,
  p_confirmation_reference text,p_no_charge boolean,p_no_document boolean,
  p_cannot_settle boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.physical_payment_intents%ROWTYPE;
  p public.payment_transactions%ROWTYPE;
  o public.orders%ROWTYPE;
  prior public.physical_direct_unpaid_confirmations%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF p_payment_id IS DISTINCT FROM 'ab3c6849-a4ad-476f-a615-22e04287ddbf'::uuid OR
    p_confirmation_source NOT IN ('provider_phone_confirmation','provider_written_confirmation') OR
    p_confirmation_date IS DISTINCT FROM DATE '2026-11-17' OR
    p_confirmation_reference IS NULL OR
    length(btrim(p_confirmation_reference)) NOT BETWEEN 20 AND 2000 OR
    p_no_charge IS DISTINCT FROM true OR p_no_document IS DISTINCT FROM true OR
    p_cannot_settle IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'physical_direct_confirmation_required' USING ERRCODE='23514'; END IF;
  SELECT * INTO i FROM public.physical_payment_intents
    WHERE payment_id=p_payment_id FOR UPDATE;
  SELECT * INTO p FROM public.payment_transactions
    WHERE id=p_payment_id FOR UPDATE;
  IF i.payment_id IS NULL OR p.id IS NULL THEN
    RAISE EXCEPTION 'physical_direct_attempt_missing' USING ERRCODE='23514'; END IF;
  SELECT * INTO o FROM public.orders WHERE id=p.order_id FOR UPDATE;
  SELECT * INTO prior FROM public.physical_direct_unpaid_confirmations
    WHERE payment_id=p_payment_id;
  IF prior.payment_id IS NOT NULL THEN
    IF prior.confirmation_source IS DISTINCT FROM p_confirmation_source OR
      prior.confirmation_date IS DISTINCT FROM p_confirmation_date OR
      prior.confirmation_reference IS DISTINCT FROM p_confirmation_reference OR
      i.state<>'canceled' OR p.status<>'expired'
    THEN RAISE EXCEPTION 'physical_direct_closure_conflict' USING ERRCODE='23514'; END IF;
    RETURN jsonb_build_object('paymentId',p_payment_id,'state','canceled',
      'paymentStatus','expired','orderId',o.id);
  END IF;
  IF i.route<>'direct' OR i.state<>'uncertain' OR
    i.register_number<>'004' OR i.terminal_number<>'2814926015' OR
    i.amount_minor<>1500 OR i.dispatch_started_at IS NULL OR
    i.dispatch_started_at::date IS DISTINCT FROM DATE '2026-11-17' OR
    i.first_response IS NOT NULL OR
    i.provider_transaction_id IS NOT NULL OR i.provider_uid IS NOT NULL OR
    i.approval_id IS NOT NULL OR i.sale_id IS NOT NULL OR
    p.order_id IS DISTINCT FROM '05db5353-64ff-403d-a704-198ea9568729'::uuid OR
    p.provider<>'pelecard' OR p.operation<>'payment' OR p.currency<>'ILS' OR
    p.status NOT IN ('initiated','pending_provider','timed_out') OR
    p.amount IS DISTINCT FROM 15.00 OR p.sale_id IS NOT NULL OR
    p.provider_transaction_id IS NOT NULL OR p.approval_id IS NOT NULL OR
    p.provider_status_code='000' OR p.verified_at IS NOT NULL OR
    o.id IS NULL OR o.order_number<>'ORD-1060' OR
    o.total_price IS DISTINCT FROM 15.00 OR o.payment_status<>'לא שולם' OR
    o.status IN ('שולם','בוטל') OR
    EXISTS(SELECT 1 FROM public.sales s WHERE s.order_id=o.id OR
      s.payment_transaction_id=p_payment_id OR
      s.linked_order_info->>'order_number'=o.order_number) OR
    EXISTS(SELECT 1 FROM public.manual_order_payments m WHERE m.order_id=o.id) OR
    EXISTS(SELECT 1 FROM public.payper_document_ledger l WHERE
      l.payment_id=p_payment_id OR l.order_id=o.id) OR
    EXISTS(SELECT 1 FROM public.accounting_documents d WHERE
      d.source_id IN (p_payment_id::text,o.id::text)) OR
    EXISTS(SELECT 1 FROM public.payment_transactions other WHERE
      other.order_id=o.id AND other.id<>p_payment_id AND
      other.status IN ('initiated','pending_provider','timed_out','succeeded'))
  THEN RAISE EXCEPTION 'physical_direct_unpaid_closure_forbidden' USING ERRCODE='23514'; END IF;
  INSERT INTO public.physical_direct_unpaid_confirmations(
    payment_id,confirmation_source,confirmation_date,confirmation_reference,
    no_charge_confirmed,no_document_confirmed,cannot_settle_confirmed)
  VALUES(p_payment_id,p_confirmation_source,p_confirmation_date,p_confirmation_reference,
    p_no_charge,p_no_document,p_cannot_settle);
  UPDATE public.physical_payment_intents SET state='canceled',updated_at=clock_timestamp()
    WHERE payment_id=p_payment_id;
  UPDATE public.payment_transactions SET status='expired' WHERE id=p_payment_id;
  RETURN jsonb_build_object('paymentId',p_payment_id,'state','canceled',
    'paymentStatus','expired','orderId',o.id);
END $$;
REVOKE ALL ON FUNCTION public.close_ord1060_direct_j4_confirmed_unpaid(
  uuid,text,date,text,boolean,boolean,boolean)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.close_ord1060_direct_j4_confirmed_unpaid(
  uuid,text,date,text,boolean,boolean,boolean) TO service_role;
COMMIT;
