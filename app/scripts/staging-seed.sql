-- Synthetic operational fixtures only. Run through the guarded staging runner.
-- This script intentionally creates no orders, sales, payments or documents.
DO $$
DECLARE
  admin_id uuid;
  cashier_id uuid;
  instructor_user_id uuid;
BEGIN
  IF current_setting('app.staging_seed_authorized', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'staging seed requires guarded runner';
  END IF;
  SELECT id INTO STRICT admin_id FROM auth.users WHERE email = 'staging-admin@example.test';
  SELECT id INTO STRICT cashier_id FROM auth.users WHERE email = 'staging-cashier@example.test';
  SELECT id INTO STRICT instructor_user_id FROM auth.users WHERE email = 'staging-instructor@example.test';

  INSERT INTO public.profiles(id, email, full_name, role) VALUES
    (admin_id, 'staging-admin@example.test', 'מנהל בדיקה', 'admin'),
    (cashier_id, 'staging-cashier@example.test', 'קופאי בדיקה', 'cashier'),
    (instructor_user_id, 'staging-instructor@example.test', 'מדריך בדיקה', 'instructor')
  ON CONFLICT (id) DO UPDATE SET role = excluded.role, full_name = excluded.full_name;

  INSERT INTO public.instructors(id, full_name, phone, email, status)
  VALUES ('a1000000-0000-4000-8000-000000000001', 'מדריך בדיקה', '0000000000', 'staging-instructor@example.test', 'פעיל')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.instructor_user_links(instructor_id, profile_id, version, updated_by)
  VALUES ('a1000000-0000-4000-8000-000000000001', instructor_user_id, 1, admin_id)
  ON CONFLICT (instructor_id) DO NOTHING;

  INSERT INTO public.clubs(id, name, instructor_id, monthly_price, status, created_by)
  VALUES ('a1000000-0000-4000-8000-000000000002', 'חוג בדיקה בלבד',
          'a1000000-0000-4000-8000-000000000001', 0, 'active', admin_id)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.club_participants(id, first_name, last_name, created_by)
  VALUES ('a1000000-0000-4000-8000-000000000003', 'משתתף', 'סינתטי', admin_id)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.club_memberships(id, club_id, participant_id, monthly_price, billing_day,
                                      recurring_starts_on, status, payment_status, created_by)
  VALUES ('a1000000-0000-4000-8000-000000000004',
          'a1000000-0000-4000-8000-000000000002',
          'a1000000-0000-4000-8000-000000000003', 0, 15,
          (date_trunc('month', current_date) + interval '1 month')::date,
          'active', 'not_enrolled', admin_id)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.club_sessions(id, club_id, session_date, start_time, end_time,
                                   instructor_id, instructor_name, created_by)
  VALUES ('a1000000-0000-4000-8000-000000000005',
          'a1000000-0000-4000-8000-000000000002', current_date, '16:00', '17:00',
          'a1000000-0000-4000-8000-000000000001', 'מדריך בדיקה', admin_id)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.club_session_roster(session_id, membership_id, participant_id, participant_name, added_by)
  VALUES ('a1000000-0000-4000-8000-000000000005',
          'a1000000-0000-4000-8000-000000000004',
          'a1000000-0000-4000-8000-000000000003', 'משתתף סינתטי', admin_id)
  ON CONFLICT (session_id, membership_id) DO NOTHING;

  INSERT INTO public.customers(id, customer_kind, display_name, vat_applicable, phone, email,
                               created_by, updated_by)
  VALUES ('a1000000-0000-4000-8000-000000000006', 'person', 'לקוח בדיקה', false,
          NULL, 'staging-customer@example.test', admin_id, admin_id)
  ON CONFLICT (id) DO NOTHING;
END $$;
