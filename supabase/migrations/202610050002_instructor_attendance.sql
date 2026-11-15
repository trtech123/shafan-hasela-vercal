-- Explicit identity for Clubs attendance. No email matching, financial grants,
-- existing Order policies, login architecture or provider behavior changes.
BEGIN;

CREATE INDEX club_sessions_instructor_date ON public.club_sessions(instructor_id,session_date,start_time)
WHERE instructor_id IS NOT NULL;

CREATE TABLE public.instructor_user_links (
  instructor_id uuid PRIMARY KEY REFERENCES public.instructors(id) ON DELETE RESTRICT,
  profile_id uuid UNIQUE REFERENCES public.profiles(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version>0),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.instructor_user_link_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instructor_id uuid NOT NULL,
  old_profile_id uuid, new_profile_id uuid,
  version integer NOT NULL,
  actor_id uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(instructor_id,version)
);
ALTER TABLE public.instructor_user_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructor_user_link_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read instructor links" ON public.instructor_user_links FOR SELECT TO authenticated USING(public.is_admin());
CREATE POLICY "admin read instructor link audit" ON public.instructor_user_link_audit FOR SELECT TO authenticated USING(public.is_admin());
REVOKE ALL ON public.instructor_user_links,public.instructor_user_link_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.instructor_user_links,public.instructor_user_link_audit TO authenticated;

CREATE FUNCTION public.set_instructor_user_link(p_instructor_id uuid,p_profile_id uuid,p_expected_version integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old_link public.instructor_user_links; target_role text;
BEGIN
  PERFORM public.club_attendance_admin();
  PERFORM 1 FROM public.instructors WHERE id=p_instructor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'instructor_not_found'; END IF;
  IF p_profile_id IS NOT NULL THEN
    SELECT role::text INTO target_role FROM public.profiles WHERE id=p_profile_id FOR SHARE;
    IF target_role IS DISTINCT FROM 'instructor' THEN RAISE EXCEPTION 'instructor_role_required'; END IF;
  END IF;
  SELECT * INTO old_link FROM public.instructor_user_links WHERE instructor_id=p_instructor_id FOR UPDATE;
  IF p_expected_version IS NULL OR p_expected_version<>coalesce(old_link.version,0) THEN RAISE EXCEPTION 'link_conflict'; END IF;
  INSERT INTO public.instructor_user_links(instructor_id,profile_id,version,updated_by)
  VALUES(p_instructor_id,p_profile_id,coalesce(old_link.version,0)+1,auth.uid())
  ON CONFLICT(instructor_id) DO UPDATE SET profile_id=excluded.profile_id,version=excluded.version,
    updated_by=excluded.updated_by,updated_at=clock_timestamp();
  INSERT INTO public.instructor_user_link_audit(instructor_id,old_profile_id,new_profile_id,version,actor_id)
  VALUES(p_instructor_id,old_link.profile_id,p_profile_id,coalesce(old_link.version,0)+1,auth.uid());
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'profile_already_linked';
END $$;

CREATE FUNCTION public.get_instructor_user_links() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.club_attendance_admin();
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.full_name,x.instructor_id) FROM (
    SELECT i.id AS instructor_id,i.full_name,l.profile_id,coalesce(l.version,0) AS version,l.updated_by,l.updated_at
    FROM public.instructors i LEFT JOIN public.instructor_user_links l ON l.instructor_id=i.id
  ) x),'[]'::jsonb);
END $$;

-- Do NOT reuse get_my_instructor_id(): that legacy Orders helper matches email.
CREATE FUNCTION public.club_linked_instructor() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT l.instructor_id FROM public.instructor_user_links l
  JOIN public.profiles p ON p.id=l.profile_id
  WHERE p.id=auth.uid() AND p.role::text='instructor'
$$;

-- Write guard called only AFTER the session row is locked. Concurrent explicit
-- reassignment serializes on that row; unlink/role changes wait on these locks.
CREATE FUNCTION public.require_club_attendance_access(p_session_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE caller_role text; linked uuid;
BEGIN
  SELECT role::text INTO caller_role FROM public.profiles WHERE id=auth.uid() FOR SHARE;
  IF caller_role='admin' THEN RETURN; END IF;
  IF caller_role='instructor' THEN
    SELECT instructor_id INTO linked FROM public.instructor_user_links WHERE profile_id=auth.uid() FOR SHARE;
    IF linked IS NOT NULL AND EXISTS(SELECT 1 FROM public.club_sessions WHERE id=p_session_id AND instructor_id=linked) THEN RETURN; END IF;
  END IF;
  RAISE EXCEPTION 'attendance_forbidden: admin_required_or_assigned_instructor' USING ERRCODE='42501';
END $$;

CREATE FUNCTION public.get_instructor_club_sessions(p_from date,p_until date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE linked uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role::text='instructor') THEN
    RAISE EXCEPTION 'attendance_forbidden' USING ERRCODE='42501';
  END IF;
  PERFORM public.club_attendance_range(p_from,p_until);
  linked := public.club_linked_instructor();
  RETURN jsonb_build_object('linked',linked IS NOT NULL,'sessions',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.session_date,x.start_time,x.id) FROM (
    SELECT s.id,c.name AS club_name,s.session_date,s.start_time,s.end_time,s.status
    FROM public.club_sessions s JOIN public.clubs c ON c.id=s.club_id
    WHERE s.instructor_id=linked AND s.session_date BETWEEN p_from AND p_until
  ) x),'[]'::jsonb));
END $$;

CREATE FUNCTION public.get_instructor_club_roster(p_session_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.club_sessions s WHERE s.id=p_session_id
    AND (public.is_admin() OR s.instructor_id=public.club_linked_instructor())) THEN
    RAISE EXCEPTION 'attendance_forbidden' USING ERRCODE='42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.participant_name,x.membership_id) FROM (
    SELECT r.membership_id,r.participant_name,a.status,a.notes,coalesce(a.version,0) AS version,a.updated_at
    FROM public.club_session_roster r LEFT JOIN public.club_attendance a ON a.session_id=r.session_id AND a.membership_id=r.membership_id
    WHERE r.session_id=p_session_id
  ) x),'[]'::jsonb);
END $$;

-- Existing roster and marking implementations are preserved below. Only their
-- authorization changes to the explicit, locked session-level guard.

CREATE OR REPLACE FUNCTION public.prepare_club_roster(p_session_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.club_sessions; candidate record; inserted integer := 0;
BEGIN
  SELECT * INTO s FROM public.club_sessions WHERE id=p_session_id FOR UPDATE;
  PERFORM public.require_club_attendance_access(p_session_id);
  IF s.id IS NULL THEN RAISE EXCEPTION 'session_not_found'; END IF;
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

CREATE OR REPLACE FUNCTION public.mark_club_attendance(p_session_id uuid,p_membership_id uuid,p_status text,p_expected_version integer,p_notes text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.club_sessions; a public.club_attendance; previous public.club_attendance; actor text;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('present','absent','excused') OR length(coalesce(p_notes,''))>1000
     OR p_expected_version IS NULL OR p_expected_version<0 THEN RAISE EXCEPTION 'invalid_attendance'; END IF;
  SELECT * INTO s FROM public.club_sessions WHERE id=p_session_id FOR UPDATE;
  PERFORM public.require_club_attendance_access(p_session_id);
  IF s.id IS NULL THEN RAISE EXCEPTION 'session_not_found'; END IF;
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


REVOKE ALL ON FUNCTION public.set_instructor_user_link(uuid,uuid,integer),public.get_instructor_user_links(),public.club_linked_instructor(),public.require_club_attendance_access(uuid),public.get_instructor_club_sessions(date,date),public.get_instructor_club_roster(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_instructor_user_link(uuid,uuid,integer),public.get_instructor_user_links(),public.get_instructor_club_sessions(date,date),public.get_instructor_club_roster(uuid) TO authenticated;
COMMIT;
