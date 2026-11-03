-- Expand-only: keep the original outcome RPC for mixed-version rollback.
-- No historical ledger row is changed and no dispatch control is activated.
BEGIN;

CREATE TABLE public.payper_provider_response_diagnostics (
  payment_id uuid PRIMARY KEY REFERENCES public.payper_document_ledger(payment_id) ON DELETE RESTRICT,
  response_received boolean NOT NULL,
  provider_status_code text,
  invoice_status text,
  invoice_error text,
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (response_received OR
    (provider_status_code IS NULL AND invoice_status IS NULL AND invoice_error IS NULL))
);
ALTER TABLE public.payper_provider_response_diagnostics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payper_provider_response_diagnostics
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.payper_provider_response_diagnostics TO service_role;

-- The full provider error can contain private data. Store it once in this
-- service-role-only table, atomically with the existing one-way ledger result.
CREATE FUNCTION public.record_payper_dispatch_outcome_v2(
  p_payment_id uuid, p_state text, p_document_number text, p_document_url text,
  p_code text, p_response_received boolean, p_provider_status_code text,
  p_invoice_status text, p_invoice_error text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.payper_document_ledger%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role'
  THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO l FROM public.payper_document_ledger WHERE payment_id=p_payment_id FOR UPDATE;
  IF NOT FOUND OR l.state <> 'dispatch_reserved'
  THEN RAISE EXCEPTION 'payper_outcome_fence'; END IF;
  IF p_response_received IS NULL OR (NOT p_response_received AND
    (p_provider_status_code IS NOT NULL OR p_invoice_status IS NOT NULL OR p_invoice_error IS NOT NULL))
  THEN RAISE EXCEPTION 'payper_provider_diagnostic_invalid'; END IF;
  IF p_state='succeeded' THEN
    IF p_document_number IS NULL OR p_document_number !~ '^[0-9]+$'
      OR p_document_url IS NULL OR p_document_url !~ '^https://(app\.)?payper\.co\.il/'
    THEN RAISE EXCEPTION 'payper_success_evidence_required'; END IF;
    UPDATE public.payper_document_ledger SET state='succeeded',
      document_number=p_document_number, document_url=p_document_url,
      updated_at=clock_timestamp() WHERE id=l.id;
  ELSIF p_state='reconciliation_required' THEN
    IF p_code IS NULL OR p_code !~ '^[a-z0-9_]{1,80}$'
    THEN RAISE EXCEPTION 'payper_safe_code_required'; END IF;
    UPDATE public.payper_document_ledger SET state='reconciliation_required',
      reconciliation_code=p_code, updated_at=clock_timestamp() WHERE id=l.id;
  ELSE RAISE EXCEPTION 'payper_outcome_invalid'; END IF;
  INSERT INTO public.payper_provider_response_diagnostics(
    payment_id,response_received,provider_status_code,invoice_status,invoice_error
  ) VALUES(p_payment_id,p_response_received,p_provider_status_code,p_invoice_status,p_invoice_error);
  RETURN p_state;
END $$;
REVOKE ALL ON FUNCTION public.record_payper_dispatch_outcome_v2(
  uuid,text,text,text,text,boolean,text,text,text
) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_payper_dispatch_outcome_v2(
  uuid,text,text,text,text,boolean,text,text,text
) TO service_role;

COMMIT;
