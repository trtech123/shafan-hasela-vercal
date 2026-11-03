-- Disabled on installation. Keep the original and first future cutoffs immutable.
-- A later canary is prepared only by an explicit service-role/admin action.
BEGIN;

CREATE FUNCTION public.payper_effective_cutoff() RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(
   (SELECT a.new_cutoff_utc FROM public.payper_activation_epoch_audit a
     ORDER BY a.id DESC LIMIT 1),
   (SELECT c.future_cutoff_utc FROM public.payper_dispatch_control c WHERE c.singleton),
   (SELECT c.activation_cutoff_utc FROM public.payper_dispatch_control c WHERE c.singleton));
$$;
REVOKE ALL ON FUNCTION public.payper_effective_cutoff() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.payper_effective_cutoff() TO authenticated,service_role;

CREATE FUNCTION public.prepare_payper_next_canary(p_actor_id uuid) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE control_row public.payper_dispatch_control%ROWTYPE;
 previous_cutoff timestamptz; cutoff timestamptz;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
   (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin')
 THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO control_row FROM public.payper_dispatch_control WHERE singleton FOR UPDATE;
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
REVOKE ALL ON FUNCTION public.prepare_payper_next_canary(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_payper_next_canary(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.target_payper_canary(p_actor_id uuid,p_payment_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cutoff timestamptz;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
   (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin')
 THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.payper_dispatch_control WHERE singleton AND enabled
   AND dispatch_mode='canary' AND canary_payment_id IS NULL
   AND dispatch_remaining=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'payper_canary_not_ready' USING ERRCODE='42501'; END IF;
 cutoff:=public.payper_effective_cutoff();
 IF cutoff IS NULL THEN RAISE EXCEPTION 'payper_canary_not_ready' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payment_transactions p WHERE p.id=p_payment_id
   AND p.provider='pelecard' AND p.operation='payment' AND p.created_at>=cutoff
   AND p.verified_at IS NULL AND p.status<>'succeeded')
 THEN RAISE EXCEPTION 'payper_canary_payment_invalid' USING ERRCODE='23514'; END IF;
 UPDATE public.payper_dispatch_control SET canary_payment_id=p_payment_id WHERE singleton;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.list_payper_dispatch_candidates(p_target_payment_id uuid DEFAULT NULL)
RETURNS TABLE(payment_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE control_row public.payper_dispatch_control%ROWTYPE; cutoff timestamptz;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role'
 THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO control_row FROM public.payper_dispatch_control WHERE singleton;
 cutoff:=public.payper_effective_cutoff();
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
 WHERE l.payment_id IS NULL AND public.payper_effective_cutoff() IS NOT NULL
  AND p.provider='pelecard' AND p.operation='payment' AND p.status='succeeded'
  AND p.created_at>=public.payper_effective_cutoff()
  AND p.verified_at>=public.payper_effective_cutoff();

CREATE OR REPLACE FUNCTION public.reserve_payper_dispatch(p_payment_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.payper_document_ledger%ROWTYPE; p public.payment_transactions%ROWTYPE;
 control_row public.payper_dispatch_control%ROWTYPE; cutoff timestamptz;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role'
 THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO control_row FROM public.payper_dispatch_control WHERE singleton FOR UPDATE;
 cutoff:=public.payper_effective_cutoff();
 IF NOT control_row.enabled OR cutoff IS NULL OR control_row.dispatch_mode='disabled'
 THEN RAISE EXCEPTION 'payper_dispatch_disabled' USING ERRCODE='42501'; END IF;
 IF control_row.dispatch_mode='canary' AND
   (control_row.canary_payment_id IS DISTINCT FROM p_payment_id OR control_row.dispatch_remaining<>1)
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
