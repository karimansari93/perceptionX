-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260325083604; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Enable pg_trgm for fuzzy text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Create a lightweight materialized view for company search
-- Only stores distinct company names with their industries - no heavy array columns
CREATE MATERIALIZED VIEW IF NOT EXISTS company_search_index AS
SELECT 
  canonical_name,
  max(website_domain) AS website_domain,
  array_agg(DISTINCT industry_context ORDER BY industry_context) AS industries,
  sum(mention_count)::int AS total_mentions
FROM rankings_overview
GROUP BY canonical_name;

-- 2. Create indexes for fast text search
CREATE INDEX IF NOT EXISTS idx_company_search_name_trgm 
  ON company_search_index USING gin (lower(canonical_name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_company_search_name_lower 
  ON company_search_index USING btree (lower(canonical_name));

-- 3. Create an RPC function for server-side company search
CREATE OR REPLACE FUNCTION search_companies(
  query text,
  max_results int DEFAULT 30
)
RETURNS TABLE (
  canonical_name text,
  website_domain text,
  industries text[],
  total_mentions int
) 
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT 
    cs.canonical_name,
    cs.website_domain,
    cs.industries,
    cs.total_mentions
  FROM company_search_index cs
  WHERE lower(cs.canonical_name) LIKE '%' || lower(query) || '%'
  ORDER BY 
    CASE WHEN lower(cs.canonical_name) = lower(query) THEN 0 ELSE 1 END,
    CASE WHEN lower(cs.canonical_name) LIKE lower(query) || '%' THEN 0 ELSE 1 END,
    cs.total_mentions DESC
  LIMIT max_results;
$$;

-- 4. Create a function to get distinct periods efficiently  
CREATE OR REPLACE FUNCTION get_available_periods(
  target_country text DEFAULT 'United States'
)
RETURNS TABLE (index_period text)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT DISTINCT rh.index_period
  FROM rankings_historical rh
  WHERE rh.country = target_country
  ORDER BY rh.index_period DESC;
$$;

-- 5. Add indexes on materialized views for faster lookups
CREATE INDEX IF NOT EXISTS idx_rankings_historical_country 
  ON rankings_historical (country);

CREATE INDEX IF NOT EXISTS idx_rankings_historical_country_period 
  ON rankings_historical (country, index_period);

CREATE INDEX IF NOT EXISTS idx_rankings_overview_country 
  ON rankings_overview (country);

