-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260325111945; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Recreate the search index with best_industry (highest visibility score)
DROP MATERIALIZED VIEW IF EXISTS company_search_index;

CREATE MATERIALIZED VIEW company_search_index AS
WITH scored AS (
  SELECT 
    canonical_name,
    industry_context,
    CASE 
      WHEN array_length(all_industry_combinations, 1) > 0 
      THEN (array_length(combinations, 1)::float / array_length(all_industry_combinations, 1)::float) * 100
      ELSE 0 
    END AS visibility_score
  FROM rankings_overview
),
best AS (
  SELECT DISTINCT ON (canonical_name)
    canonical_name,
    industry_context AS best_industry
  FROM scored
  ORDER BY canonical_name, visibility_score DESC
)
SELECT 
  ro.canonical_name,
  max(ro.website_domain) AS website_domain,
  array_agg(DISTINCT ro.industry_context ORDER BY ro.industry_context) AS industries,
  sum(ro.mention_count)::int AS total_mentions,
  b.best_industry
FROM rankings_overview ro
JOIN best b ON ro.canonical_name = b.canonical_name
GROUP BY ro.canonical_name, b.best_industry;

-- Recreate indexes
CREATE INDEX idx_company_search_name_trgm 
  ON company_search_index USING gin (lower(canonical_name) gin_trgm_ops);

CREATE INDEX idx_company_search_name_lower 
  ON company_search_index USING btree (lower(canonical_name));

-- Must drop and recreate since return type changed
DROP FUNCTION search_companies(text, int);

CREATE FUNCTION search_companies(
  query text,
  max_results int DEFAULT 30
)
RETURNS TABLE (
  canonical_name text,
  website_domain text,
  industries text[],
  total_mentions int,
  best_industry text
) 
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT 
    cs.canonical_name,
    cs.website_domain,
    cs.industries,
    cs.total_mentions,
    cs.best_industry
  FROM company_search_index cs
  WHERE lower(cs.canonical_name) LIKE '%' || lower(query) || '%'
  ORDER BY 
    CASE WHEN lower(cs.canonical_name) = lower(query) THEN 0 ELSE 1 END,
    CASE WHEN lower(cs.canonical_name) LIKE lower(query) || '%' THEN 0 ELSE 1 END,
    cs.total_mentions DESC
  LIMIT max_results;
$$;

