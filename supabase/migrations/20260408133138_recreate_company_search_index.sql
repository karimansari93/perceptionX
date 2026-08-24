-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260408133138; this file was
-- back-filled afterwards and therefore post-dates the deployment.


CREATE MATERIALIZED VIEW company_search_index AS
WITH best AS (
  SELECT DISTINCT ON (canonical_name)
    canonical_name,
    industry_context AS best_industry
  FROM rankings_overview
  ORDER BY canonical_name, score_all DESC
)
SELECT
  ro.canonical_name,
  max(ro.website_domain) AS website_domain,
  array_agg(DISTINCT ro.industry_context ORDER BY ro.industry_context) AS industries,
  sum(ro.mention_count)::integer AS total_mentions,
  b.best_industry
FROM rankings_overview ro
JOIN best b ON ro.canonical_name = b.canonical_name
WHERE length(trim(ro.canonical_name)) > 0
GROUP BY ro.canonical_name, b.best_industry;

