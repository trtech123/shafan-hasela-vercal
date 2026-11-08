-- Disable only a definitively canceled, never-hosted canary. Paid and uncertain
-- transactions are untouched. Installation itself changes no control state.
BEGIN;

CREATE TABLE public.payper_stale_canary_retirements (
  payment_id uuid PRIMARY KEY REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
  previous_cutoff_utc timestamptz NOT NULL,
  reason_code text NOT NULL CHECK (reason_code = 'canceled_before_hosted_checkout'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.payper_stale_canary_retirements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payper_stale_canary_retirements FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY payper_stale_retirement_admin_read ON public.payper_stale_canary_retirements
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role::text='admin')
  );
GRANT SELECT ON public.payper_stale_canary_retirements TO authenticated, service_role;

CREATE FUNCTION public.reject_payper_stale_retirement_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'payper_stale_retirement_immutable' USING ERRCODE='42501'; END $$;
CREATE TRIGGER trg_payper_stale_retirement_immutable BEFORE UPDATE OR DELETE
  ON public.payper_stale_canary_retirements FOR EACH ROW
  EXECUTE FUNCTION public.reject_payper_stale_retirement_mutation();
REVOKE ALL ON FUNCTION public.reject_payper_stale_retirement_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.retire_canceled_payper_canary() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE control_row public.payper_dispatch_control%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role'
  THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO control_row FROM public.payper_dispatch_control WHERE singleton FOR UPDATE;
  IF NOT control_row.enabled OR control_row.dispatch_mode <> 'canary'
    OR control_row.canary_payment_id IS NULL OR control_row.dispatch_remaining <> 1
  THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_transactions p
    WHERE p.id=control_row.canary_payment_id AND p.status='failed'
      AND p.failure_code='cashier_cancelled' AND p.verified_at IS NULL
      AND p.provider_session_id IS NULL AND p.provider_transaction_id IS NULL
      AND p.sale_id IS NULL AND p.order_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.pos_pelecard_intents i
        WHERE i.payment_id=p.id AND (i.dispatch_started_at IS NOT NULL OR i.transaction_id IS NOT NULL))
      AND NOT EXISTS (SELECT 1 FROM public.payper_document_ledger l WHERE l.payment_id=p.id)
  ) THEN RETURN false; END IF;
  INSERT INTO public.payper_stale_canary_retirements
    (payment_id,previous_cutoff_utc,reason_code)
  VALUES (control_row.canary_payment_id,public.payper_effective_cutoff(),
    'canceled_before_hosted_checkout');
  UPDATE public.payper_dispatch_control SET enabled=false WHERE singleton;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.retire_canceled_payper_canary()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retire_canceled_payper_canary() TO service_role;

COMMIT;
