-- Operational attendance only. Apply after 023/028. No billing/provider writes.
BEGIN;

ALTER TABLE public.club_sessions
  ADD COLUMN instructor_id uuid REFERENCES public.instructors(id) ON DELETE SET NULL,
  ADD COLUMN instructor_name text,
  ADD COLUMN timezone text NOT NULL DEFAULT 'Asia/Jerusalem' CHECK (timezone = 'Asia/Jerusalem'),
  ADD COLUMN schedule_snapshot jsonb,
  ADD COLUMN version integer NOT NULL DEFAULT 0 CHECK (version >= 0);
ALTER TABLE public.club_attendance
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- A roster is independent of marks: absence of a mark is NOT an absence.
CREATE TABLE public.club_session_roster (
  session_id uuid NOT NULL REFERENCES public.club_sessions(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL REFERENCES public.club_memberships(id) ON DELETE RESTRICT,
  participant_id uuid NOT NULL REFERENCES public.club_participants(id) ON DELETE RESTRICT,
  participant_name text NOT NULL,
  added_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, membership_id),
  UNIQUE (session_id, participant_id)
);
CREATE TABLE public.club_attendance_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.club_sessions(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL REFERENCES public.club_memberships(id) ON DELETE RESTRICT,
  old_status text, new_status text NOT NULL,
  old_notes text, new_notes text,
  version integer NOT NULL,
  actor_id uuid, actor_name text,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(session_id, membership_id, version)
);
CREATE TABLE public.club_session_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.club_sessions(id) ON DELETE RESTRICT,
  old_status text NOT NULL, new_status text NOT NULL,
  old_instructor_id uuid, new_instructor_id uuid,
  old_notes text, new_notes text,
  actor_id uuid, actor_name text,
  version integer NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(session_id, version)
);
CREATE INDEX club_roster_participant ON public.club_session_roster(participant_id, session_id);

-- Preserve any legacy marks; do not invent a historical editor/change log.
INSERT INTO public.club_session_roster(session_id,membership_id,participant_id,participant_name,added_by,added_at)
SELECT a.session_id,a.membership_id,m.participant_id,concat_ws(' ',p.first_name,p.last_name),a.recorded_by,a.created_at
FROM public.club_attendance a JOIN public.club_memberships m ON m.id=a.membership_id
JOIN public.club_participants p ON p.id=m.participant_id;

ALTER TABLE public.club_session_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_attendance_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_session_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read roster" ON public.club_session_roster FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "admin read attendance audit" ON public.club_attendance_audit FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "admin read session audit" ON public.club_session_audit FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.club_session_roster,public.club_attendance_audit,public.club_session_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.club_session_roster,public.club_attendance_audit,public.club_session_audit TO authenticated;
-- All operational writes must go through the checked, versioned RPCs below.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.club_sessions,public.club_attendance FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.club_attendance_admin() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_admin(),false) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE='42501';
  END IF;
END $$;

CREATE FUNCTION public.club_attendance_range(p_from date,p_until date,p_materialize boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE today date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
BEGIN
  IF p_from IS NULL OR p_until IS NULL OR p_until<p_from OR p_until-p_from>61
     OR (p_materialize AND (p_from<today-366 OR p_until>today+90)) THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;
END $$;

-- Prevent deleting history, including through a club cascade. Rules can still
-- be replaced by save_club_with_schedule: their FK may become NULL, while the
-- original schedule snapshot/date/time remain frozen.
CREATE FUNCTION public.guard_club_session_history() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'session_history_immutable'; END IF;
  IF ROW(NEW.club_id,NEW.session_date,NEW.start_time,NEW.end_time,NEW.timezone,NEW.schedule_snapshot)
     IS DISTINCT FROM ROW(OLD.club_id,OLD.session_date,OLD.start_time,OLD.end_time,OLD.timezone,OLD.schedule_snapshot) THEN
    RAISE EXCEPTION 'session_history_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER club_session_history_guard BEFORE UPDATE OR DELETE ON public.club_sessions
FOR EACH ROW EXECUTE FUNCTION public.guard_club_session_history();

CREATE FUNCTION public.materialize_club_sessions(p_club_id uuid,p_from date,p_until date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.clubs; instructor_label text; candidate record; inserted integer := 0; affected integer;
BEGIN
  PERFORM public.club_attendance_admin();
  PERFORM public.club_attendance_range(p_from,p_until,true);
  SELECT * INTO c FROM public.clubs WHERE id=p_club_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'club_not_found'; END IF;
  IF c.status<>'active' THEN RAISE EXCEPTION 'club_inactive'; END IF;
  IF EXISTS(SELECT 1 FROM public.club_schedule_rules WHERE club_id=c.id AND is_active AND timezone<>'Asia/Jerusalem') THEN
    RAISE EXCEPTION 'unsupported_schedule_timezone';
  END IF;
  SELECT full_name INTO instructor_label FROM public.instructors WHERE id=c.instructor_id;
  -- One snapshot for ambiguity detection and insertion, including concurrent
  -- edits made outside save_club_with_schedule. Any exception rolls back all rows.
  FOR candidate IN
    SELECT r.*,p_from+n.i AS day,
      count(*) OVER (PARTITION BY p_from+n.i,r.start_time) AS rule_count
    FROM generate_series(0,p_until-p_from) AS n(i)
    JOIN public.club_schedule_rules r ON r.club_id=c.id AND r.is_active
      AND r.weekday=extract(dow FROM p_from+n.i)
      AND p_from+n.i>=coalesce(r.effective_from,(r.created_at AT TIME ZONE 'Asia/Jerusalem')::date)
      AND (r.effective_until IS NULL OR p_from+n.i<=r.effective_until)
    ORDER BY p_from+n.i,r.start_time
  LOOP
    IF candidate.rule_count>1 THEN RAISE EXCEPTION 'overlapping_schedule_rules'; END IF;
    IF candidate.timezone<>'Asia/Jerusalem' THEN RAISE EXCEPTION 'unsupported_schedule_timezone'; END IF;
    INSERT INTO public.club_sessions(club_id,schedule_rule_id,session_date,start_time,end_time,instructor_id,instructor_name,schedule_snapshot,created_by)
    VALUES(c.id,candidate.id,candidate.day,candidate.start_time,candidate.end_time,c.instructor_id,instructor_label,
      jsonb_build_object('rule_id',candidate.id,'weekday',candidate.weekday,'start_time',candidate.start_time,'end_time',candidate.end_time,
        'effective_from',candidate.effective_from,'effective_until',candidate.effective_until,'timezone',candidate.timezone),auth.uid())
    ON CONFLICT(club_id,session_date,start_time) DO NOTHING;
    GET DIAGNOSTICS affected=ROW_COUNT;
    inserted := inserted+affected;
  END LOOP;
  RETURN inserted;
END $$;

CREATE FUNCTION public.prepare_club_roster(p_session_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.club_sessions; candidate record; inserted integer := 0;
BEGIN
  PERFORM public.club_attendance_admin();
  SELECT * INTO s FROM public.club_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF s.status='cancelled' THEN RAISE EXCEPTION 'session_cancelled'; END IF;
  -- Billing/collection status is deliberately irrelevant. Paused memberships
  -- lack dated pause history, so cannot be inferred as eligible retrospectively.
  -- Evaluate eligibility and ambiguity in one database snapshot. An exception
  -- rolls back the complete roster preparation, including earlier loop rows.
  FOR candidate IN
    SELECT m.id,m.participant_id,concat_ws(' ',p.first_name,p.last_name) AS participant_name,
      count(*) OVER (PARTITION BY m.participant_id) AS eligible_count
    FROM public.club_memberships m JOIN public.club_participants p ON p.id=m.participant_id
    WHERE m.club_id=s.club_id AND m.starts_on<=s.session_date
      AND (m.ends_on IS NULL OR m.ends_on>=s.session_date)
      AND (m.cancellation_effective_on IS NULL OR m.cancellation_effective_on>s.session_date)
      AND (m.status IN ('pending_enrollment','active','cancellation_scheduled')
        OR (m.status IN ('ended','cancelled') AND (m.ends_on IS NOT NULL OR m.cancellation_effective_on IS NOT NULL)))
      AND NOT EXISTS(SELECT 1 FROM public.club_session_roster r WHERE r.session_id=s.id AND r.participant_id=m.participant_id)
    ORDER BY m.id
  LOOP
    IF candidate.eligible_count>1 THEN RAISE EXCEPTION 'ambiguous_membership_dates'; END IF;
    INSERT INTO public.club_session_roster(session_id,membership_id,participant_id,participant_name,added_by)
    VALUES(s.id,candidate.id,candidate.participant_id,candidate.participant_name,auth.uid());
    inserted := inserted+1;
  END LOOP;
  RETURN inserted;
END $$;

CREATE FUNCTION public.mark_club_attendance(p_session_id uuid,p_membership_id uuid,p_status text,p_expected_version integer,p_notes text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.club_sessions; a public.club_attendance; previous public.club_attendance; actor text;
BEGIN
  PERFORM public.club_attendance_admin();
  IF p_status IS NULL OR p_status NOT IN ('present','absent','excused') OR length(coalesce(p_notes,''))>1000
     OR p_expected_version IS NULL OR p_expected_version<0 THEN RAISE EXCEPTION 'invalid_attendance'; END IF;
  SELECT * INTO s FROM public.club_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF s.status='cancelled' THEN RAISE EXCEPTION 'session_cancelled'; END IF;
  IF s.session_date>(now() AT TIME ZONE 'Asia/Jerusalem')::date THEN RAISE EXCEPTION 'future_attendance'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.club_session_roster WHERE session_id=s.id AND membership_id=p_membership_id) THEN
    RAISE EXCEPTION 'participant_not_in_roster';
  END IF;
  SELECT * INTO previous FROM public.club_attendance WHERE session_id=s.id AND membership_id=p_membership_id;
  IF coalesce(previous.version,0)<>p_expected_version THEN RAISE EXCEPTION 'attendance_conflict'; END IF;
  IF previous.id IS NULL THEN
    INSERT INTO public.club_attendance(session_id,membership_id,status,notes,recorded_by,updated_by)
    VALUES(s.id,p_membership_id,p_status,coalesce(p_notes,''),auth.uid(),auth.uid()) RETURNING * INTO a;
  ELSE
    UPDATE public.club_attendance SET status=p_status,notes=coalesce(p_notes,''),version=version+1,updated_by=auth.uid()
    WHERE id=previous.id RETURNING * INTO a;
  END IF;
  SELECT full_name INTO actor FROM public.profiles WHERE id=auth.uid();
  INSERT INTO public.club_attendance_audit(session_id,membership_id,old_status,new_status,old_notes,new_notes,version,actor_id,actor_name)
  VALUES(s.id,p_membership_id,previous.status,a.status,previous.notes,a.notes,a.version,auth.uid(),actor);
  RETURN jsonb_build_object('version',a.version,'status',a.status);
END $$;

CREATE FUNCTION public.update_club_session(p_session_id uuid,p_expected_version integer,p_status text,p_instructor_id uuid,p_notes text DEFAULT '') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.club_sessions; instructor_label text; actor text;
BEGIN
  PERFORM public.club_attendance_admin();
  IF p_status IS NULL OR p_status NOT IN ('scheduled','completed','cancelled') OR length(coalesce(p_notes,''))>1000 THEN RAISE EXCEPTION 'invalid_session'; END IF;
  SELECT * INTO s FROM public.club_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF p_expected_version IS NULL OR s.version<>p_expected_version THEN RAISE EXCEPTION 'session_conflict'; END IF;
  IF s.status='cancelled' THEN RAISE EXCEPTION 'session_cancelled'; END IF;
  IF p_status='completed' AND s.session_date>(now() AT TIME ZONE 'Asia/Jerusalem')::date THEN RAISE EXCEPTION 'future_attendance'; END IF;
  SELECT full_name INTO instructor_label FROM public.instructors WHERE id=p_instructor_id;
  IF p_instructor_id IS NOT NULL AND NOT FOUND THEN RAISE EXCEPTION 'instructor_not_found'; END IF;
  SELECT full_name INTO actor FROM public.profiles WHERE id=auth.uid();
  UPDATE public.club_sessions SET status=p_status,instructor_id=p_instructor_id,instructor_name=instructor_label,
    notes=coalesce(p_notes,''),version=version+1 WHERE id=s.id;
  INSERT INTO public.club_session_audit(session_id,old_status,new_status,old_instructor_id,new_instructor_id,old_notes,new_notes,actor_id,actor_name,version)
  VALUES(s.id,s.status,p_status,s.instructor_id,p_instructor_id,s.notes,coalesce(p_notes,''),auth.uid(),actor,s.version+1);
END $$;

-- Read-only, bounded operational projection: no financial joins, no contact data.
CREATE FUNCTION public.get_club_attendance_history(p_club_id uuid,p_from date,p_until date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.club_attendance_admin();
  PERFORM public.club_attendance_range(p_from,p_until);
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.session_date DESC,x.start_time,x.participant_name) FROM (
    SELECT s.id AS session_id,s.session_date,s.start_time,s.status AS session_status,
      r.membership_id,r.participant_id,r.participant_name,r.added_at,
      a.status,a.notes,coalesce(a.version,0) AS version,a.recorded_by,a.updated_by,a.created_at,a.updated_at,
      (SELECT actor_name FROM public.club_attendance_audit WHERE session_id=s.id AND membership_id=r.membership_id ORDER BY version DESC LIMIT 1) AS actor_name
    FROM public.club_sessions s JOIN public.club_session_roster r ON r.session_id=s.id
    LEFT JOIN public.club_attendance a ON a.session_id=s.id AND a.membership_id=r.membership_id
    WHERE s.club_id=p_club_id AND s.session_date BETWEEN p_from AND p_until
  ) x),'[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.club_attendance_admin(),public.club_attendance_range(date,date,boolean),
 public.guard_club_session_history(),public.materialize_club_sessions(uuid,date,date),public.prepare_club_roster(uuid),
 public.mark_club_attendance(uuid,uuid,text,integer,text),public.update_club_session(uuid,integer,text,uuid,text),
 public.get_club_attendance_history(uuid,date,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.materialize_club_sessions(uuid,date,date),public.prepare_club_roster(uuid),
 public.mark_club_attendance(uuid,uuid,text,integer,text),public.update_club_session(uuid,integer,text,uuid,text),
 public.get_club_attendance_history(uuid,date,date) TO authenticated;
COMMIT;
