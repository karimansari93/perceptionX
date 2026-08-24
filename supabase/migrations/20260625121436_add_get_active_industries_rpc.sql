-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260625121436; this file was
-- back-filled afterwards and therefore post-dates the deployment.

CREATE OR REPLACE FUNCTION public.get_active_industries()
RETURNS TABLE(industry_context text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT DISTINCT ro.industry_context
  FROM public.rankings_overview ro
  WHERE ro.industry_context IS NOT NULL
    AND ro.industry_context <> ''
  ORDER BY ro.industry_context;
$function$;

GRANT EXECUTE ON FUNCTION public.get_active_industries() TO anon, authenticated;
