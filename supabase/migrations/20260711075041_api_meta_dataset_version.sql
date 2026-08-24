-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260711075041; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Expose the dataset itself as a first-class entity: add datasetVersion
-- (the current index period) to api_meta so GET /api and GET /api/v1 can
-- describe the dataset directly.
CREATE OR REPLACE FUNCTION public.api_meta()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT jsonb_build_object(
    'datasetVersion', to_char(now(), 'YYYY-MM'),
    'lastUpdated', api_last_refreshed(),
    'industries', (SELECT jsonb_agg(DISTINCT industry_context ORDER BY industry_context) FROM rankings_overview),
    'countries', (SELECT jsonb_agg(DISTINCT country ORDER BY country) FROM rankings_overview),
    'months', (SELECT jsonb_agg(DISTINCT index_period ORDER BY index_period) FROM rankings_historical),
    'totalCompanies', (SELECT count(DISTINCT canonical_name) FROM rankings_overview)
  );
$$;

GRANT EXECUTE ON FUNCTION public.api_meta() TO anon, authenticated, service_role;
