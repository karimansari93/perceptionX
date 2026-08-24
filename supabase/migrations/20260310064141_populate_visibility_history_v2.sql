-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260310064141; this file was
-- back-filled afterwards and therefore post-dates the deployment.


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
WITH period_mentions AS (
  SELECT
    trim(unnest(string_to_array(pr.detected_competitors, ','))) as canonical_name,
    cp.industry_context,
    cp.location_context as country,
    pr.index_period,
    count(*) as mention_count
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
  WHERE pr.for_index = true
  AND pr.index_period IS NOT NULL
  AND pr.detected_competitors IS NOT NULL
  AND cp.industry_context IS NOT NULL
  AND cp.location_context IS NOT NULL
  GROUP BY
    trim(unnest(string_to_array(pr.detected_competitors, ','))),
    cp.industry_context,
    cp.location_context,
    pr.index_period
),
filtered AS (
  SELECT pm.*
  FROM period_mentions pm
  LEFT JOIN company_entity_classifications ec
    ON lower(trim(pm.canonical_name)) = lower(ec.company_name)
  WHERE (ec.entity_type IS NULL OR ec.entity_type != 'source')
  AND length(trim(pm.canonical_name)) >= 3
),
ranked AS (
  SELECT
    canonical_name,
    industry_context,
    country,
    index_period,
    mention_count,
    round(least(100, (ln(mention_count + 1) / ln(50)) * 100)::numeric, 1) as visibility_score,
    rank() OVER (
      PARTITION BY industry_context, country, index_period
      ORDER BY mention_count DESC
    ) as rank_position,
    count(*) OVER (
      PARTITION BY industry_context, country, index_period
    ) as total_in_industry
  FROM filtered
)
SELECT
  canonical_name,
  industry_context,
  country,
  index_period,
  mention_count,
  visibility_score,
  rank_position::int,
  total_in_industry::int,
  round((1 - (rank_position - 1.0) / nullif(total_in_industry - 1, 0)) * 100, 1) as percentile
FROM ranked
ON CONFLICT (canonical_name, industry_context, country, index_period)
DO NOTHING;

