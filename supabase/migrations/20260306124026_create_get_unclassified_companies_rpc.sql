-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260306124026; this file was
-- back-filled afterwards and therefore post-dates the deployment.

CREATE OR REPLACE FUNCTION get_unclassified_companies(batch_limit int DEFAULT 400)
RETURNS TABLE(company_name text, primary_industry text, total_mentions bigint) AS $$
  SELECT 
    ro.company_name,
    ro.industry_context as primary_industry,
    max(ro.mention_count) as total_mentions
  FROM rankings_overview ro
  LEFT JOIN company_employee_tiers cet ON lower(ro.company_name) = cet.company_name
  WHERE cet.company_name IS NULL
  GROUP BY ro.company_name, ro.industry_context
  ORDER BY max(ro.mention_count) DESC
  LIMIT batch_limit;
$$ LANGUAGE sql STABLE;
