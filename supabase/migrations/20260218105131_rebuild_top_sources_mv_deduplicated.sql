-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260218105131; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Rebuild top sources MV with proper aggregation (one row per company+domain)
DROP MATERIALIZED VIEW IF EXISTS company_top_sources_mv CASCADE;

CREATE MATERIALIZED VIEW company_top_sources_mv AS
SELECT
  pr.company_id,
  c->>'domain' AS domain,
  MIN(c->>'url') AS sample_url,  -- just take one URL as sample
  COUNT(*) AS citation_count,
  ROUND((COUNT(*)::NUMERIC / SUM(COUNT(*)) OVER (PARTITION BY pr.company_id)) * 100, 1) AS pct_of_total
FROM prompt_responses pr,
     jsonb_array_elements(pr.citations) AS c
WHERE jsonb_typeof(pr.citations) = 'array'
  AND c->>'domain' IS NOT NULL
  AND c->>'domain' != ''
GROUP BY pr.company_id, c->>'domain';

CREATE UNIQUE INDEX company_top_sources_mv_unique_idx ON company_top_sources_mv (company_id, domain);

-- Recreate the view that was dropped by CASCADE
CREATE VIEW company_top_sources AS
SELECT s.*
FROM company_top_sources_mv s
WHERE EXISTS (
  SELECT 1 FROM company_members cm
  WHERE cm.company_id = s.company_id AND cm.user_id = (SELECT auth.uid())
);

