-- Run with: npx supabase test db supabase/tests/profile_role_protection.sql --local
-- Auth claim behavior must be verified against a disposable local/staging DB.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(4);

INSERT INTO auth.users (id, email) VALUES
  ('10000000-0000-4000-8000-000000000001', 'role-test-instructor@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'role-test-admin@example.test'),
  ('10000000-0000-4000-8000-000000000003', 'role-test-admin-target@example.test'),
  ('10000000-0000-4000-8000-000000000004', 'role-test-service-target@example.test');

SET LOCAL ROLE service_role;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config(
    'request.jwt.claims',
    '{"role":"service_role","sub":"10000000-0000-4000-8000-000000000002"}',
    true
  );
END;
$$;
UPDATE public.profiles
SET role = 'admin'
WHERE id = '10000000-0000-4000-8000-000000000002';

RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
  PERFORM set_config(
    'request.jwt.claims',
    '{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000001"}',
    true
  );
END;
$$;

SELECT extensions.throws_ok(
  $$UPDATE public.profiles
    SET role = 'admin'
    WHERE id = '10000000-0000-4000-8000-000000000001'$$,
  '42501',
  NULL,
  'instructor cannot promote their own role'
);

SELECT extensions.lives_ok(
  $$UPDATE public.profiles
    SET full_name = 'Updated instructor'
    WHERE id = '10000000-0000-4000-8000-000000000001'$$,
  'instructor can update ordinary profile fields'
);

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
  PERFORM set_config(
    'request.jwt.claims',
    '{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000002"}',
    true
  );
END;
$$;

SELECT extensions.lives_ok(
  $$UPDATE public.profiles
    SET role = 'cashier'
    WHERE id = '10000000-0000-4000-8000-000000000003'$$,
  'admin can assign a profile role'
);

RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
  PERFORM set_config(
    'request.jwt.claims',
    '{"role":"service_role","sub":"10000000-0000-4000-8000-000000000004"}',
    true
  );
END;
$$;

SELECT extensions.lives_ok(
  $$UPDATE public.profiles
    SET role = 'operations'
    WHERE id = '10000000-0000-4000-8000-000000000004'$$,
  'service role can assign a profile role'
);

RESET ROLE;

SELECT * FROM extensions.finish();

ROLLBACK;
