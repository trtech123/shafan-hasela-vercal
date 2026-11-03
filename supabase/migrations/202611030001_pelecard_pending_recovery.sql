-- Future-only, read-only provider reconciliation. This migration does not
-- schedule a worker, enable recovery, charge a card, or dispatch an invoice.
BEGIN;

CREATE TABLE public.pelecard_pending_recovery_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  enabled boolean NOT NULL DEFAULT false,
  cutoff_utc timestamptz,
  started_at timestamptz,
  stopped_at timestamptz,
  CHECK(NOT enabled OR cutoff_utc IS NOT NULL)
);
INSERT INTO public.pelecard_pending_recovery_control(singleton) VALUES(true);
ALTER TABLE public.pelecard_pending_recovery_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pelecard_pending_recovery_control FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pelecard_pending_recovery_control FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.pelecard_pending_recovery_jobs (
  payment_id uuid PRIMARY KEY REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK(source IN ('pos','order')),
  claim_token uuid,
  lease_until timestamptz,
  state text NOT NULL DEFAULT 'watching' CHECK(state IN ('watching','attention','verified')),
  last_reason text CHECK(last_reason IN
    ('provider_pending','provider_declined','provider_unavailable','verification_mismatch','verified')),
  last_lookup_status text CHECK(last_lookup_status ~ '^[0-9]{2,4}$'),
  last_transaction_status text CHECK(last_transaction_status ~ '^[0-9]{2,4}$'),
  checks integer NOT NULL DEFAULT 0 CHECK(checks>=0),
  next_check_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX pelecard_pending_recovery_due ON public.pelecard_pending_recovery_jobs(next_check_at,lease_until)
  WHERE state<>'verified';
ALTER TABLE public.pelecard_pending_recovery_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pelecard_pending_recovery_jobs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pelecard_pending_recovery_jobs FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.guard_pelecard_recovery_control() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'recovery_control_immutable' USING ERRCODE='23514'; END IF;
  IF OLD.cutoff_utc IS NOT NULL AND NEW.cutoff_utc IS DISTINCT FROM OLD.cutoff_utc
  THEN RAISE EXCEPTION 'recovery_cutoff_immutable' USING ERRCODE='23514'; END IF;
  IF OLD.cutoff_utc IS NULL AND NEW.cutoff_utc IS NOT NULL AND NEW.cutoff_utc<statement_timestamp()
  THEN RAISE EXCEPTION 'recovery_cutoff_backdated' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_pelecard_recovery_control BEFORE UPDATE OR DELETE
ON public.pelecard_pending_recovery_control FOR EACH ROW
EXECUTE FUNCTION public.guard_pelecard_recovery_control();
REVOKE ALL ON FUNCTION public.guard_pelecard_recovery_control() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.start_pelecard_pending_recovery(p_actor_id uuid) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cutoff timestamptz;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
    (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin')
  THEN RAISE EXCEPTION 'recovery_admin_required' USING ERRCODE='42501'; END IF;
  SELECT cutoff_utc INTO cutoff FROM public.pelecard_pending_recovery_control WHERE singleton FOR UPDATE;
  IF cutoff IS NULL THEN
    cutoff:=clock_timestamp();
    UPDATE public.pelecard_pending_recovery_control
      SET cutoff_utc=cutoff,enabled=true,started_at=cutoff WHERE singleton;
  ELSE
    UPDATE public.pelecard_pending_recovery_control
      SET enabled=true,started_at=clock_timestamp() WHERE singleton;
  END IF;
  RETURN cutoff;
END $$;
CREATE FUNCTION public.stop_pelecard_pending_recovery(p_actor_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
    (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin')
  THEN RAISE EXCEPTION 'recovery_admin_required' USING ERRCODE='42501'; END IF;
  UPDATE public.pelecard_pending_recovery_control
    SET enabled=false,stopped_at=clock_timestamp() WHERE singleton;
END $$;
REVOKE ALL ON FUNCTION public.start_pelecard_pending_recovery(uuid),
  public.stop_pelecard_pending_recovery(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.start_pelecard_pending_recovery(uuid),
  public.stop_pelecard_pending_recovery(uuid) TO service_role;

CREATE FUNCTION public.claim_pelecard_pending_recovery()
RETURNS TABLE(payment_id uuid,source text,claim_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate record; token uuid; cutoff timestamptz;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT c.cutoff_utc INTO cutoff FROM public.pelecard_pending_recovery_control c
    WHERE c.singleton AND c.enabled;
  IF cutoff IS NULL THEN RETURN; END IF;
  SELECT p.id,CASE WHEN pos.payment_id IS NOT NULL THEN 'pos' ELSE 'order' END AS kind
  INTO candidate FROM public.payment_transactions p
  LEFT JOIN public.pos_pelecard_intents pos ON pos.payment_id=p.id
  LEFT JOIN public.pelecard_live_attempts ord ON ord.payment_id=p.id
  LEFT JOIN public.pelecard_pending_recovery_jobs job ON job.payment_id=p.id
  WHERE p.provider='pelecard' AND p.operation='payment' AND p.status='pending_provider'
    AND p.currency='ILS' AND p.provider_session_id IS NOT NULL
    AND p.created_at>=cutoff AND p.id NOT IN
      ('28b4786f-e722-40ae-9661-f3e805fc71bf'::uuid,
       '68a78d1c-8f79-4646-a5e4-4dfa201d20e8'::uuid)
    AND ((pos.payment_id IS NOT NULL AND pos.transaction_id=p.provider_session_id
          AND pos.dispatch_started_at>=cutoff)
      OR (ord.payment_id IS NOT NULL AND ord.transaction_id=p.provider_session_id
          AND ord.dispatch_started_at>=cutoff AND ord.closed_unpaid_at IS NULL))
    AND (job.payment_id IS NULL OR (job.state<>'verified'
      AND job.next_check_at<=clock_timestamp()
      AND (job.lease_until IS NULL OR job.lease_until<clock_timestamp())))
  ORDER BY p.created_at,p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  token:=gen_random_uuid();
  INSERT INTO public.pelecard_pending_recovery_jobs
    (payment_id,source,claim_token,lease_until,checks)
  VALUES(candidate.id,candidate.kind,token,clock_timestamp()+interval '2 minutes',1)
  ON CONFLICT ON CONSTRAINT pelecard_pending_recovery_jobs_pkey DO UPDATE SET
    claim_token=excluded.claim_token,lease_until=excluded.lease_until,
    checks=public.pelecard_pending_recovery_jobs.checks+1;
  RETURN QUERY SELECT candidate.id::uuid,candidate.kind::text,token;
END $$;
REVOKE ALL ON FUNCTION public.claim_pelecard_pending_recovery()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_pelecard_pending_recovery() TO service_role;

CREATE FUNCTION public.complete_pelecard_pending_recovery(p_payment_id uuid,p_claim_token uuid,
  p_outcome text,p_lookup_status text,p_transaction_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.pelecard_pending_recovery_jobs%ROWTYPE; payment public.payment_transactions%ROWTYPE;
  reason text; new_state text;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF p_outcome NOT IN ('verified','pending','declined','provider_unavailable','review_required')
    OR p_lookup_status IS NOT NULL AND p_lookup_status !~ '^[0-9]{2,4}$'
    OR p_transaction_status IS NOT NULL AND p_transaction_status !~ '^[0-9]{2,4}$'
  THEN RAISE EXCEPTION 'recovery_result_invalid' USING ERRCODE='23514'; END IF;
  SELECT * INTO STRICT job FROM public.pelecard_pending_recovery_jobs
    WHERE payment_id=p_payment_id FOR UPDATE;
  IF job.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'recovery_claim_mismatch' USING ERRCODE='23514'; END IF;
  SELECT * INTO STRICT payment FROM public.payment_transactions WHERE id=p_payment_id;
  IF payment.status='succeeded' AND payment.sale_id IS NOT NULL THEN
    reason:='verified';new_state:='verified';
  ELSIF payment.status<>'pending_provider' OR p_outcome='verified' THEN
    RAISE EXCEPTION 'recovery_finality_mismatch' USING ERRCODE='23514';
  ELSE
    reason:=CASE p_outcome WHEN 'declined' THEN 'provider_declined'
      WHEN 'provider_unavailable' THEN 'provider_unavailable'
      WHEN 'review_required' THEN 'verification_mismatch' ELSE 'provider_pending' END;
    new_state:=CASE WHEN reason<>'provider_pending'
      OR payment.created_at<clock_timestamp()-interval '2 minutes'
      THEN 'attention' ELSE 'watching' END;
  END IF;
  UPDATE public.pelecard_pending_recovery_jobs SET
    claim_token=NULL,lease_until=NULL,state=new_state,last_reason=reason,
    last_lookup_status=p_lookup_status,last_transaction_status=p_transaction_status,
    last_checked_at=clock_timestamp(),
    next_check_at=CASE WHEN new_state='verified' THEN 'infinity'::timestamptz
      WHEN job.checks<5 THEN clock_timestamp()+interval '1 minute'
      ELSE clock_timestamp()+interval '15 minutes' END
  WHERE payment_id=p_payment_id;
END $$;
REVOKE ALL ON FUNCTION public.complete_pelecard_pending_recovery(uuid,uuid,text,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.complete_pelecard_pending_recovery(uuid,uuid,text,text,text)
  TO service_role;

CREATE FUNCTION public.list_pelecard_pending_alerts()
RETURNS TABLE(payment_id uuid,source text,order_number text,last_reason text,
  last_lookup_status text,last_transaction_status text,last_checked_at timestamptz,checks integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF coalesce(auth.role(),'')<>'authenticated' OR NOT EXISTS
    (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role::text='admin')
  THEN RAISE EXCEPTION 'recovery_admin_required' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT p.id,
    CASE WHEN pos.payment_id IS NOT NULL THEN 'pos' ELSE 'order' END::text,
    o.order_number,
    CASE WHEN job.payment_id IS NULL OR job.last_checked_at<clock_timestamp()-interval '2 minutes'
      THEN 'recovery_not_run' ELSE job.last_reason END::text,
    job.last_lookup_status,job.last_transaction_status,job.last_checked_at,
    coalesce(job.checks,0)
  FROM public.payment_transactions p
  JOIN public.pelecard_pending_recovery_control control ON control.singleton
  LEFT JOIN public.pos_pelecard_intents pos ON pos.payment_id=p.id
  LEFT JOIN public.pelecard_live_attempts ord ON ord.payment_id=p.id
  LEFT JOIN public.pelecard_pending_recovery_jobs job ON job.payment_id=p.id
  LEFT JOIN public.orders o ON o.id=p.order_id
  WHERE p.status='pending_provider' AND p.provider='pelecard' AND p.operation='payment'
    AND control.cutoff_utc IS NOT NULL AND p.created_at>=control.cutoff_utc
    AND p.id NOT IN ('28b4786f-e722-40ae-9661-f3e805fc71bf'::uuid,
      '68a78d1c-8f79-4646-a5e4-4dfa201d20e8'::uuid)
    AND ((pos.payment_id IS NOT NULL AND pos.dispatch_started_at>=control.cutoff_utc)
      OR (ord.payment_id IS NOT NULL AND ord.dispatch_started_at>=control.cutoff_utc
        AND ord.closed_unpaid_at IS NULL))
    AND (job.state='attention' OR
      (p.created_at<clock_timestamp()-interval '2 minutes'
       AND (job.payment_id IS NULL OR job.last_checked_at<clock_timestamp()-interval '2 minutes')))
  ORDER BY p.created_at DESC LIMIT 100;
END $$;
REVOKE ALL ON FUNCTION public.list_pelecard_pending_alerts()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_pelecard_pending_alerts() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
