-- Payper's printed invoice number and invoice_show system ID are distinct.
-- Replace only the hosted document association function; no rows or gates change.
BEGIN;

CREATE OR REPLACE FUNCTION public.record_physical_hosted_document(
  p_payment_id uuid,p_number text,p_url text,p_system_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.physical_payment_intents%ROWTYPE; p public.payment_transactions%ROWTYPE;
  s public.sales%ROWTYPE; l public.payper_document_ledger%ROWTYPE;
  resolved_system_id text;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  resolved_system_id:=split_part(split_part(p_url,'?',1),'/',6);
  IF p_number IS NULL OR p_number !~ '^[1-9][0-9]{0,29}$' OR
    p_url IS NULL OR p_url !~
      '^https://app\.payper\.co\.il/public/invoice_show/[1-9][0-9]{0,29}(\?ak=[A-Za-z0-9_-]{16,128})?$' OR
    (p_system_id IS NOT NULL AND
      (p_system_id !~ '^[1-9][0-9]{0,29}$' OR p_system_id<>resolved_system_id))
  THEN RAISE EXCEPTION 'physical_document_invalid' USING ERRCODE='23514'; END IF;
  SELECT * INTO i FROM public.physical_payment_intents WHERE payment_id=p_payment_id FOR UPDATE;
  SELECT * INTO p FROM public.payment_transactions WHERE id=p_payment_id;
  SELECT * INTO l FROM public.payper_document_ledger WHERE payment_id=p_payment_id FOR UPDATE;
  SELECT * INTO s FROM public.sales WHERE id=l.sale_id;
  IF l.state='succeeded' AND l.document_number=p_number AND l.document_url=p_url
    AND l.physical_document_system_id IS NOT DISTINCT FROM resolved_system_id
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
    document_number=p_number,document_url=p_url,physical_document_system_id=resolved_system_id,
    reconciliation_code=NULL,updated_at=clock_timestamp()
    WHERE payment_id=p_payment_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.record_physical_hosted_document(uuid,text,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_physical_hosted_document(uuid,text,text,text) TO service_role;

COMMIT;
