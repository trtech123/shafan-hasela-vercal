-- Reconcile an already published automatic Payper document after a successful
-- provider response whose document identity was not persisted. This never
-- dispatches a provider request or changes an accounting obligation by itself.
BEGIN;

CREATE TABLE public.payper_automatic_document_confirmation_audit (
  payment_id uuid PRIMARY KEY REFERENCES public.payper_document_ledger(payment_id) ON DELETE RESTRICT,
  provider_invoice_id text NOT NULL UNIQUE CHECK (provider_invoice_id ~ '^[1-9][0-9]{0,29}$'),
  document_number text NOT NULL UNIQUE CHECK (document_number ~ '^[1-9][0-9]{0,29}$'),
  document_url text NOT NULL,
  document_date date NOT NULL,
  gross_amount numeric(12,2) NOT NULL CHECK (gross_amount > 0),
  receipt_reference text NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.payper_automatic_document_confirmation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payper_automatic_document_confirmation_audit
  FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY payper_automatic_confirmation_admin_read
  ON public.payper_automatic_document_confirmation_audit FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role::text='admin'));
GRANT SELECT ON public.payper_automatic_document_confirmation_audit TO authenticated, service_role;
CREATE TRIGGER trg_payper_automatic_confirmation_immutable BEFORE UPDATE OR DELETE
  ON public.payper_automatic_document_confirmation_audit FOR EACH ROW
  EXECUTE FUNCTION public.reject_payper_manual_audit_mutation();

CREATE FUNCTION public.confirm_payper_automatic_document(
  p_actor_id uuid, p_payment_id uuid, p_provider_invoice_id text,
  p_document_number text, p_document_url text, p_document_date date,
  p_gross_amount numeric, p_receipt_reference text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  l public.payper_document_ledger%ROWTYPE;
  p public.payment_transactions%ROWTYPE;
  s public.sales%ROWTYPE;
  d public.payper_provider_response_diagnostics%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' OR NOT EXISTS
    (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin')
  THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
  IF p_provider_invoice_id IS NULL OR p_provider_invoice_id !~ '^[1-9][0-9]{0,29}$'
    OR p_document_number IS NULL OR p_document_number !~ '^[1-9][0-9]{0,29}$'
    OR p_document_url IS NULL OR p_document_url !~
      '^https://app\.payper\.co\.il/public/invoice_show/[1-9][0-9]*\?ak=[A-Za-z0-9_-]{16,128}$'
    OR pg_catalog.split_part(pg_catalog.split_part(p_document_url,'?',1), '/', 6) <> p_provider_invoice_id
    OR p_document_date IS NULL OR p_gross_amount IS NULL OR p_receipt_reference IS NULL
  THEN RAISE EXCEPTION 'payper_confirmation_evidence_invalid'; END IF;

  SELECT * INTO l FROM public.payper_document_ledger WHERE payment_id=p_payment_id FOR UPDATE;
  SELECT * INTO p FROM public.payment_transactions WHERE id=p_payment_id;
  SELECT * INTO s FROM public.sales WHERE id=l.sale_id;
  SELECT * INTO d FROM public.payper_provider_response_diagnostics WHERE payment_id=p_payment_id;
  IF l.payment_id IS NULL OR l.state <> 'reconciliation_required'
    OR l.reconciliation_code <> 'provider_response_uncertain'
    OR l.document_origin <> 'automatic' OR l.document_number IS NOT NULL OR l.document_url IS NOT NULL
    OR l.dispatch_reserved_at IS NULL OR l.provider_trx_record_id IS NULL
    OR d.payment_id IS NULL OR NOT d.response_received OR d.provider_status_code <> '000'
    OR d.invoice_status <> 'Success' OR d.invoice_error IS NOT NULL
    OR p.id IS NULL OR p.provider <> 'pelecard' OR p.operation <> 'payment'
    OR p.status <> 'succeeded' OR p.currency <> 'ILS' OR p.verified_at IS NULL
    OR p.sale_id IS DISTINCT FROM l.sale_id OR p.amount IS DISTINCT FROM p_gross_amount
    OR s.id IS NULL OR s.total IS DISTINCT FROM p_gross_amount
    OR s.receipt_number IS DISTINCT FROM p_receipt_reference
    OR p_document_date < p.verified_at::date OR p_document_date > clock_timestamp()::date
    OR EXISTS (SELECT 1 FROM public.accounting_documents a
      WHERE a.status='succeeded' AND a.source_id IN (p_payment_id::text, s.id::text, l.order_id::text))
  THEN RAISE EXCEPTION 'payper_automatic_confirmation_blocked' USING ERRCODE='42501'; END IF;

  INSERT INTO public.payper_automatic_document_confirmation_audit
    (payment_id,provider_invoice_id,document_number,document_url,document_date,
     gross_amount,receipt_reference,actor_id)
  VALUES (p_payment_id,p_provider_invoice_id,p_document_number,p_document_url,
    p_document_date,p_gross_amount,p_receipt_reference,p_actor_id);
  UPDATE public.payper_document_ledger SET state='succeeded',document_number=p_document_number,
    document_url=p_document_url,updated_at=clock_timestamp()
  WHERE payment_id=p_payment_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.confirm_payper_automatic_document(
  uuid,uuid,text,text,text,date,numeric,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.confirm_payper_automatic_document(
  uuid,uuid,text,text,text,date,numeric,text) TO service_role;

COMMIT;
