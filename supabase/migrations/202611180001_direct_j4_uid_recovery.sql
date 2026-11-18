-- New direct J4 intents use a 19-character ParamX and can recover by UID.
-- Existing intents, including ORD-1062, remain ineligible and locked.
-- This migration does not settle, cancel, release, charge or issue anything.
BEGIN;

ALTER TABLE public.physical_payment_intents
  ADD COLUMN uid_recovery_enabled boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.guard_physical_uid_recovery() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.route='direct' AND coalesce(auth.role(),'')='service_role' THEN
      NEW.uid_recovery_enabled:=true;
    END IF;
  ELSIF NEW.uid_recovery_enabled IS DISTINCT FROM OLD.uid_recovery_enabled THEN
    RAISE EXCEPTION 'physical_uid_recovery_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_physical_uid_recovery_insert
  BEFORE INSERT ON public.physical_payment_intents FOR EACH ROW
  EXECUTE FUNCTION public.guard_physical_uid_recovery();
CREATE TRIGGER guard_physical_uid_recovery_update
  BEFORE UPDATE OF uid_recovery_enabled
  ON public.physical_payment_intents FOR EACH ROW
  EXECUTE FUNCTION public.guard_physical_uid_recovery();
REVOKE ALL ON FUNCTION public.guard_physical_uid_recovery()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_physical_worker_intent(p_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.physical_payment_intents%ROWTYPE; doc_state text;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO i FROM public.physical_payment_intents WHERE payment_id=p_payment_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT state INTO doc_state FROM public.payper_document_ledger
    WHERE payment_id=p_payment_id;
  RETURN jsonb_build_object('id',i.payment_id,'state',i.state,'route',i.route,
    'register',i.register_number,'amountMinor',i.amount_minor,
    'verifiedAmountMinor',i.verified_amount_minor,
    'merchantTerminal',i.terminal_number,'transactionId',i.provider_transaction_id,
    'uid',i.provider_uid,'saleId',i.sale_id,'firstResponse',i.first_response,
    'uidRecoveryEnabled',i.uid_recovery_enabled,
    'documentState',doc_state,'hostedTransactionId',i.hosted_transaction_id,
    'hostedConfirmationKey',i.hosted_confirmation_key,
    'hostedRedirectUrl',i.hosted_redirect_url);
END $$;

COMMIT;
