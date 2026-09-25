-- ============================================================================
-- Platform admins managed from the admin Users tab
-- ============================================================================
-- public.is_admin() (user_roles.role = 'admin') already gates ~87 RLS
-- policies, but the frontend and invite-team-member checked hardcoded email
-- lists, so nobody but one founder could open /admin. The app now asks
-- is_admin() too; these two functions let an admin grant and revoke it.

CREATE OR REPLACE FUNCTION public.list_platform_admins()
RETURNS TABLE (user_id uuid, email text, granted_at timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RAISE insufficient_privilege USING MESSAGE = 'list_platform_admins is admin-only';
  END IF;
  RETURN QUERY
    SELECT ur.user_id, p.email::text, ur.created_at
    FROM public.user_roles ur
    LEFT JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role = 'admin'
    ORDER BY ur.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_platform_admin(p_user_id uuid, p_is_admin boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RAISE insufficient_privilege USING MESSAGE = 'set_platform_admin is admin-only';
  END IF;

  IF p_is_admin THEN
    INSERT INTO public.user_roles (user_id, role, created_by)
    SELECT p_user_id, 'admin', auth.uid()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'admin'
    );
  ELSE
    -- Never remove the last admin, and never let an admin remove themselves
    -- (another admin has to), so the platform can't be locked out.
    IF p_user_id = auth.uid() THEN
      RAISE EXCEPTION 'You cannot remove your own admin access';
    END IF;
    IF (SELECT count(*) FROM public.user_roles WHERE role = 'admin' AND user_id <> p_user_id) = 0 THEN
      RAISE EXCEPTION 'At least one platform admin must remain';
    END IF;
    DELETE FROM public.user_roles WHERE user_id = p_user_id AND role = 'admin';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.list_platform_admins() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_platform_admin(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_platform_admins() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_platform_admin(uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
