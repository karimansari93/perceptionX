-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260310064155; this file was
-- back-filled afterwards and therefore post-dates the deployment.


INSERT INTO company_visibility_history (
  canonical_name, industry_context, country, index_period,
  mention_count, visibility_score, rank_position, total_in_industry, percentile, recorded_at
)
WITH raw_split AS (
  SELECT
    cp.industry_context,
    cp.location_context AS country,
    COALESCE(ccn.canonical_name, clean_company_name(token.token)) AS canonical_name
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  CROSS JOIN LATERAL regexp_split_to_table(pr.detected_competitors, '[,;\n]+') AS token(token)
  LEFT JOIN company_canonical_names ccn ON lower(clean_company_name(token.token)) = lower(ccn.variant_name)
  WHERE pr.for_index = true
    AND pr.index_period = '2026-02'
    AND cp.industry_context IS NOT NULL
    AND cp.location_context IS NOT NULL
    AND length(trim(token.token)) > 1
),
filtered AS (
  SELECT rs.industry_context, rs.country, rs.canonical_name
  FROM raw_split rs
  JOIN company_employee_tiers cet ON lower(rs.canonical_name) = lower(cet.company_name)
  LEFT JOIN company_entity_classifications cec ON lower(rs.canonical_name) = lower(cec.company_name)
  WHERE cet.estimated_tier NOT IN ('<50', '50-499')
    AND (cec.entity_type IS NULL OR cec.entity_type != 'source')
),
company_mentions AS (
  SELECT industry_context, country, canonical_name, count(*) AS mention_count
  FROM filtered
  GROUP BY industry_context, country, canonical_name
),
industry_totals AS (
  SELECT industry_context, country,
    count(*) AS total_companies,
    max(mention_count) AS max_mentions
  FROM company_mentions
  GROUP BY industry_context, country
),
ranked AS (
  SELECT
    cm.canonical_name, cm.industry_context, cm.country,
    cm.mention_count,
    ROUND((cm.mention_count::numeric / NULLIF(it.max_mentions, 0)) * 100, 2) AS visibility_score,
    RANK() OVER (PARTITION BY cm.industry_context, cm.country ORDER BY cm.mention_count DESC) AS rank_position,
    it.total_companies,
    ROUND((1 - RANK() OVER (PARTITION BY cm.industry_context, cm.country ORDER BY cm.mention_count DESC)::numeric / NULLIF(it.total_companies, 0)) * 100, 2) AS percentile
  FROM company_mentions cm
  JOIN industry_totals it ON it.industry_context = cm.industry_context AND it.country = cm.country
)
SELECT canonical_name, industry_context, country, '2026-02',
  mention_count, visibility_score, rank_position, total_companies, percentile, now()
FROM ranked
ON CONFLICT (canonical_name, industry_context, country, index_period) DO NOTHING;

