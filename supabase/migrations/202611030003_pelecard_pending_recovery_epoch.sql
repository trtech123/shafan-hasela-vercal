-- Rotate the pending-payment recovery cutoff only while recovery is stopped.
-- Each activation is future-only and retains the prior cutoff in an append-only audit.
-- This migration does not enable an Edge gate or install a schedule.
BEGIN;

CREATE TABLE public.pelecard_pending_recovery_epoch_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  previous_cutoff_utc timestamptz,
  cutoff_utc timestamptz NOT NULL UNIQUE,
  actor_id uuid,
  prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  origin text NOT NULL CHECK (origin IN ('legacy','activation')),
  CHECK (previous_cutoff_utc IS NULL OR cutoff_utc > previous_cutoff_utc)
);
INSERT INTO public.pelecard_pending_recovery_epoch_audit
  (previous_cutoff_utc,cutoff_utc,origin)
SELECT NULL,cutoff_utc,'legacy'
FROM public.pelecard_pending_recovery_control
WHERE singleton AND cutoff_utc IS NOT NULL;
ALTER TABLE public.pelecard_pending_recovery_epoch_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pelecard_pending_recovery_epoch_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pelecard_pending_recovery_epoch_audit FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.guard_pelecard_recovery_control() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'recovery_control_immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.cutoff_utc IS DISTINCT FROM OLD.cutoff_utc THEN
    IF OLD.cutoff_utc IS NOT NULL AND (
      current_setting('app.pending_recovery_epoch_rotation',true) IS DISTINCT FROM 'yes'
      OR OLD.enabled OR NOT NEW.enabled OR NEW.cutoff_utc IS NULL
      OR NEW.cutoff_utc<=OLD.cutoff_utc
      OR NEW.cutoff_utc<statement_timestamp()
    ) THEN
      RAISE EXCEPTION 'recovery_cutoff_immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.cutoff_utc IS NULL AND NEW.cutoff_utc IS NOT NULL
      AND NEW.cutoff_utc<statement_timestamp() THEN
      RAISE EXCEPTION 'recovery_cutoff_backdated' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.guard_pelecard_recovery_epoch_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  RAISE EXCEPTION 'recovery_epoch_audit_immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER guard_pelecard_recovery_epoch_audit BEFORE UPDATE OR DELETE
ON public.pelecard_pending_recovery_epoch_audit FOR EACH ROW
EXECUTE FUNCTION public.guard_pelecard_recovery_epoch_audit();
REVOKE ALL ON FUNCTION public.guard_pelecard_recovery_epoch_audit()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.start_pelecard_pending_recovery(p_actor_id uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_cutoff timestamptz; next_cutoff timestamptz; was_enabled boolean;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
    (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin')
  THEN RAISE EXCEPTION 'recovery_admin_required' USING ERRCODE='42501'; END IF;
  SELECT cutoff_utc,enabled INTO previous_cutoff,was_enabled
    FROM public.pelecard_pending_recovery_control WHERE singleton FOR UPDATE;
  IF was_enabled THEN
    RAISE EXCEPTION 'recovery_must_be_stopped' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pelecard_pending_recovery_jobs
    WHERE lease_until>clock_timestamp()) THEN
    RAISE EXCEPTION 'recovery_claim_in_flight' USING ERRCODE='23514';
  END IF;
  next_cutoff:=clock_timestamp();
  IF previous_cutoff IS NOT NULL AND next_cutoff<=previous_cutoff THEN
    RAISE EXCEPTION 'recovery_cutoff_not_future' USING ERRCODE='23514';
  END IF;
  PERFORM set_config('app.pending_recovery_epoch_rotation','yes',true);
  UPDATE public.pelecard_pending_recovery_control SET
    cutoff_utc=next_cutoff,enabled=true,started_at=next_cutoff,stopped_at=NULL
    WHERE singleton;
  PERFORM set_config('app.pending_recovery_epoch_rotation','',true);
  INSERT INTO public.pelecard_pending_recovery_epoch_audit
    (previous_cutoff_utc,cutoff_utc,actor_id,origin)
  VALUES(previous_cutoff,next_cutoff,p_actor_id,'activation');
  RETURN next_cutoff;
END $$;

COMMIT;
