-- Install disabled. Activation and the recovery schedule require separate authorization.
BEGIN;

ALTER TABLE public.payper_dispatch_control
  ADD COLUMN dispatch_mode text NOT NULL DEFAULT 'disabled'
    CHECK (dispatch_mode IN ('disabled','canary','continuous')),
  ADD COLUMN canary_payment_id uuid REFERENCES public.payment_transactions(id);
ALTER TABLE public.payper_dispatch_control ADD CONSTRAINT payper_mode_fence CHECK (
  (dispatch_mode = 'disabled' AND NOT enabled AND canary_payment_id IS NULL)
  OR (dispatch_mode = 'canary' AND activation_cutoff_utc IS NOT NULL)
  OR (dispatch_mode = 'continuous' AND activation_cutoff_utc IS NOT NULL
      AND canary_payment_id IS NOT NULL AND dispatch_remaining = 0));
CREATE INDEX payper_eligible_scan_idx ON public.payper_document_ledger(created_at,payment_id)
 WHERE state IN ('eligible','source_frozen');
CREATE INDEX payper_missing_ledger_check_idx ON public.payment_transactions(created_at,id)
 WHERE provider='pelecard' AND operation='payment' AND status='succeeded';
CREATE POLICY payper_control_admin_read ON public.payper_dispatch_control FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role::text='admin'));
GRANT SELECT ON public.payper_dispatch_control TO authenticated;

-- The original activation RPC remains the only way to set the immutable cutoff.
-- Dispatch cannot reach the provider until a specific new payment is targeted.
CREATE OR REPLACE FUNCTION public.activate_payper_new_payments(p_actor_id uuid) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cutoff timestamptz;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
  (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin')
 THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 UPDATE public.payper_dispatch_control SET activation_cutoff_utc=statement_timestamp(),
  enabled=true,dispatch_mode='canary',dispatch_remaining=1
 WHERE singleton AND activation_cutoff_utc IS NULL AND enabled=false
 RETURNING activation_cutoff_utc INTO cutoff;
 IF cutoff IS NULL THEN RAISE EXCEPTION 'payper_activation_already_recorded' USING ERRCODE='23514'; END IF;
 RETURN cutoff;
END $$;

CREATE FUNCTION public.target_payper_canary(p_actor_id uuid,p_payment_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cutoff timestamptz;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
  (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin')
 THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 SELECT activation_cutoff_utc INTO cutoff FROM public.payper_dispatch_control
  WHERE singleton AND enabled AND dispatch_mode='canary' AND canary_payment_id IS NULL FOR UPDATE;
 IF cutoff IS NULL THEN RAISE EXCEPTION 'payper_canary_not_ready' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payment_transactions p WHERE p.id=p_payment_id
   AND p.provider='pelecard' AND p.operation='payment' AND p.created_at>=cutoff
   AND p.verified_at IS NULL AND p.status<>'succeeded')
 THEN RAISE EXCEPTION 'payper_canary_payment_invalid' USING ERRCODE='23514'; END IF;
 UPDATE public.payper_dispatch_control SET canary_payment_id=p_payment_id WHERE singleton;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.target_payper_canary(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.target_payper_canary(uuid,uuid) TO service_role;

-- A second explicit authorization is required after the canary document succeeds.
CREATE FUNCTION public.enable_payper_continuous(p_actor_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
  (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin')
 THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 SELECT canary_payment_id INTO target FROM public.payper_dispatch_control
  WHERE singleton AND dispatch_mode='canary' AND activation_cutoff_utc IS NOT NULL FOR UPDATE;
 IF target IS NULL OR NOT EXISTS(SELECT 1 FROM public.payper_document_ledger
   WHERE payment_id=target AND state='succeeded' AND document_number IS NOT NULL
     AND document_url IS NOT NULL)
 THEN RAISE EXCEPTION 'payper_canary_document_required' USING ERRCODE='42501'; END IF;
 UPDATE public.payper_dispatch_control SET enabled=true,dispatch_mode='continuous',
  dispatch_remaining=0 WHERE singleton;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.enable_payper_continuous(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.enable_payper_continuous(uuid) TO service_role;

CREATE FUNCTION public.stop_payper_dispatch(p_actor_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
  (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin')
 THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 UPDATE public.payper_dispatch_control SET enabled=false WHERE singleton;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.stop_payper_dispatch(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.stop_payper_dispatch(uuid) TO service_role;

-- Keep the original verified-payment and duplicate-document fences. Row locking
-- plus the one-way ledger state prevents simultaneous wake and scan dispatch.
CREATE OR REPLACE FUNCTION public.reserve_payper_dispatch(p_payment_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.payper_document_ledger%ROWTYPE; p public.payment_transactions%ROWTYPE;
 control_row public.payper_dispatch_control%ROWTYPE; cutoff timestamptz;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO control_row FROM public.payper_dispatch_control WHERE singleton FOR UPDATE;
 cutoff:=control_row.activation_cutoff_utc;
 IF NOT control_row.enabled OR cutoff IS NULL OR control_row.dispatch_mode='disabled'
 THEN RAISE EXCEPTION 'payper_dispatch_disabled' USING ERRCODE='42501'; END IF;
 IF control_row.dispatch_mode='canary' AND (control_row.canary_payment_id IS DISTINCT FROM p_payment_id
   OR control_row.dispatch_remaining<>1)
 THEN RAISE EXCEPTION 'payper_dispatch_limit_reached' USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM public.payper_document_ledger WHERE payment_id=p_payment_id FOR UPDATE;
 IF NOT FOUND OR l.state<>'source_frozen' THEN RAISE EXCEPTION 'payper_dispatch_fence'; END IF;
 SELECT * INTO p FROM public.payment_transactions WHERE id=p_payment_id;
 IF p.provider IS DISTINCT FROM 'pelecard' OR p.operation IS DISTINCT FROM 'payment'
 OR p.status IS DISTINCT FROM 'succeeded' OR p.created_at<cutoff OR p.verified_at<cutoff
 OR p.created_at IS NULL OR p.verified_at IS NULL OR p.verified_at<p.created_at
 THEN RAISE EXCEPTION 'payper_activation_fence'; END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_documents d
   WHERE (d.source_type='payment_transaction' AND d.source_id=p_payment_id::text)
   OR (d.source_type='order' AND d.source_id=l.order_id::text)
   OR (d.source_type='sale' AND d.source_id=l.sale_id::text))
 OR EXISTS(SELECT 1 FROM public.immediate_accounting_preparations a
   WHERE a.payment_id=p_payment_id AND a.dispatch_started_at IS NOT NULL)
 THEN RAISE EXCEPTION 'existing_accounting_document_or_dispatch'; END IF;
 IF control_row.dispatch_mode='canary' THEN
  UPDATE public.payper_dispatch_control SET dispatch_remaining=0 WHERE singleton;
 END IF;
 UPDATE public.payper_document_ledger SET state='dispatch_reserved',
  dispatch_reserved_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=l.id;
 RETURN l.id;
END $$;

-- Admin-visible, durable exceptions are derived from the ledger itself. No PII.
CREATE VIEW public.payper_accounting_exceptions WITH (security_invoker=true) AS
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
       AND l.updated_at<now()-interval '2 minutes')) AS actionable
 FROM public.payper_document_ledger l
 JOIN public.payment_transactions p ON p.id=l.payment_id
 LEFT JOIN public.orders o ON o.id=l.order_id
 WHERE l.state IN ('eligible','source_frozen','source_blocked','dispatch_reserved','reconciliation_required')
 UNION ALL
 SELECT p.id,p.order_id,p.sale_id,o.order_number,'missing_ledger'::text,
  'ledger_missing'::text,p.created_at,p.verified_at,NULL::timestamptz,
  p.provider_transaction_id,'missing_ledger'::text,true
 FROM public.payment_transactions p
 JOIN public.payper_dispatch_control control ON control.singleton
 LEFT JOIN public.payper_document_ledger l ON l.payment_id=p.id
 LEFT JOIN public.orders o ON o.id=p.order_id
 WHERE l.payment_id IS NULL AND control.activation_cutoff_utc IS NOT NULL
  AND p.provider='pelecard' AND p.operation='payment' AND p.status='succeeded'
  AND p.created_at>=control.activation_cutoff_utc
  AND p.verified_at>=control.activation_cutoff_utc;
REVOKE ALL ON public.payper_accounting_exceptions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.payper_accounting_exceptions TO authenticated,service_role;

COMMIT;
