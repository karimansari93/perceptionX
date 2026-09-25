-- Priority clients (e.g. quarterly-report clients) pinned at the top of the
-- admin Organizations list. Shared by every platform admin, so it lives on
-- the organization rather than in one admin's browser. Set through an
-- admin-only RPC because organizations' UPDATE policy only covers members.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS is_priority boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.set_organization_priority(p_org uuid, p_is_priority boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RAISE insufficient_privilege USING MESSAGE = 'set_organization_priority is admin-only';
  END IF;
  UPDATE public.organizations SET is_priority = p_is_priority WHERE id = p_org;
END;
$$;

REVOKE ALL ON FUNCTION public.set_organization_priority(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_organization_priority(uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
