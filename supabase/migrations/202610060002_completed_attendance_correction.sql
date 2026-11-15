-- Completed attendance: admin correction reason required; instructors locked.
-- No schema/data rewrite. Existing session lock, version guard and append-only audit retained.
BEGIN;
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
  IF s.status='completed' THEN
    IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role::text='admin') THEN
      RAISE EXCEPTION 'session_completed' USING ERRCODE='42501';
    END IF;
    IF coalesce(p_notes,'') !~ '[^[:space:]]' THEN RAISE EXCEPTION 'correction_reason_required'; END IF;
  END IF;
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
COMMIT;
