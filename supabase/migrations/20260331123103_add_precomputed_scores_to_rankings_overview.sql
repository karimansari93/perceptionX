-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260331123103; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Drop company_search_index first (it depends on rankings_overview)
DROP MATERIALIZED VIEW IF EXISTS company_search_index;
DROP MATERIALIZED VIEW IF EXISTS rankings_overview;

CREATE MATERIALIZED VIEW rankings_overview AS
WITH raw_data AS (
  SELECT pr.ai_model,
    cp.industry_context,
    cp.location_context AS country,
    cp.prompt_theme,
    pr.detected_competitors
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  WHERE pr.for_index = true
    AND cp.industry_context IS NOT NULL
    AND cp.location_context IS NOT NULL
), industry_stats AS (
  SELECT industry_context,
    country,
    array_agg(DISTINCT (ai_model || '::') || COALESCE(prompt_theme, 'null')) AS all_industry_combinations
  FROM raw_data
  GROUP BY industry_context, country
), raw_split AS (
  SELECT rd.ai_model,
    rd.industry_context,
    rd.country,
    rd.prompt_theme,
    clean_company_name(token.token) AS company_name
  FROM raw_data rd
  CROSS JOIN LATERAL regexp_split_to_table(rd.detected_competitors, '[,;\n]+') token(token)
  WHERE length(TRIM(BOTH FROM token.token)) > 1
), company_stats AS (
  SELECT industry_context,
    country,
    company_name,
    count(*) AS mention_count,
    array_agg(DISTINCT (ai_model || '::') || COALESCE(prompt_theme, 'null')) AS combinations
  FROM raw_split
  GROUP BY industry_context, country, company_name
), with_canonical AS (
  SELECT cs.company_name,
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
), canonical_aggregated AS (
  SELECT canonical_name,
    max(website_domain) AS website_domain,
    industry_context,
    country,
    sum(mention_count) AS mention_count,
    array_agg(DISTINCT combo.combo) AS combinations,
    max(all_industry_combinations) AS all_industry_combinations
  FROM with_canonical
  CROSS JOIN LATERAL unnest(combinations) combo(combo)
  GROUP BY canonical_name, industry_context, country
), scored AS (
  SELECT ca.canonical_name,
    ca.website_domain,
    ca.industry_context,
    ca.country,
    ca.mention_count,
    ca.combinations,
    ca.all_industry_combinations,
    -- All models combined
    COALESCE(ROUND(LEAST(100.0,
      (SELECT COUNT(*)::numeric FROM unnest(ca.combinations) c) /
      NULLIF((SELECT COUNT(*)::numeric FROM unnest(ca.all_industry_combinations) c), 0) * 100
    ), 1), 0) AS score_all,
    -- ChatGPT (any model name containing 'gpt')
    COALESCE(ROUND(LEAST(100.0,
      (SELECT COUNT(*)::numeric FROM unnest(ca.combinations) c WHERE c ILIKE '%gpt%') /
      NULLIF((SELECT COUNT(*)::numeric FROM unnest(ca.all_industry_combinations) c WHERE c ILIKE '%gpt%'), 0) * 100
    ), 1), 0) AS score_chatgpt,
    -- Google (AI Overviews, Gemini, Bard)
    COALESCE(ROUND(LEAST(100.0,
      (SELECT COUNT(*)::numeric FROM unnest(ca.combinations) c WHERE c ILIKE '%google%' OR c ILIKE '%gemini%' OR c ILIKE '%bard%') /
      NULLIF((SELECT COUNT(*)::numeric FROM unnest(ca.all_industry_combinations) c WHERE c ILIKE '%google%' OR c ILIKE '%gemini%' OR c ILIKE '%bard%'), 0) * 100
    ), 1), 0) AS score_google,
    -- Perplexity
    COALESCE(ROUND(LEAST(100.0,
      (SELECT COUNT(*)::numeric FROM unnest(ca.combinations) c WHERE c ILIKE '%perplexity%') /
      NULLIF((SELECT COUNT(*)::numeric FROM unnest(ca.all_industry_combinations) c WHERE c ILIKE '%perplexity%'), 0) * 100
    ), 1), 0) AS score_perplexity
  FROM canonical_aggregated ca
  LEFT JOIN company_employee_tiers cet ON lower(ca.canonical_name) = lower(cet.company_name)
  LEFT JOIN company_overrides co ON lower(ca.canonical_name) = lower(co.canonical_name)
  WHERE cet.estimated_tier IS NOT NULL
    AND (cet.estimated_tier <> ALL (ARRAY['<50', '50-499']))
    AND (co.id IS NULL OR co.status <> 'excluded')
)
SELECT
  canonical_name,
  website_domain,
  industry_context,
  country,
  mention_count,
  combinations,
  all_industry_combinations,
  score_all,
  score_chatgpt,
  score_google,
  score_perplexity
FROM scored;

-- Recreate company_search_index using the new score_all column
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
GROUP BY ro.canonical_name, b.best_industry;

