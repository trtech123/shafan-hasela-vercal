-- Expand only. This migration does not reconcile any existing document or
-- dispatch a provider request. A separate, evidenced admin call is required.
BEGIN;

CREATE TABLE public.payper_noncard_document_confirmation_audit (
  payment_id uuid PRIMARY KEY REFERENCES public.payper_document_ledger(payment_id) ON DELETE RESTRICT,
  provider_invoice_id text NOT NULL UNIQUE CHECK (provider_invoice_id ~ '^[1-9][0-9]{0,29}$'),
  document_number text NOT NULL UNIQUE CHECK (document_number ~ '^[1-9][0-9]{0,29}$'),
  document_url text NOT NULL,
  document_date date NOT NULL,
  gross_amount numeric(12,2) NOT NULL CHECK (gross_amount > 0),
  receipt_reference text NOT NULL,
  provider_evidence_ref text NOT NULL CHECK (length(provider_evidence_ref) BETWEEN 12 AND 500),
  delivery_evidence_ref text NOT NULL CHECK (length(delivery_evidence_ref) BETWEEN 12 AND 500),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.payper_noncard_document_confirmation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payper_noncard_document_confirmation_audit
  FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY payper_noncard_confirmation_admin_read
  ON public.payper_noncard_document_confirmation_audit FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role::text='admin'));
GRANT SELECT ON public.payper_noncard_document_confirmation_audit TO authenticated, service_role;
CREATE TRIGGER trg_payper_noncard_confirmation_immutable BEFORE UPDATE OR DELETE
  ON public.payper_noncard_document_confirmation_audit FOR EACH ROW
  EXECUTE FUNCTION public.reject_payper_manual_audit_mutation();

CREATE FUNCTION public.confirm_payper_noncard_existing_document(
  p_actor_id uuid, p_payment_id uuid, p_provider_invoice_id text,
  p_document_number text, p_document_url text, p_document_date date,
  p_gross_amount numeric, p_receipt_reference text,
  p_provider_evidence_ref text, p_delivery_evidence_ref text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  l public.payper_document_ledger%ROWTYPE;
  p public.payment_transactions%ROWTYPE;
  s public.sales%ROWTYPE;
  n public.payper_noncard_payments%ROWTYPE;
  d public.payper_provider_response_diagnostics%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' OR NOT EXISTS
    (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin')
  THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
  IF p_provider_invoice_id IS NULL OR p_provider_invoice_id !~ '^[1-9][0-9]{0,29}$'
    OR p_document_number IS NULL OR p_document_number !~ '^[1-9][0-9]{0,29}$'
    OR p_document_url IS NULL OR p_document_url !~
      '^https://app\.payper\.co\.il/public/invoice_show/[1-9][0-9]*\?ak=[A-Za-z0-9_-]{16,128}$'
    OR pg_catalog.split_part(pg_catalog.split_part(p_document_url,'?',1),'/',6) <> p_provider_invoice_id
    OR p_document_date IS NULL OR p_gross_amount IS NULL OR p_receipt_reference IS NULL
    OR p_provider_evidence_ref IS NULL OR length(p_provider_evidence_ref) NOT BETWEEN 12 AND 500
    OR p_delivery_evidence_ref IS NULL OR length(p_delivery_evidence_ref) NOT BETWEEN 12 AND 500
  THEN RAISE EXCEPTION 'payper_noncard_confirmation_evidence_invalid'; END IF;

  SELECT * INTO l FROM public.payper_document_ledger WHERE payment_id=p_payment_id FOR UPDATE;
  SELECT * INTO p FROM public.payment_transactions WHERE id=p_payment_id;
  SELECT * INTO s FROM public.sales WHERE id=l.sale_id;
  SELECT * INTO n FROM public.payper_noncard_payments WHERE payment_id=p_payment_id;
  SELECT * INTO d FROM public.payper_provider_response_diagnostics WHERE payment_id=p_payment_id;
  IF l.payment_id IS NULL OR l.state <> 'reconciliation_required'
    OR l.reconciliation_code <> 'provider_response_uncertain'
    OR l.document_origin <> 'automatic' OR l.document_number IS NOT NULL OR l.document_url IS NOT NULL
    OR l.dispatch_reserved_at IS NULL OR l.provider_trx_record_id IS NOT NULL
    OR d.payment_id IS NULL OR NOT d.response_received
    OR p.id IS NULL OR p.provider <> 'manual_cash' OR p.operation <> 'payment'
    OR p.status <> 'succeeded' OR p.currency <> 'ILS'
    OR p.sale_id IS DISTINCT FROM l.sale_id OR p.order_id IS DISTINCT FROM l.order_id
    OR p.amount IS DISTINCT FROM p_gross_amount
    OR s.id IS NULL OR s.total IS DISTINCT FROM p_gross_amount
    OR s.order_id IS DISTINCT FROM p.order_id OR s.payment_transaction_id IS DISTINCT FROM p.id
    OR s.receipt_number IS DISTINCT FROM p_receipt_reference OR s.sale_date IS DISTINCT FROM p_document_date
    OR n.payment_id IS NULL OR n.method <> 'cash' OR n.document_type <> 'invoice-receipt'
    OR n.amount_minor IS DISTINCT FROM (p_gross_amount*100)::integer
    OR EXISTS (SELECT 1 FROM public.payper_document_ledger other
      WHERE other.payment_id <> p_payment_id AND other.state='succeeded'
        AND (other.document_number=p_document_number OR other.document_url=p_document_url))
    OR EXISTS (SELECT 1 FROM public.accounting_documents a
      WHERE a.status='succeeded' AND a.source_id IN (p_payment_id::text,s.id::text,l.order_id::text))
  THEN RAISE EXCEPTION 'payper_noncard_confirmation_blocked' USING ERRCODE='42501'; END IF;

  INSERT INTO public.payper_noncard_document_confirmation_audit
    (payment_id,provider_invoice_id,document_number,document_url,document_date,
     gross_amount,receipt_reference,provider_evidence_ref,delivery_evidence_ref,actor_id)
  VALUES (p_payment_id,p_provider_invoice_id,p_document_number,p_document_url,p_document_date,
          p_gross_amount,p_receipt_reference,p_provider_evidence_ref,p_delivery_evidence_ref,p_actor_id);
  UPDATE public.payper_document_ledger SET state='succeeded',document_number=p_document_number,
    document_url=p_document_url,updated_at=clock_timestamp() WHERE payment_id=p_payment_id;
  UPDATE public.accounting_events SET status='succeeded',updated_at=clock_timestamp()
    WHERE source_type='payment_transaction' AND source_id=p_payment_id::text
      AND purpose='noncard_payment' AND accounting_provider='payper'
      AND status='reconciliation_required';
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.confirm_payper_noncard_existing_document(
  uuid,uuid,text,text,text,date,numeric,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.confirm_payper_noncard_existing_document(
  uuid,uuid,text,text,text,date,numeric,text,text,text) TO service_role;

COMMIT;
