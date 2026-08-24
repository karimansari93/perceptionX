-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260331123250; this file was
-- back-filled afterwards and therefore post-dates the deployment.


DROP MATERIALIZED VIEW IF EXISTS rankings_historical;

CREATE MATERIALIZED VIEW rankings_historical AS
WITH raw_data AS (
  SELECT pr.index_period,
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
), period_industry_stats AS (
  SELECT index_period,
    industry_context,
    country,
    array_agg(DISTINCT (ai_model || '::') || COALESCE(prompt_theme, 'null')) AS all_combinations
  FROM raw_data
  GROUP BY index_period, industry_context, country
), raw_split AS (
  SELECT rd.index_period,
    rd.ai_model,
    rd.industry_context,
    rd.country,
    rd.prompt_theme,
    clean_company_name(token.token) AS company_name
  FROM raw_data rd
  CROSS JOIN LATERAL regexp_split_to_table(rd.detected_competitors, '[,;\n]+') token(token)
  WHERE length(TRIM(BOTH FROM token.token)) > 1
), company_stats AS (
  SELECT index_period,
    industry_context,
    country,
    company_name,
    count(*) AS mention_count,
    array_agg(DISTINCT (ai_model || '::') || COALESCE(prompt_theme, 'null')) AS combinations
  FROM raw_split
  GROUP BY index_period, industry_context, country, company_name
), with_canonical AS (
  SELECT cs.index_period,
    cs.company_name,
    COALESCE(ccn.canonical_name, cs.company_name) AS canonical_name,
    COALESCE(ccn.website_domain, '') AS website_domain,
    cs.industry_context,
    cs.country,
    cs.mention_count,
    cs.combinations,
    pis.all_combinations AS all_period_combinations
  FROM company_stats cs
  JOIN period_industry_stats pis ON cs.index_period = pis.index_period
    AND cs.industry_context = pis.industry_context
    AND cs.country = pis.country
  LEFT JOIN company_canonical_names ccn ON lower(cs.company_name) = lower(ccn.variant_name)
)
SELECT
  wc.index_period,
  wc.company_name,
  wc.canonical_name,
  wc.website_domain,
  wc.industry_context,
  wc.country,
  wc.mention_count,
  wc.combinations,
  wc.all_period_combinations,
  -- Pre-computed scores
  COALESCE(ROUND(LEAST(100.0,
    (SELECT COUNT(*)::numeric FROM unnest(wc.combinations) c) /
    NULLIF((SELECT COUNT(*)::numeric FROM unnest(wc.all_period_combinations) c), 0) * 100
  ), 1), 0) AS score_all,
  COALESCE(ROUND(LEAST(100.0,
    (SELECT COUNT(*)::numeric FROM unnest(wc.combinations) c WHERE c ILIKE '%gpt%') /
    NULLIF((SELECT COUNT(*)::numeric FROM unnest(wc.all_period_combinations) c WHERE c ILIKE '%gpt%'), 0) * 100
  ), 1), 0) AS score_chatgpt,
  COALESCE(ROUND(LEAST(100.0,
    (SELECT COUNT(*)::numeric FROM unnest(wc.combinations) c WHERE c ILIKE '%google%' OR c ILIKE '%gemini%' OR c ILIKE '%bard%') /
    NULLIF((SELECT COUNT(*)::numeric FROM unnest(wc.all_period_combinations) c WHERE c ILIKE '%google%' OR c ILIKE '%gemini%' OR c ILIKE '%bard%'), 0) * 100
  ), 1), 0) AS score_google,
  COALESCE(ROUND(LEAST(100.0,
    (SELECT COUNT(*)::numeric FROM unnest(wc.combinations) c WHERE c ILIKE '%perplexity%') /
    NULLIF((SELECT COUNT(*)::numeric FROM unnest(wc.all_period_combinations) c WHERE c ILIKE '%perplexity%'), 0) * 100
  ), 1), 0) AS score_perplexity
FROM with_canonical wc
LEFT JOIN company_overrides co ON lower(wc.canonical_name) = lower(co.canonical_name)
WHERE NOT is_source_entity(wc.company_name, wc.canonical_name)
  AND (co.id IS NULL OR co.status <> 'excluded');

