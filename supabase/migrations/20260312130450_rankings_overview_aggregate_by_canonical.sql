-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260312130450; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Rebuild rankings_overview to aggregate by canonical_name after resolution
-- This collapses variant rows (e.g. "mcdonald's brasil" + "mcdonald's germany" → "McDonald's")
-- within the same industry_context + country combination

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
    array_agg(DISTINCT (ai_model || '::') || COALESCE(prompt_theme, 'null')) AS all_industry_combinations
  FROM raw_data
  GROUP BY industry_context, country
),
raw_split AS (
  SELECT
    rd.ai_model,
    rd.industry_context,
    rd.country,
    rd.prompt_theme,
    clean_company_name(token.token) AS company_name
  FROM raw_data rd
  CROSS JOIN LATERAL regexp_split_to_table(rd.detected_competitors, '[,;\n]+') AS token(token)
  WHERE length(trim(token.token)) > 1
),
company_stats AS (
  SELECT
    industry_context,
    country,
    company_name,
    count(*) AS mention_count,
    array_agg(DISTINCT (ai_model || '::') || COALESCE(prompt_theme, 'null')) AS combinations
  FROM raw_split
  GROUP BY industry_context, country, company_name
),
with_canonical AS (
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
  LEFT JOIN company_canonical_names ccn ON lower(cs.company_name) = lower(ccn.variant_name)
  WHERE NOT is_source_entity(cs.company_name, COALESCE(ccn.canonical_name, cs.company_name))
),
-- NEW: re-aggregate by canonical_name to collapse variant rows
canonical_aggregated AS (
  SELECT
    canonical_name,
    -- Use the website_domain from whichever variant has one (prefer non-empty)
    MAX(website_domain) AS website_domain,
    industry_context,
    country,
    SUM(mention_count) AS mention_count,
    -- Merge all combinations arrays into one deduplicated array
    array_agg(DISTINCT combo) AS combinations,
    MAX(all_industry_combinations) AS all_industry_combinations
  FROM with_canonical
  CROSS JOIN LATERAL unnest(combinations) AS combo
  GROUP BY canonical_name, industry_context, country
)
SELECT
  ca.canonical_name,
  ca.website_domain,
  ca.industry_context,
  ca.country,
  ca.mention_count,
  ca.combinations,
  ca.all_industry_combinations
FROM canonical_aggregated ca
LEFT JOIN company_employee_tiers cet ON lower(ca.canonical_name) = lower(cet.company_name)
WHERE cet.estimated_tier IS NOT NULL
  AND cet.estimated_tier NOT IN ('<50', '50-499');

-- Recreate indexes
CREATE INDEX idx_rankings_overview_country ON rankings_overview (country);
CREATE INDEX idx_rankings_overview_canonical_name ON rankings_overview (canonical_name);
CREATE INDEX idx_rankings_overview_canonical_country ON rankings_overview (canonical_name, country);
CREATE INDEX idx_rankings_overview_industry ON rankings_overview (industry_context);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

