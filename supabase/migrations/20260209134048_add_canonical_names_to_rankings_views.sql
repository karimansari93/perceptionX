-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260209134048; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Drop and recreate rankings_overview with canonical_name
DROP MATERIALIZED VIEW IF EXISTS rankings_overview CASCADE;

CREATE MATERIALIZED VIEW rankings_overview AS
WITH raw_data AS (
  SELECT 
    pr.ai_model,
    cp.industry_context,
    cp.location_context AS country,
    cp.prompt_theme,
    pr.detected_competitors
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  WHERE pr.for_index = true 
    AND cp.industry_context IS NOT NULL 
    AND cp.location_context IS NOT NULL
),
industry_stats AS (
  SELECT 
    industry_context,
    country,
    array_agg(DISTINCT ai_model || '::' || COALESCE(prompt_theme, 'null')) AS all_industry_combinations
  FROM raw_data
  GROUP BY industry_context, country
),
raw_split AS (
  SELECT 
    rd.ai_model,
    rd.industry_context,
    rd.country,
    rd.prompt_theme,
    clean_company_name(token) AS company_name
  FROM raw_data rd
  CROSS JOIN LATERAL regexp_split_to_table(rd.detected_competitors, '[,;\n]+') AS token
  WHERE length(TRIM(token)) > 1
),
company_stats AS (
  SELECT 
    industry_context,
    country,
    company_name,
    COUNT(*) AS mention_count,
    array_agg(DISTINCT ai_model || '::' || COALESCE(prompt_theme, 'null')) AS combinations
  FROM raw_split
  GROUP BY industry_context, country, company_name
)
SELECT 
  cs.company_name,
  COALESCE(ccn.canonical_name, cs.company_name) AS canonical_name,
  COALESCE(ccn.website_domain, '') AS website_domain,
  cs.industry_context,
  cs.country,
  cs.mention_count,
  cs.combinations,
  ist.all_industry_combinations
FROM company_stats cs
JOIN industry_stats ist ON cs.industry_context = ist.industry_context AND cs.country = ist.country
LEFT JOIN company_canonical_names ccn ON LOWER(cs.company_name) = LOWER(ccn.variant_name);

-- Create unique index for CONCURRENT refresh
CREATE UNIQUE INDEX rankings_overview_unique_idx 
ON rankings_overview (company_name, industry_context, country);

-- Create additional indexes
CREATE INDEX idx_rankings_overview_canonical ON rankings_overview(canonical_name);
CREATE INDEX idx_rankings_overview_country ON rankings_overview(country);
CREATE INDEX idx_rankings_overview_industry ON rankings_overview(industry_context);
CREATE INDEX idx_rankings_overview_composite ON rankings_overview(country, industry_context, mention_count DESC);

-- Grant permissions
ALTER MATERIALIZED VIEW rankings_overview OWNER TO postgres;
GRANT ALL ON rankings_overview TO service_role;

-- Drop and recreate rankings_historical with canonical_name
DROP MATERIALIZED VIEW IF EXISTS rankings_historical CASCADE;

CREATE MATERIALIZED VIEW rankings_historical AS
WITH raw_data AS (
  SELECT 
    pr.index_period,
    pr.ai_model,
    cp.industry_context,
    cp.location_context AS country,
    cp.prompt_theme,
    pr.detected_competitors
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  WHERE pr.for_index = true 
    AND cp.industry_context IS NOT NULL 
    AND cp.location_context IS NOT NULL
    AND pr.index_period IS NOT NULL
),
period_industry_stats AS (
  SELECT 
    index_period,
    industry_context,
    country,
    array_agg(DISTINCT ai_model || '::' || COALESCE(prompt_theme, 'null')) AS all_combinations
  FROM raw_data
  GROUP BY index_period, industry_context, country
),
raw_split AS (
  SELECT 
    rd.index_period,
    rd.ai_model,
    rd.industry_context,
    rd.country,
    rd.prompt_theme,
    clean_company_name(token) AS company_name
  FROM raw_data rd
  CROSS JOIN LATERAL regexp_split_to_table(rd.detected_competitors, '[,;\n]+') AS token
  WHERE length(TRIM(token)) > 1
),
company_stats AS (
  SELECT 
    index_period,
    industry_context,
    country,
    company_name,
    COUNT(*) AS mention_count,
    array_agg(DISTINCT ai_model || '::' || COALESCE(prompt_theme, 'null')) AS combinations
  FROM raw_split
  GROUP BY index_period, industry_context, country, company_name
)
SELECT 
  cs.index_period,
  cs.company_name,
  COALESCE(ccn.canonical_name, cs.company_name) AS canonical_name,
  COALESCE(ccn.website_domain, '') AS website_domain,
  cs.industry_context,
  cs.country,
  cs.mention_count,
  cs.combinations,
  pis.all_combinations AS all_period_combinations
FROM company_stats cs
JOIN period_industry_stats pis 
  ON cs.index_period = pis.index_period 
  AND cs.industry_context = pis.industry_context 
  AND cs.country = pis.country
LEFT JOIN company_canonical_names ccn ON LOWER(cs.company_name) = LOWER(ccn.variant_name);

-- Create unique index for CONCURRENT refresh
CREATE UNIQUE INDEX rankings_historical_unique_idx 
ON rankings_historical (index_period, company_name, industry_context, country);

-- Create additional indexes
CREATE INDEX idx_rankings_historical_canonical ON rankings_historical(canonical_name);
CREATE INDEX idx_rankings_historical_period ON rankings_historical(index_period);
CREATE INDEX idx_rankings_historical_country ON rankings_historical(country);
CREATE INDEX idx_rankings_historical_industry ON rankings_historical(industry_context);
CREATE INDEX idx_rankings_historical_composite ON rankings_historical(index_period, country, industry_context, mention_count DESC);

-- Grant permissions
ALTER MATERIALIZED VIEW rankings_historical OWNER TO postgres;
GRANT ALL ON rankings_historical TO service_role;

-- Refresh both views
REFRESH MATERIALIZED VIEW CONCURRENTLY rankings_overview;
REFRESH MATERIALIZED VIEW CONCURRENTLY rankings_historical;

