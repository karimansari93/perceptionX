-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260608114528; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Per-location ("by_location") company metrics materialized views.
-- Additive: existing company_*_mv are left untouched. App reads the existing MV
-- when no location is selected, and the *_by_location_mv (filtered to a
-- location_context) when a location is selected. Re-runnable (DROP IF EXISTS).

-- 1. Sentiment by location
DROP MATERIALIZED VIEW IF EXISTS company_sentiment_scores_by_location_mv;
CREATE MATERIALIZED VIEW company_sentiment_scores_by_location_mv AS
WITH sentiment_responses AS (
  SELECT pr.id, pr.company_id, pr.tested_at, cp.prompt_type, cp.prompt_category, cp.prompt_theme,
    COALESCE(cp.industry_context, c.industry) AS industry_context,
    COALESCE(cp.job_function_context, '') AS job_function_context,
    COALESCE(NULLIF(btrim(cp.location_context), ''), '') AS location_context,
    COALESCE((pr.collection_cycle::timestamp without time zone AT TIME ZONE 'UTC'), date_trunc('month', pr.tested_at)) AS response_month
  FROM prompt_responses pr
  INNER JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  INNER JOIN companies c ON pr.company_id = c.id
  WHERE cp.prompt_type = ANY (ARRAY['sentiment','competitive','talentx_sentiment','talentx_competitive']) AND pr.company_id IS NOT NULL
),
ai_themes_aggregated AS (
  SELECT sr.company_id, sr.location_context, sr.response_month, sr.prompt_type, sr.prompt_category, sr.prompt_theme, sr.industry_context, sr.job_function_context,
    COUNT(DISTINCT at.id) AS total_themes,
    COUNT(DISTINCT at.id) FILTER (WHERE at.sentiment = 'positive') AS positive_themes,
    COUNT(DISTINCT at.id) FILTER (WHERE at.sentiment = 'negative') AS negative_themes,
    COUNT(DISTINCT at.id) FILTER (WHERE at.sentiment = 'neutral')  AS neutral_themes,
    AVG(at.sentiment_score) AS avg_sentiment_score
  FROM sentiment_responses sr
  LEFT JOIN ai_themes at ON sr.id = at.response_id
  GROUP BY sr.company_id, sr.location_context, sr.response_month, sr.prompt_type, sr.prompt_category, sr.prompt_theme, sr.industry_context, sr.job_function_context
)
SELECT company_id, location_context, response_month, prompt_type, prompt_category, prompt_theme, industry_context, job_function_context,
  total_themes, positive_themes, negative_themes, neutral_themes,
  CASE WHEN total_themes > 0 THEN positive_themes::NUMERIC / total_themes ELSE 0 END AS sentiment_ratio,
  COALESCE(avg_sentiment_score, 0) AS avg_sentiment_score, NOW() AS calculated_at
FROM ai_themes_aggregated WHERE total_themes > 0;
CREATE UNIQUE INDEX company_sentiment_by_location_mv_uniq ON company_sentiment_scores_by_location_mv (company_id, location_context, response_month, prompt_type, prompt_category, prompt_theme, industry_context, job_function_context);
CREATE INDEX company_sentiment_by_location_mv_lookup ON company_sentiment_scores_by_location_mv (company_id, location_context, response_month DESC);
GRANT SELECT ON company_sentiment_scores_by_location_mv TO authenticated;

-- 2. Relevance by location
DROP MATERIALIZED VIEW IF EXISTS company_relevance_scores_by_location_mv;
CREATE MATERIALIZED VIEW company_relevance_scores_by_location_mv AS
WITH citation_urls AS (
  SELECT pr.id AS response_id, pr.company_id, pr.tested_at, cp.prompt_type, cp.prompt_category, cp.prompt_theme,
    COALESCE(cp.industry_context, c.industry) AS industry_context,
    COALESCE(cp.job_function_context, '') AS job_function_context,
    COALESCE(NULLIF(btrim(cp.location_context), ''), '') AS location_context,
    jsonb_array_elements(pr.citations)->>'url' AS citation_url,
    COALESCE((pr.collection_cycle::timestamp without time zone AT TIME ZONE 'UTC'), date_trunc('month', pr.tested_at)) AS response_month
  FROM prompt_responses pr
  INNER JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  INNER JOIN companies c ON pr.company_id = c.id
  WHERE pr.citations IS NOT NULL AND jsonb_array_length(pr.citations) > 0 AND pr.company_id IS NOT NULL AND pr.company_mentioned = true
),
relevance_aggregated AS (
  SELECT cu.company_id, cu.location_context, cu.response_month, cu.prompt_type, cu.prompt_category, cu.prompt_theme, cu.industry_context, cu.job_function_context,
    COUNT(DISTINCT cu.citation_url) AS total_citations,
    COUNT(DISTINCT urc.url) FILTER (WHERE urc.recency_score IS NOT NULL) AS valid_citations,
    AVG(urc.recency_score) FILTER (WHERE urc.recency_score IS NOT NULL) AS avg_relevance_score
  FROM citation_urls cu
  LEFT JOIN url_recency_cache urc ON cu.citation_url = urc.url
  GROUP BY cu.company_id, cu.location_context, cu.response_month, cu.prompt_type, cu.prompt_category, cu.prompt_theme, cu.industry_context, cu.job_function_context
)
SELECT company_id, location_context, response_month, prompt_type, prompt_category, prompt_theme, industry_context, job_function_context,
  total_citations, valid_citations, COALESCE(avg_relevance_score, 0) AS relevance_score,
  CASE WHEN total_citations > 0 THEN (valid_citations::NUMERIC / total_citations) * 100 ELSE 0 END AS citation_coverage_percentage, NOW() AS calculated_at
FROM relevance_aggregated WHERE total_citations > 0;
CREATE UNIQUE INDEX company_relevance_by_location_mv_uniq ON company_relevance_scores_by_location_mv (company_id, location_context, response_month, prompt_type, prompt_category, prompt_theme, industry_context, job_function_context);
CREATE INDEX company_relevance_by_location_mv_lookup ON company_relevance_scores_by_location_mv (company_id, location_context, response_month DESC);
GRANT SELECT ON company_relevance_scores_by_location_mv TO authenticated;

-- 3. Attribute themes by location
DROP MATERIALIZED VIEW IF EXISTS company_attribute_themes_by_location_mv;
CREATE MATERIALIZED VIEW company_attribute_themes_by_location_mv AS
SELECT t.company_id,
  COALESCE(NULLIF(btrim(cp.location_context), ''), '') AS location_context,
  date_trunc('month', pr.tested_at)::date AS response_month,
  COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') AS job_function_context,
  btrim(t.talentx_attribute_id) AS attribute_id,
  count(*) AS total_themes,
  count(*) FILTER (WHERE t.sentiment = 'positive') AS positive_themes,
  count(*) FILTER (WHERE t.sentiment = 'negative') AS negative_themes,
  count(*) FILTER (WHERE t.sentiment = 'neutral')  AS neutral_themes,
  avg(t.sentiment_score) AS avg_sentiment_score,
  count(DISTINCT t.response_id) AS response_count, now() AS calculated_at
FROM ai_themes t
JOIN prompt_responses pr ON pr.id = t.response_id
JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
WHERE pr.tested_at IS NOT NULL
  AND btrim(t.talentx_attribute_id) = ANY (ARRAY['mission-purpose','rewards-recognition','company-culture','social-impact','inclusion','innovation','wellbeing-balance','leadership','security-perks','career-opportunities','application-process','candidate-communication','interview-experience','candidate-feedback','onboarding-experience','overall-candidate-experience'])
GROUP BY t.company_id, COALESCE(NULLIF(btrim(cp.location_context), ''), ''), date_trunc('month', pr.tested_at), COALESCE(NULLIF(btrim(cp.job_function_context), ''), ''), btrim(t.talentx_attribute_id);
CREATE UNIQUE INDEX company_attribute_themes_by_location_mv_uniq ON company_attribute_themes_by_location_mv (company_id, location_context, response_month, job_function_context, attribute_id);
CREATE INDEX company_attribute_themes_by_location_mv_lookup ON company_attribute_themes_by_location_mv (company_id, location_context);
GRANT SELECT ON company_attribute_themes_by_location_mv TO authenticated;

-- 4. Top sources by location
DROP MATERIALIZED VIEW IF EXISTS company_top_sources_by_location_mv;
CREATE MATERIALIZED VIEW company_top_sources_by_location_mv AS
WITH unnested AS (
  SELECT pr.company_id,
    COALESCE(NULLIF(btrim(cp.location_context), ''), '') AS location_context,
    lower(regexp_replace(c.value->>'domain', '^www\.', '')) AS domain,
    c.value->>'url' AS url
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
  CROSS JOIN LATERAL jsonb_array_elements(pr.citations) c(value)
  WHERE pr.company_id IS NOT NULL AND pr.for_index IS NOT TRUE AND jsonb_typeof(pr.citations) = 'array'
    AND (c.value->>'domain') IS NOT NULL AND (c.value->>'domain') <> ''
)
SELECT company_id, location_context, domain, min(url) AS sample_url, count(*) AS citation_count,
  round(count(*)::numeric / sum(count(*)) OVER (PARTITION BY company_id, location_context) * 100, 1) AS pct_of_total
FROM unnested WHERE domain <> '' GROUP BY company_id, location_context, domain;
CREATE UNIQUE INDEX company_top_sources_by_location_mv_uniq ON company_top_sources_by_location_mv (company_id, location_context, domain);
CREATE INDEX company_top_sources_by_location_mv_lookup ON company_top_sources_by_location_mv (company_id, location_context, citation_count DESC);
GRANT SELECT ON company_top_sources_by_location_mv TO authenticated;

-- 5. Competitors by location
DROP MATERIALIZED VIEW IF EXISTS company_competitors_by_location_mv;
CREATE MATERIALIZED VIEW company_competitors_by_location_mv AS
WITH raw AS (
  SELECT pr.company_id,
    COALESCE(NULLIF(btrim(cp.location_context), ''), '') AS location_context,
    normalize_entity_name(btrim(unnest(string_to_array(pr.detected_competitors, ',')))) AS normalized_alias
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
  WHERE pr.company_id IS NOT NULL AND pr.for_index IS NOT TRUE AND pr.detected_competitors IS NOT NULL AND pr.detected_competitors <> ''
),
mapped AS (
  SELECT r.company_id, r.location_context, COALESCE(ce.canonical_name, initcap(r.normalized_alias)) AS competitor_name, ce.is_active
  FROM raw r
  LEFT JOIN entity_aliases ea ON ea.normalized_alias = r.normalized_alias
  LEFT JOIN canonical_entities ce ON ce.id = ea.canonical_id
  WHERE r.normalized_alias IS NOT NULL AND r.normalized_alias <> '' AND length(r.normalized_alias) > 1
    AND (r.normalized_alias <> ALL (ARRAY['glassdoor','indeed','ambitionbox','workday','linkedin','monster','careerbuilder','ziprecruiter','dice','angelist','wellfound','builtin','stackoverflow','github']))
    AND (r.normalized_alias <> ALL (ARRAY['none','n/a','na','null','undefined']))
    AND r.normalized_alias !~ '^[0-9]+$' AND r.normalized_alias ~ '[a-z0-9]'
    AND NOT (length(r.normalized_alias) <= 2 AND r.normalized_alias ~ '^[a-z]{1,2}$')
)
SELECT company_id, location_context, competitor_name, count(*) AS mention_count
FROM mapped WHERE is_active IS NOT FALSE GROUP BY company_id, location_context, competitor_name;
CREATE UNIQUE INDEX company_competitors_by_location_mv_uniq ON company_competitors_by_location_mv (company_id, location_context, competitor_name);
CREATE INDEX company_competitors_by_location_mv_lookup ON company_competitors_by_location_mv (company_id, location_context, mention_count DESC);
GRANT SELECT ON company_competitors_by_location_mv TO authenticated;

-- 6. LLM rankings by location
DROP MATERIALIZED VIEW IF EXISTS company_llm_rankings_by_location_mv;
CREATE MATERIALIZED VIEW company_llm_rankings_by_location_mv AS
SELECT pr.company_id,
  COALESCE(NULLIF(btrim(cp.location_context), ''), '') AS location_context,
  pr.ai_model, count(*) AS total_responses,
  count(*) FILTER (WHERE pr.company_mentioned = true) AS mentions,
  round(count(*) FILTER (WHERE pr.company_mentioned = true)::numeric / NULLIF(count(*), 0)::numeric * 100, 1) AS mention_pct
FROM prompt_responses pr
JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
WHERE pr.company_id IS NOT NULL AND pr.for_index IS NOT TRUE AND pr.ai_model IS NOT NULL
GROUP BY pr.company_id, COALESCE(NULLIF(btrim(cp.location_context), ''), ''), pr.ai_model;
CREATE UNIQUE INDEX company_llm_rankings_by_location_mv_uniq ON company_llm_rankings_by_location_mv (company_id, location_context, ai_model);
CREATE INDEX company_llm_rankings_by_location_mv_lookup ON company_llm_rankings_by_location_mv (company_id, location_context, mentions DESC);
GRANT SELECT ON company_llm_rankings_by_location_mv TO authenticated;
