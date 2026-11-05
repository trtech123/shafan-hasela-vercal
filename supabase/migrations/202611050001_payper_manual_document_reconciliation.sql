-- Expand-only. No payment, invoice, dispatch, or historical row is changed.
BEGIN;

ALTER TABLE public.payper_document_ledger
  ADD COLUMN document_origin text NOT NULL DEFAULT 'automatic'
  CHECK (document_origin IN ('automatic', 'manual'));

CREATE TABLE public.payper_manual_document_audit (
  payment_id uuid PRIMARY KEY REFERENCES public.payper_document_ledger(payment_id) ON DELETE RESTRICT,
  document_number text NOT NULL UNIQUE,
  document_url text NOT NULL,
  issued_at timestamptz NOT NULL,
  gross_amount numeric(12,2) NOT NULL CHECK (gross_amount > 0),
  provider_confirmation_ref text NOT NULL,
  accountant_approval_ref text NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  previous_reconciliation_code text,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.payper_manual_document_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payper_manual_document_audit FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY payper_manual_audit_admin_read ON public.payper_manual_document_audit
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role::text='admin')
  );
GRANT SELECT ON public.payper_manual_document_audit TO authenticated, service_role;

CREATE FUNCTION public.reject_payper_manual_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'payper_manual_audit_immutable' USING ERRCODE='42501'; END $$;
CREATE TRIGGER trg_payper_manual_audit_immutable BEFORE UPDATE OR DELETE
  ON public.payper_manual_document_audit FOR EACH ROW
  EXECUTE FUNCTION public.reject_payper_manual_audit_mutation();
REVOKE ALL ON FUNCTION public.reject_payper_manual_audit_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.record_payper_manual_document(
  p_payment_id uuid, p_document_number text, p_document_url text,
  p_issued_at timestamptz, p_amount numeric,
  p_provider_confirmation_ref text, p_accountant_approval_ref text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  l public.payper_document_ledger%ROWTYPE;
  p public.payment_transactions%ROWTYPE;
  s public.sales%ROWTYPE;
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id=actor AND role::text='admin'
  ) THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
  IF p_document_number IS NULL OR p_document_number !~ '^[1-9][0-9]{0,29}$'
    OR p_document_url IS NULL OR p_document_url !~ '^https://(app\.)?payper\.co\.il/(app/)?public/invoice_show/[0-9]+(\?[^[:space:]#]*)?$'
    OR pg_catalog.regexp_replace(pg_catalog.split_part(p_document_url,'?',1), '^.*/invoice_show/', '') <> p_document_number
    OR p_provider_confirmation_ref IS NULL OR p_provider_confirmation_ref !~ '^[A-Za-z0-9:/._-]{8,120}$'
    OR p_accountant_approval_ref IS NULL OR p_accountant_approval_ref !~ '^[A-Za-z0-9:/._-]{8,120}$'
  THEN RAISE EXCEPTION 'manual_document_evidence_invalid'; END IF;

  SELECT * INTO l FROM public.payper_document_ledger WHERE payment_id=p_payment_id FOR UPDATE;
  SELECT * INTO p FROM public.payment_transactions WHERE id=p_payment_id;
  SELECT * INTO s FROM public.sales WHERE id=l.sale_id;
  IF NOT FOUND OR l.payment_id IS NULL OR p.id IS NULL
    OR l.state <> 'reconciliation_required'
    OR l.document_number IS NOT NULL OR l.document_url IS NOT NULL
    OR l.provider_trx_record_id IS NULL OR p.status <> 'succeeded'
    OR p.provider <> 'pelecard' OR p.operation <> 'payment' OR p.currency <> 'ILS'
    OR s.id IS NULL OR l.sale_id IS DISTINCT FROM s.id OR p.sale_id IS DISTINCT FROM s.id
    OR p_amount IS NULL OR p.amount IS DISTINCT FROM p_amount OR s.total IS DISTINCT FROM p_amount
    OR p_issued_at IS NULL OR p.verified_at IS NULL
    OR p_issued_at < p.verified_at OR p_issued_at > clock_timestamp() + interval '5 minutes'
    OR EXISTS (SELECT 1 FROM public.accounting_documents d
      WHERE d.status='succeeded' AND d.source_id IN (p_payment_id::text, s.id::text, l.order_id::text))
  THEN RAISE EXCEPTION 'manual_document_reconciliation_blocked'; END IF;

  INSERT INTO public.payper_manual_document_audit(
    payment_id, document_number, document_url, issued_at, gross_amount,
    provider_confirmation_ref, accountant_approval_ref, actor_id, previous_reconciliation_code
  ) VALUES (
    p_payment_id, p_document_number, p_document_url, p_issued_at, p_amount,
    p_provider_confirmation_ref, p_accountant_approval_ref, actor, l.reconciliation_code
  );
  UPDATE public.payper_document_ledger SET state='succeeded', document_origin='manual',
    document_number=p_document_number, document_url=p_document_url, updated_at=clock_timestamp()
    WHERE payment_id=p_payment_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.record_payper_manual_document(uuid,text,text,timestamptz,numeric,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_payper_manual_document(uuid,text,text,timestamptz,numeric,text,text)
  TO authenticated;

-- Add the paid amount at the end, preserving the existing view columns and grants.
CREATE OR REPLACE VIEW public.payper_accounting_exceptions WITH (security_invoker=true) AS
 SELECT l.payment_id,l.order_id,l.sale_id,o.order_number,l.state,
  l.reconciliation_code,l.created_at,l.updated_at,l.dispatch_reserved_at,
  p.provider_transaction_id,
  CASE WHEN l.state='source_blocked' THEN 'missing_or_invalid_source'
       WHEN l.state='reconciliation_required' AND l.reconciliation_code IN
         ('provider_credentials_rejected','provider_ip_rejected','provider_document_rejected')
         THEN 'provider_rejection_manual_review'
       WHEN l.state='reconciliation_required' THEN 'provider_outcome_uncertain'
       WHEN l.state='dispatch_reserved' THEN 'dispatch_in_progress'
       ELSE 'pending_recovery' END AS exception_kind,
  (l.state IN ('source_blocked','reconciliation_required')
   OR (l.state='dispatch_reserved' AND l.updated_at<now()-interval '1 minute')
   OR (l.state IN ('eligible','source_frozen')
       AND l.updated_at<now()-interval '2 minutes')) AS actionable,
  p.amount,l.provider_trx_record_id
 FROM public.payper_document_ledger l
 JOIN public.payment_transactions p ON p.id=l.payment_id
 LEFT JOIN public.orders o ON o.id=l.order_id
 WHERE l.state IN ('eligible','source_frozen','source_blocked','dispatch_reserved','reconciliation_required')
 UNION ALL
 SELECT p.id,p.order_id,p.sale_id,o.order_number,'missing_ledger'::text,
  'ledger_missing'::text,p.created_at,p.verified_at,NULL::timestamptz,
  p.provider_transaction_id,'missing_ledger'::text,true,p.amount,NULL::text
 FROM public.payment_transactions p
 LEFT JOIN public.payper_document_ledger l ON l.payment_id=p.id
 LEFT JOIN public.orders o ON o.id=p.order_id
 WHERE l.payment_id IS NULL AND public.payper_effective_cutoff() IS NOT NULL
  AND p.provider='pelecard' AND p.operation='payment' AND p.status='succeeded'
  AND p.created_at>=public.payper_effective_cutoff()
  AND p.verified_at>=public.payper_effective_cutoff();

-- A manually matched document closes its accounting exception but is not proof
-- that automatic provider issuance works. Continuous mode still requires an
-- automatically issued canary, even after manual reconciliation is available.
CREATE OR REPLACE FUNCTION public.enable_payper_continuous(p_actor_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE control_row public.payper_dispatch_control%ROWTYPE;
 previous_cutoff timestamptz; cutoff timestamptz;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
   (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin')
 THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO control_row FROM public.payper_dispatch_control WHERE singleton FOR UPDATE;
 IF control_row.enabled OR control_row.dispatch_mode<>'canary'
   OR control_row.canary_payment_id IS NULL OR control_row.dispatch_remaining<>0
   OR EXISTS (SELECT 1 FROM public.payper_document_ledger WHERE state='dispatch_reserved')
 THEN RAISE EXCEPTION 'payper_continuous_not_ready' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.payper_document_ledger l
   JOIN public.payment_transactions p ON p.id=l.payment_id
   WHERE l.payment_id=control_row.canary_payment_id
     AND l.state='succeeded' AND l.document_origin='automatic'
     AND l.document_number IS NOT NULL AND l.document_url IS NOT NULL
     AND p.provider='pelecard' AND p.operation='payment' AND p.status='succeeded'
     AND p.verified_at IS NOT NULL)
 THEN RAISE EXCEPTION 'payper_canary_document_required' USING ERRCODE='42501'; END IF;
 previous_cutoff:=public.payper_effective_cutoff();
 cutoff:=clock_timestamp();
 IF previous_cutoff IS NULL OR cutoff<=previous_cutoff
 THEN RAISE EXCEPTION 'payper_continuous_cutoff_not_new' USING ERRCODE='23514'; END IF;
 INSERT INTO public.payper_activation_epoch_audit
   (previous_cutoff_utc,previous_canary_payment_id,new_cutoff_utc,actor_id)
 VALUES (previous_cutoff,control_row.canary_payment_id,cutoff,p_actor_id);
 UPDATE public.payper_dispatch_control SET enabled=true,dispatch_mode='continuous',
   dispatch_remaining=0,canary_payment_id=NULL WHERE singleton;
 RETURN true;
END $$;

COMMIT;
