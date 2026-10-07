-- Prepared fallback only. Apply separately after explicit deployment approval.
-- Existing uncertain reservations remain NULL/ineligible; no backfill or reset.
BEGIN;
ALTER TABLE public.pelecard_test_payments
  ADD COLUMN init_transport TEXT CHECK (init_transport IS NULL OR init_transport='node_v1'),
  ADD COLUMN init_dispatch_started_at TIMESTAMPTZ,
  ADD COLUMN init_quarantined_at TIMESTAMPTZ,
  ADD COLUMN init_quarantine_reason TEXT,
  ADD CONSTRAINT test_quarantine_reason CHECK (
    (init_quarantined_at IS NULL AND init_quarantine_reason IS NULL) OR
    (init_quarantined_at IS NOT NULL AND init_quarantine_reason IS NOT NULL AND length(init_quarantine_reason) BETWEEN 10 AND 512)),
  ADD CONSTRAINT test_dispatch_transport CHECK (init_dispatch_started_at IS NULL OR init_transport='node_v1');

CREATE OR REPLACE FUNCTION public.guard_pelecard_test_payment() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.init_quarantined_at IS NOT NULL THEN
    RAISE EXCEPTION 'test_quarantined' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW.id,NEW.mode,NEW.created_by,NEW.amount_minor,NEW.currency,NEW.created_at,NEW.init_transport)
    IS DISTINCT FROM ROW(OLD.id,OLD.mode,OLD.created_by,OLD.amount_minor,OLD.currency,OLD.created_at,OLD.init_transport) THEN
    RAISE EXCEPTION 'test_identity_immutable' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW.init_quarantined_at,NEW.init_quarantine_reason) IS DISTINCT FROM ROW(OLD.init_quarantined_at,OLD.init_quarantine_reason) THEN
    IF OLD.status<>'initiating' OR NEW.init_quarantined_at IS NULL OR NEW.init_quarantine_reason IS NULL OR
       (to_jsonb(NEW)-'init_quarantined_at'-'init_quarantine_reason'-'updated_at') IS DISTINCT FROM
       (to_jsonb(OLD)-'init_quarantined_at'-'init_quarantine_reason'-'updated_at') THEN
      RAISE EXCEPTION 'invalid_test_quarantine' USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF NEW.init_dispatch_started_at IS DISTINCT FROM OLD.init_dispatch_started_at THEN
    IF OLD.init_dispatch_started_at IS NOT NULL OR NEW.init_dispatch_started_at IS NULL OR
       OLD.init_transport IS DISTINCT FROM 'node_v1' OR OLD.status<>'initiating' OR
       (to_jsonb(NEW)-'init_dispatch_started_at'-'updated_at') IS DISTINCT FROM
       (to_jsonb(OLD)-'init_dispatch_started_at'-'updated_at') THEN
      RAISE EXCEPTION 'invalid_test_dispatch' USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF NOT ((OLD.status='initiating' AND NEW.status='pending') OR
          (OLD.status='pending' AND NEW.status='test_verified')) THEN
    RAISE EXCEPTION 'invalid_test_transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.init_transport='node_v1' AND NEW.init_dispatch_started_at IS NULL THEN
    RAISE EXCEPTION 'test_dispatch_required' USING ERRCODE = '23514';
  END IF;
  IF OLD.status='pending' AND ROW(NEW.confirmation_key,NEW.redirect_url) IS DISTINCT FROM ROW(OLD.confirmation_key,OLD.redirect_url) THEN
    RAISE EXCEPTION 'test_identity_immutable' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pelecard_test_init_adapter') THEN
    CREATE ROLE pelecard_test_init_adapter NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO pelecard_test_init_adapter;
CREATE FUNCTION public.claim_pelecard_test_init(p_id UUID)
RETURNS TABLE(amount_minor INTEGER,currency TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.pelecard_test_payments AS p SET init_dispatch_started_at=clock_timestamp()
  WHERE p.id=p_id AND p.mode='test' AND p.amount_minor=100 AND p.currency='ILS'
    AND p.status='initiating' AND p.init_transport='node_v1' AND p.init_dispatch_started_at IS NULL
    AND p.init_quarantined_at IS NULL
    AND p.created_at >= clock_timestamp()-interval '2 minutes'
  RETURNING p.amount_minor,p.currency;
$$;
REVOKE ALL ON FUNCTION public.claim_pelecard_test_init(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_pelecard_test_init(UUID) TO pelecard_test_init_adapter;
COMMENT ON FUNCTION public.claim_pelecard_test_init(UUID) IS 'Atomic at-most-once TEST dispatch only. Never release a claim after unknown provider outcome.';
COMMIT;
