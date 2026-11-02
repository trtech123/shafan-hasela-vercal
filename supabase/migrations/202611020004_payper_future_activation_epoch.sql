-- Disabled installation. A new epoch requires a separate, explicit admin action.
-- The original activation cutoff and all existing ledger rows remain immutable.
BEGIN;

ALTER TABLE public.payper_dispatch_control ADD COLUMN future_cutoff_utc timestamptz;
CREATE TABLE public.payper_activation_epoch_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  previous_cutoff_utc timestamptz NOT NULL,
  previous_canary_payment_id uuid,
  new_cutoff_utc timestamptz NOT NULL UNIQUE,
  actor_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON public.payper_activation_epoch_audit FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY payper_epoch_admin_read ON public.payper_activation_epoch_audit
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role::text='admin'));
ALTER TABLE public.payper_activation_epoch_audit ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.payper_activation_epoch_audit TO authenticated,service_role;

CREATE FUNCTION public.lock_payper_future_cutoff() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.future_cutoff_utc IS NOT NULL AND NEW.future_cutoff_utc IS DISTINCT FROM OLD.future_cutoff_utc
 THEN RAISE EXCEPTION 'payper_future_cutoff_immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_lock_payper_future_cutoff BEFORE UPDATE ON public.payper_dispatch_control
 FOR EACH ROW EXECUTE FUNCTION public.lock_payper_future_cutoff();
REVOKE ALL ON FUNCTION public.lock_payper_future_cutoff() FROM PUBLIC,anon,authenticated,service_role;

-- This is deliberately one-time. Further epochs require a separately reviewed migration.
CREATE FUNCTION public.activate_payper_future_canary(p_actor_id uuid) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE control_row public.payper_dispatch_control%ROWTYPE; cutoff timestamptz;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
  (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin')
 THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO control_row FROM public.payper_dispatch_control WHERE singleton FOR UPDATE;
 IF control_row.future_cutoff_utc IS NOT NULL
 THEN RAISE EXCEPTION 'payper_future_activation_already_recorded' USING ERRCODE='23514'; END IF;
 IF control_row.enabled OR control_row.activation_cutoff_utc IS NULL
  OR control_row.dispatch_mode NOT IN ('canary','continuous')
  OR EXISTS (SELECT 1 FROM public.payper_document_ledger WHERE state='dispatch_reserved')
 THEN RAISE EXCEPTION 'payper_future_activation_not_ready' USING ERRCODE='42501'; END IF;
 cutoff:=statement_timestamp();
 IF cutoff<=control_row.activation_cutoff_utc
 THEN RAISE EXCEPTION 'payper_future_cutoff_not_new' USING ERRCODE='23514'; END IF;
 INSERT INTO public.payper_activation_epoch_audit
  (previous_cutoff_utc,previous_canary_payment_id,new_cutoff_utc,actor_id)
 VALUES (control_row.activation_cutoff_utc,control_row.canary_payment_id,cutoff,p_actor_id);
 UPDATE public.payper_dispatch_control SET future_cutoff_utc=cutoff,
  canary_payment_id=NULL,dispatch_mode='canary',dispatch_remaining=1,enabled=true
 WHERE singleton;
 RETURN cutoff;
END $$;
REVOKE ALL ON FUNCTION public.activate_payper_future_canary(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.activate_payper_future_canary(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.target_payper_canary(p_actor_id uuid,p_payment_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cutoff timestamptz;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
  (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin')
 THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(future_cutoff_utc,activation_cutoff_utc) INTO cutoff
 FROM public.payper_dispatch_control WHERE singleton AND enabled AND dispatch_mode='canary'
  AND canary_payment_id IS NULL AND dispatch_remaining=1 FOR UPDATE;
 IF cutoff IS NULL THEN RAISE EXCEPTION 'payper_canary_not_ready' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payment_transactions p WHERE p.id=p_payment_id
   AND p.provider='pelecard' AND p.operation='payment' AND p.created_at>=cutoff
   AND p.verified_at IS NULL AND p.status<>'succeeded')
 THEN RAISE EXCEPTION 'payper_canary_payment_invalid' USING ERRCODE='23514'; END IF;
 UPDATE public.payper_dispatch_control SET canary_payment_id=p_payment_id WHERE singleton;
 RETURN true;
END $$;

-- The worker reads this authoritative queue. Old eligible rows never enter it.
CREATE FUNCTION public.list_payper_dispatch_candidates(p_target_payment_id uuid DEFAULT NULL)
RETURNS TABLE(payment_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE control_row public.payper_dispatch_control%ROWTYPE; cutoff timestamptz;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role'
 THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO control_row FROM public.payper_dispatch_control WHERE singleton;
 cutoff:=coalesce(control_row.future_cutoff_utc,control_row.activation_cutoff_utc);
 IF NOT control_row.enabled OR cutoff IS NULL OR control_row.dispatch_mode='disabled'
  OR (control_row.dispatch_mode='canary' AND
   (control_row.canary_payment_id IS NULL OR control_row.dispatch_remaining<>1))
 THEN RETURN; END IF;
 RETURN QUERY SELECT l.payment_id FROM public.payper_document_ledger l
 JOIN public.payment_transactions p ON p.id=l.payment_id
 WHERE l.state IN ('eligible','source_frozen')
  AND p.provider='pelecard' AND p.operation='payment' AND p.status='succeeded'
  AND p.created_at>=cutoff AND p.verified_at>=cutoff AND p.verified_at>=p.created_at
  AND (p_target_payment_id IS NULL OR p.id=p_target_payment_id)
  AND (control_row.dispatch_mode<>'canary' OR p.id=control_row.canary_payment_id)
 ORDER BY p.created_at,l.payment_id LIMIT 1;
END $$;
REVOKE ALL ON FUNCTION public.list_payper_dispatch_candidates(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_payper_dispatch_candidates(uuid) TO service_role;

-- Keep existing held obligations visible while new missing-ledger alerts begin
-- at the new epoch, avoiding false backfill alerts for intervening payments.
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
 WHERE l.payment_id IS NULL
  AND coalesce(control.future_cutoff_utc,control.activation_cutoff_utc) IS NOT NULL
  AND p.provider='pelecard' AND p.operation='payment' AND p.status='succeeded'
  AND p.created_at>=coalesce(control.future_cutoff_utc,control.activation_cutoff_utc)
  AND p.verified_at>=coalesce(control.future_cutoff_utc,control.activation_cutoff_utc);

-- Existing atomic reservation and Rivhit duplicate-document fences remain.
CREATE OR REPLACE FUNCTION public.reserve_payper_dispatch(p_payment_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.payper_document_ledger%ROWTYPE; p public.payment_transactions%ROWTYPE;
 control_row public.payper_dispatch_control%ROWTYPE; cutoff timestamptz;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO control_row FROM public.payper_dispatch_control WHERE singleton FOR UPDATE;
 cutoff:=coalesce(control_row.future_cutoff_utc,control_row.activation_cutoff_utc);
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

COMMIT;
