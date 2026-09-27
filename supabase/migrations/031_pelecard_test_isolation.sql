-- Separate TEST ledger. Never used by commercial finalization/accounting.
-- No LIVE secret, existing ledger, order, sale, or Rivhit behavior is changed.
BEGIN;
CREATE TABLE public.pelecard_test_payments (
  id UUID PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'test' CHECK (mode = 'test'),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  amount_minor INTEGER NOT NULL DEFAULT 100 CHECK (amount_minor = 100),
  currency TEXT NOT NULL DEFAULT 'ILS' CHECK (currency = 'ILS'),
  status TEXT NOT NULL DEFAULT 'initiating' CHECK (status IN ('initiating','pending','test_verified')),
  redirect_url TEXT,
  confirmation_key TEXT,
  provider_transaction_id TEXT UNIQUE CHECK (length(provider_transaction_id) BETWEEN 1 AND 100 AND btrim(provider_transaction_id)=provider_transaction_id),
  api_status TEXT,
  transaction_status TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status = 'initiating' OR (redirect_url IS NOT NULL AND confirmation_key IS NOT NULL)),
  CHECK (status <> 'test_verified' OR (
    provider_transaction_id IS NOT NULL AND api_status = '000' AND transaction_status = '000'
    AND api_status IS NOT NULL AND transaction_status IS NOT NULL AND verified_at IS NOT NULL
  )),
  CHECK (status = 'test_verified' OR (provider_transaction_id IS NULL AND api_status IS NULL AND transaction_status IS NULL AND verified_at IS NULL))
);
COMMENT ON TABLE public.pelecard_test_payments IS 'Non-commercial Pelecard TEST evidence only. No order, sale, receipt or accounting side effects.';
ALTER TABLE public.pelecard_test_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pelecard_test_payments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pelecard_test_payments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.pelecard_test_payments TO service_role;

CREATE FUNCTION public.guard_pelecard_test_payment() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF ROW(NEW.id,NEW.mode,NEW.created_by,NEW.amount_minor,NEW.currency,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.mode,OLD.created_by,OLD.amount_minor,OLD.currency,OLD.created_at) THEN
    RAISE EXCEPTION 'test_identity_immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT ((OLD.status='initiating' AND NEW.status='pending') OR
          (OLD.status='pending' AND NEW.status='test_verified')) THEN
    RAISE EXCEPTION 'invalid_test_transition' USING ERRCODE = '23514';
  END IF;
  IF OLD.status='pending' AND ROW(NEW.confirmation_key,NEW.redirect_url) IS DISTINCT FROM ROW(OLD.confirmation_key,OLD.redirect_url) THEN
    RAISE EXCEPTION 'test_identity_immutable' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_pelecard_test_payment() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_pelecard_test_payment BEFORE UPDATE ON public.pelecard_test_payments
FOR EACH ROW EXECUTE FUNCTION public.guard_pelecard_test_payment();
COMMIT;
