-- Prevent the existing self-update profile policy from being used for role
-- escalation. This is additive: ordinary self-profile updates remain allowed.
-- Migration 022 installs an equivalent early guard so accounting access is
-- protected before this migration runs. Replace it here with the canonical
-- guard, leaving exactly one role-protection trigger after migration 024.

DROP TRIGGER IF EXISTS protect_profile_role_updates ON public.profiles;
DROP FUNCTION IF EXISTS public.protect_profile_role_updates();

CREATE OR REPLACE FUNCTION public.protect_profile_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  IF COALESCE(auth.role(), '') = 'service_role' OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'profile role changes require administrator privileges'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.protect_profile_role_change()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE TRIGGER trg_profiles_protect_role
  BEFORE UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_role_change();
