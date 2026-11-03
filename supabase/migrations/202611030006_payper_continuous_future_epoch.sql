-- Install disabled. Continuous issuance still requires a successful canary and
-- a separate, explicit service-role/admin activation after this migration.
BEGIN;

ALTER TABLE public.payper_dispatch_control DROP CONSTRAINT payper_mode_fence;
ALTER TABLE public.payper_dispatch_control ADD CONSTRAINT payper_mode_fence CHECK (
  (dispatch_mode = 'disabled' AND NOT enabled AND canary_payment_id IS NULL)
  OR (dispatch_mode = 'canary' AND activation_cutoff_utc IS NOT NULL)
  OR (dispatch_mode = 'continuous' AND activation_cutoff_utc IS NOT NULL
      AND canary_payment_id IS NULL AND dispatch_remaining = 0));

-- The canary target is evidence for this transition, not a continuous filter.
-- A new append-only epoch excludes every payment created before activation.
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
     AND l.state='succeeded' AND l.document_number IS NOT NULL
     AND l.document_url IS NOT NULL
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
REVOKE ALL ON FUNCTION public.enable_payper_continuous(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.enable_payper_continuous(uuid) TO service_role;

COMMIT;
