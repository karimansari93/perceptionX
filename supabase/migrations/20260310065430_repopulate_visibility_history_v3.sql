-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260310065430; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Clear existing incorrect data
TRUNCATE company_visibility_history;

-- Repopulate using same logic as rankings_overview
INSERT INTO company_visibility_history (
  canonical_name,
  industry_context,
  country,
  index_period,
  mention_count,
  visibility_score,
  rank_position,
  total_in_industry,
  percentile
)
WITH raw_split AS (
  SELECT
    pr.index_period,
    cp.industry_context,
    cp.location_context AS country,
    clean_company_name(token) AS company_name
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  CROSS JOIN LATERAL regexp_split_to_table(pr.detected_competitors, '[,;\n]+') AS token
  WHERE pr.for_index = true
  AND pr.index_period IS NOT NULL
  AND cp.industry_context IS NOT NULL
  AND cp.location_context IS NOT NULL
  AND length(trim(token)) > 1
),
company_stats AS (
  SELECT
    index_period,
    industry_context,
    country,
    company_name,
    count(*) AS mention_count
  FROM raw_split
  GROUP BY index_period, industry_context, country, company_name
),
with_canonical AS (
  SELECT
    cs.index_period,
    cs.industry_context,
    cs.country,
    cs.company_name,
    COALESCE(ccn.canonical_name, cs.company_name) AS canonical_name,
    cs.mention_count
  FROM company_stats cs
  LEFT JOIN company_canonical_names ccn ON lower(cs.company_name) = lower(ccn.variant_name)
),
-- Aggregate to canonical level (multiple variants may map to same canonical)
canonical_stats AS (
  SELECT
    index_period,
    industry_context,
    country,
    canonical_name,
    sum(mention_count) AS mention_count
  FROM with_canonical
  -- Filter out source entities and small companies, same as rankings_overview
  WHERE NOT is_source_entity(canonical_name, canonical_name)
  AND EXISTS (
    SELECT 1 FROM company_employee_tiers cet
    WHERE lower(cet.company_name) = lower(canonical_name)
    AND cet.estimated_tier IS NOT NULL
    AND cet.estimated_tier NOT IN ('<50', '50-499')
  )
  GROUP BY index_period, industry_context, country, canonical_name
),
ranked AS (
  SELECT
    canonical_name,
    industry_context,
    country,
    index_period,
    mention_count,
    rank() OVER (
      PARTITION BY industry_context, country, index_period
      ORDER BY mention_count DESC
    ) AS rank_position,
    count(*) OVER (
      PARTITION BY industry_context, country, index_period
    ) AS total_in_industry
  FROM canonical_stats
)
SELECT
  canonical_name,
  industry_context,
  country,
  index_period,
  mention_count,
  -- Match frontend scoring formula (to be confirmed)
  NULL::numeric AS visibility_score,
  rank_position::int,
  total_in_industry::int,
  round((1 - (rank_position - 1.0) / nullif(total_in_industry - 1, 0)) * 100, 1) AS percentile
FROM ranked
ON CONFLICT (canonical_name, industry_context, country, index_period)
DO NOTHING;

