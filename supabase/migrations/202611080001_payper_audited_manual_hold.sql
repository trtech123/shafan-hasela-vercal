-- An accountant-managed obligation is explicit, immutable and never dispatchable.
-- Installation does not change an existing payment, document or activation gate.
BEGIN;

CREATE TABLE public.payper_manual_accounting_holds (
  payment_id uuid PRIMARY KEY REFERENCES public.payper_document_ledger(payment_id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  reason_code text NOT NULL CHECK (reason_code = 'accountant_managed'),
  previous_state text NOT NULL CHECK (previous_state = 'eligible'),
  previous_cutoff_utc timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.payper_manual_accounting_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payper_manual_accounting_holds FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY payper_manual_hold_admin_read ON public.payper_manual_accounting_holds
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role::text='admin')
  );
GRANT SELECT ON public.payper_manual_accounting_holds TO authenticated, service_role;

CREATE FUNCTION public.reject_payper_manual_hold_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'payper_manual_hold_immutable' USING ERRCODE='42501'; END $$;
CREATE TRIGGER trg_payper_manual_hold_immutable BEFORE UPDATE OR DELETE
  ON public.payper_manual_accounting_holds FOR EACH ROW
  EXECUTE FUNCTION public.reject_payper_manual_hold_mutation();
REVOKE ALL ON FUNCTION public.reject_payper_manual_hold_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.hold_payper_for_accountant(p_payment_id uuid, p_actor_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  control_row public.payper_dispatch_control%ROWTYPE;
  ledger_row public.payper_document_ledger%ROWTYPE;
  payment_row public.payment_transactions%ROWTYPE;
  cutoff timestamptz;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin'
  ) THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO control_row FROM public.payper_dispatch_control WHERE singleton FOR UPDATE;
  SELECT * INTO ledger_row FROM public.payper_document_ledger
    WHERE payment_id=p_payment_id FOR UPDATE;
  SELECT * INTO payment_row FROM public.payment_transactions WHERE id=p_payment_id;
  cutoff := public.payper_effective_cutoff();
  IF control_row.enabled OR cutoff IS NULL OR ledger_row.payment_id IS NULL
    OR ledger_row.state <> 'eligible' OR ledger_row.dispatch_reserved_at IS NOT NULL
    OR ledger_row.document_number IS NOT NULL OR ledger_row.document_url IS NOT NULL
    OR payment_row.provider <> 'pelecard' OR payment_row.operation <> 'payment'
    OR payment_row.status <> 'succeeded' OR payment_row.verified_at IS NULL
    OR payment_row.sale_id IS DISTINCT FROM ledger_row.sale_id
    OR payment_row.order_id IS DISTINCT FROM ledger_row.order_id
    OR EXISTS (SELECT 1 FROM public.payper_provider_response_diagnostics d
      WHERE d.payment_id=p_payment_id)
    OR EXISTS (SELECT 1 FROM public.payper_manual_document_audit a
      WHERE a.payment_id=p_payment_id)
    OR EXISTS (SELECT 1 FROM public.accounting_documents d
      WHERE d.status='succeeded' AND d.source_id IN
        (p_payment_id::text, ledger_row.sale_id::text, ledger_row.order_id::text))
  THEN RAISE EXCEPTION 'payper_manual_hold_not_safe' USING ERRCODE='42501'; END IF;
  INSERT INTO public.payper_manual_accounting_holds
    (payment_id,actor_id,reason_code,previous_state,previous_cutoff_utc)
  VALUES (p_payment_id,p_actor_id,'accountant_managed',ledger_row.state,cutoff);
  UPDATE public.payper_document_ledger SET state='source_blocked',
    reconciliation_code='manual_accounting_hold',updated_at=clock_timestamp()
    WHERE payment_id=p_payment_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.hold_payper_for_accountant(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hold_payper_for_accountant(uuid,uuid) TO service_role;

-- Keep the original eligibility fence. Lock writers while checking it so a
-- concurrently finalized payment cannot disappear behind a new cutoff.
CREATE OR REPLACE FUNCTION public.prepare_payper_next_canary(p_actor_id uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE control_row public.payper_dispatch_control%ROWTYPE;
 previous_cutoff timestamptz; cutoff timestamptz;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
   (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin')
 THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO control_row FROM public.payper_dispatch_control WHERE singleton FOR UPDATE;
 LOCK TABLE public.payment_transactions, public.payper_document_ledger
   IN SHARE ROW EXCLUSIVE MODE;
 previous_cutoff:=public.payper_effective_cutoff();
 IF control_row.enabled OR control_row.dispatch_mode NOT IN ('canary','continuous')
   OR control_row.future_cutoff_utc IS NULL OR previous_cutoff IS NULL
   OR EXISTS (SELECT 1 FROM public.payper_document_ledger WHERE state='dispatch_reserved')
   OR EXISTS (
     SELECT 1 FROM public.payper_document_ledger l
     JOIN public.payment_transactions p ON p.id=l.payment_id
     WHERE l.state IN ('eligible','source_frozen') AND p.created_at>=previous_cutoff)
   OR EXISTS (
     SELECT 1 FROM public.payment_transactions p
     LEFT JOIN public.payper_document_ledger l ON l.payment_id=p.id
     WHERE p.provider='pelecard' AND p.operation='payment' AND p.status='succeeded'
       AND p.created_at>=previous_cutoff AND l.payment_id IS NULL)
 THEN RAISE EXCEPTION 'payper_next_canary_not_ready' USING ERRCODE='42501'; END IF;
 cutoff:=clock_timestamp();
 IF cutoff<=previous_cutoff
 THEN RAISE EXCEPTION 'payper_next_cutoff_not_new' USING ERRCODE='23514'; END IF;
 INSERT INTO public.payper_activation_epoch_audit
   (previous_cutoff_utc,previous_canary_payment_id,new_cutoff_utc,actor_id)
 VALUES (previous_cutoff,control_row.canary_payment_id,cutoff,p_actor_id);
 UPDATE public.payper_dispatch_control SET enabled=true,dispatch_mode='canary',
   canary_payment_id=NULL,dispatch_remaining=1 WHERE singleton;
 RETURN cutoff;
END $$;

CREATE OR REPLACE VIEW public.payper_accounting_exceptions WITH (security_invoker=true) AS
 SELECT l.payment_id,l.order_id,l.sale_id,o.order_number,l.state,
  l.reconciliation_code,l.created_at,l.updated_at,l.dispatch_reserved_at,
  p.provider_transaction_id,
  CASE WHEN l.state='source_blocked' AND l.reconciliation_code='manual_accounting_hold'
         THEN 'manual_accounting_hold'
       WHEN l.state='source_blocked' THEN 'missing_or_invalid_source'
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

COMMIT;
