-- Physical-only manual document matching. This does not issue a document or
-- change the digital Payper worker, its cutoff, or its automatic dispatch.
BEGIN;

-- A manually issued physical document has no verified Payper trxRecordId yet.
-- Preserve the requirement for every automatic or pending Payper dispatch.
ALTER TABLE public.payper_document_ledger
  DROP CONSTRAINT payper_reserved_requires_trx_record;
ALTER TABLE public.payper_document_ledger
  ADD CONSTRAINT payper_reserved_requires_trx_record CHECK (
    state NOT IN ('dispatch_reserved','reconciliation_required','succeeded')
    OR provider_trx_record_id IS NOT NULL
    OR (state='succeeded' AND document_origin='manual')
  );

CREATE FUNCTION public.record_physical_payper_manual_document(
  p_payment_id uuid, p_document_number text, p_document_url text,
  p_issued_at timestamptz, p_amount numeric,
  p_provider_confirmation_ref text, p_accountant_approval_ref text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  l public.payper_document_ledger%ROWTYPE;
  p public.payment_transactions%ROWTYPE;
  s public.sales%ROWTYPE;
  i public.physical_payment_intents%ROWTYPE;
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id=actor AND role::text='admin'
  ) THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
  IF p_document_number IS NULL OR p_document_number !~ '^[1-9][0-9]{0,29}$'
    OR p_document_url IS NULL OR
      p_document_url !~ '^https://app\.payper\.co\.il/public/invoice_show/[1-9][0-9]*(\?ak=[A-Za-z0-9_-]{16,128})?$'
    OR p_provider_confirmation_ref IS NULL OR
      p_provider_confirmation_ref !~ '^[A-Za-z0-9:/._-]{8,120}$'
    OR p_accountant_approval_ref IS NULL OR
      p_accountant_approval_ref !~ '^[A-Za-z0-9:/._-]{8,120}$'
  THEN RAISE EXCEPTION 'manual_document_evidence_invalid' USING ERRCODE='23514'; END IF;

  SELECT * INTO l FROM public.payper_document_ledger WHERE payment_id=p_payment_id FOR UPDATE;
  SELECT * INTO p FROM public.payment_transactions WHERE id=p_payment_id;
  SELECT * INTO i FROM public.physical_payment_intents WHERE payment_id=p_payment_id;
  SELECT * INTO s FROM public.sales WHERE id=l.sale_id;
  IF l.payment_id IS NULL OR p.id IS NULL OR i.payment_id IS NULL OR s.id IS NULL
    OR l.state <> 'source_blocked'
    OR l.reconciliation_code <> 'physical_provider_confirmation_required'
    OR l.document_number IS NOT NULL OR l.document_url IS NOT NULL
    OR i.state <> 'succeeded' OR i.sale_id IS DISTINCT FROM s.id
    OR i.provider_transaction_id IS NULL OR i.provider_uid IS NULL
    OR i.provider_transaction_id IS DISTINCT FROM p.provider_transaction_id
    OR p.status <> 'succeeded' OR p.provider <> 'pelecard'
    OR p.operation <> 'payment' OR p.currency <> 'ILS'
    OR p.sale_id IS DISTINCT FROM s.id
    OR p_amount IS NULL OR p.amount IS DISTINCT FROM p_amount
    OR s.total IS DISTINCT FROM p_amount
    OR p_issued_at IS NULL OR p.verified_at IS NULL
    OR p_issued_at < p.verified_at OR p_issued_at > clock_timestamp() + interval '5 minutes'
    OR EXISTS (SELECT 1 FROM public.accounting_documents d
      WHERE d.status='succeeded' AND d.source_id IN (p_payment_id::text, s.id::text))
  THEN RAISE EXCEPTION 'physical_manual_document_reconciliation_blocked' USING ERRCODE='23514'; END IF;

  -- The audit and ledger carry independent unique document numbers. Concurrent
  -- administrators serialize on the ledger row; an existing document wins.
  INSERT INTO public.payper_manual_document_audit(
    payment_id, document_number, document_url, issued_at, gross_amount,
    provider_confirmation_ref, accountant_approval_ref, actor_id, previous_reconciliation_code
  ) VALUES (
    p_payment_id, p_document_number, p_document_url, p_issued_at, p_amount,
    p_provider_confirmation_ref, p_accountant_approval_ref, actor, l.reconciliation_code
  );
  UPDATE public.payper_document_ledger
    SET state='succeeded', document_origin='manual',
      source_facts=jsonb_build_object('physicalPaymentId',p_payment_id,
        'providerTransactionId',i.provider_transaction_id,'providerUid',i.provider_uid),
      source_frozen_at=p_issued_at, dispatch_reserved_at=p_issued_at,
      document_number=p_document_number, document_url=p_document_url,
      updated_at=clock_timestamp()
    WHERE payment_id=p_payment_id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.record_physical_payper_manual_document(
  uuid,text,text,timestamptz,numeric,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_physical_payper_manual_document(
  uuid,text,text,timestamptz,numeric,text,text) TO authenticated;

COMMIT;
