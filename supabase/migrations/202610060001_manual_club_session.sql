-- Add only the admin manual-entry boundary; existing attendance RPCs stay unchanged.
BEGIN;
CREATE FUNCTION public.create_manual_club_session(
  p_club_id uuid,p_date date,p_start time,p_end time,p_instructor_id uuid DEFAULT NULL,p_notes text DEFAULT ''
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.clubs; instructor_label text; session_id uuid; actor text;
BEGIN
  PERFORM public.club_attendance_admin();
  PERFORM public.club_attendance_range(p_date,p_date,true);
  IF p_start IS NULL OR p_end IS NULL OR p_end<=p_start OR p_end>=time '24:00' THEN
    RAISE EXCEPTION 'invalid_session_time';
  END IF;
  IF length(coalesce(p_notes,''))>1000 THEN RAISE EXCEPTION 'invalid_session_notes'; END IF;
  -- Shares the same lock and unique key as weekly materialization.
  SELECT * INTO c FROM public.clubs WHERE id=p_club_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'club_not_found'; END IF;
  IF c.status<>'active' THEN RAISE EXCEPTION 'club_inactive'; END IF;
  IF p_instructor_id IS NOT NULL THEN
    SELECT full_name INTO instructor_label FROM public.instructors WHERE id=p_instructor_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'instructor_not_found'; END IF;
  END IF;
  INSERT INTO public.club_sessions(club_id,session_date,start_time,end_time,instructor_id,instructor_name,notes,schedule_snapshot,created_by)
  VALUES(c.id,p_date,p_start,p_end,p_instructor_id,instructor_label,coalesce(p_notes,''),
    jsonb_build_object('source','manual','timezone','Asia/Jerusalem','date',p_date,'start_time',p_start,'end_time',p_end,
      'instructor_id',p_instructor_id,'instructor_name',instructor_label),auth.uid())
  ON CONFLICT(club_id,session_date,start_time) DO NOTHING RETURNING id INTO session_id;
  IF session_id IS NULL THEN RAISE EXCEPTION 'session_exists' USING ERRCODE='23505'; END IF;
  SELECT full_name INTO actor FROM public.profiles WHERE id=auth.uid();
  INSERT INTO public.club_session_audit(session_id,old_status,new_status,new_instructor_id,new_notes,actor_id,actor_name,version)
  VALUES(session_id,'not_created','scheduled',p_instructor_id,coalesce(p_notes,''),auth.uid(),actor,0);
  RETURN session_id;
END $$;
REVOKE ALL ON FUNCTION public.create_manual_club_session(uuid,date,time,time,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_manual_club_session(uuid,date,time,time,uuid,text) TO authenticated;
COMMIT;
