-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260206062413; this file was
-- back-filled afterwards and therefore post-dates the deployment.

CREATE OR REPLACE FUNCTION get_distinct_industries()
RETURNS TABLE (industry text)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT industry FROM mv_rankings_scored ORDER BY industry;
$$
