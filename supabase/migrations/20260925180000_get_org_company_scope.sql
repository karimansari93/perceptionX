-- Admin Companies tab: each company in an org with the countries and job
-- functions its active prompts cover. Read-only and index-backed (~30ms for
-- the largest org), unlike admin_data_health_org which can exceed the 8s
-- statement timeout.
CREATE OR REPLACE FUNCTION public.get_org_company_scope(p_org uuid)
RETURNS TABLE (
  company_id uuid,
  name text,
  country text,
  locations text[],
  functions text[],
  active_prompts bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RAISE insufficient_privilege USING MESSAGE = 'get_org_company_scope is admin-only';
  END IF;

  RETURN QUERY
  SELECT c.id, c.name, c.country,
    COALESCE(array_agg(DISTINCT cp.location_context) FILTER (WHERE cp.location_context IS NOT NULL), '{}'),
    COALESCE(array_agg(DISTINCT cp.job_function_context) FILTER (WHERE cp.job_function_context IS NOT NULL), '{}'),
    count(cp.id)
  FROM organization_companies oc
  JOIN companies c ON c.id = oc.company_id
  LEFT JOIN confirmed_prompts cp ON cp.company_id = c.id AND cp.is_active
  WHERE oc.organization_id = p_org
  GROUP BY c.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_org_company_scope(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_org_company_scope(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
