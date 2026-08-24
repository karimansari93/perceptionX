-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260218105016; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- ============================================================
-- MV 1: company_overview_metrics_mv
-- Replaces the massive metrics useMemo in useDashboardData.ts
-- Computes: total_responses, visibility %, citation counts,
--           sentiment breakdown (from ai_themes), perception score
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS company_overview_metrics_mv AS
WITH response_base AS (
  SELECT
    pr.company_id,
    pr.id AS response_id,
    pr.company_mentioned,
    pr.tested_at,
    pr.confirmed_prompt_id,
    cp.prompt_type
  FROM prompt_responses pr
  LEFT JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
),
visibility_stats AS (
  SELECT
    company_id,
    COUNT(*) AS total_responses,
    COUNT(*) FILTER (WHERE company_mentioned = TRUE) AS mentioned_count,
    ROUND((COUNT(*) FILTER (WHERE company_mentioned = TRUE)::NUMERIC / NULLIF(COUNT(*), 0)) * 100, 2) AS visibility_pct,
    MAX(tested_at) AS last_tested_at
  FROM response_base
  GROUP BY company_id
),
citation_stats AS (
  SELECT
    company_id,
    SUM(jsonb_array_length(citations)) AS total_citations,
    COUNT(DISTINCT c->>'domain') AS unique_domains
  FROM prompt_responses,
       jsonb_array_elements(citations) AS c
  WHERE jsonb_typeof(citations) = 'array'
  GROUP BY company_id
),
theme_sentiment AS (
  SELECT
    pr.company_id,
    COUNT(*) FILTER (WHERE t.sentiment_score > 0.1) AS positive_themes,
    COUNT(*) FILTER (WHERE t.sentiment_score < -0.1) AS negative_themes,
    COUNT(*) AS total_non_neutral_themes
  FROM ai_themes t
  JOIN prompt_responses pr ON pr.id = t.response_id
  GROUP BY pr.company_id
),
sentiment_calc AS (
  SELECT
    company_id,
    positive_themes,
    negative_themes,
    CASE
      WHEN (positive_themes + negative_themes) > 0
      THEN ROUND((positive_themes::NUMERIC / (positive_themes + negative_themes)) * 100, 2)
      ELSE 0
    END AS sentiment_pct
  FROM theme_sentiment
)
SELECT
  v.company_id,
  v.total_responses,
  v.mentioned_count,
  v.visibility_pct,
  v.last_tested_at,
  COALESCE(c.total_citations, 0) AS total_citations,
  COALESCE(c.unique_domains, 0) AS unique_domains,
  COALESCE(s.sentiment_pct, 0) AS sentiment_pct,
  COALESCE(s.positive_themes, 0) AS positive_themes,
  COALESCE(s.negative_themes, 0) AS negative_themes,
  -- Pre-compute perception score: 50% sentiment + 30% visibility + 20% relevance (relevance comes from existing MV)
  NOW() AS refreshed_at
FROM visibility_stats v
LEFT JOIN citation_stats c ON c.company_id = v.company_id
LEFT JOIN sentiment_calc s ON s.company_id = v.company_id;

CREATE UNIQUE INDEX IF NOT EXISTS company_overview_metrics_mv_company_id_idx 
  ON company_overview_metrics_mv (company_id);

-- ============================================================
-- MV 2: company_top_sources_mv
-- Replaces topCitations useMemo — stops client parsing all citations JSONs
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS company_top_sources_mv AS
SELECT
  pr.company_id,
  c->>'domain' AS domain,
  c->>'url' AS sample_url,
  COUNT(*) AS citation_count,
  ROUND((COUNT(*)::NUMERIC / SUM(COUNT(*)) OVER (PARTITION BY pr.company_id)) * 100, 1) AS pct_of_total
FROM prompt_responses pr,
     jsonb_array_elements(pr.citations) AS c
WHERE jsonb_typeof(pr.citations) = 'array'
  AND c->>'domain' IS NOT NULL
  AND c->>'domain' != ''
GROUP BY pr.company_id, c->>'domain', c->>'url';

CREATE INDEX IF NOT EXISTS company_top_sources_mv_company_id_idx 
  ON company_top_sources_mv (company_id, citation_count DESC);

-- ============================================================
-- MV 3: company_competitors_mv
-- Replaces topCompetitors useMemo — stops client parsing detected_competitors text
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS company_competitors_mv AS
WITH competitor_mentions AS (
  SELECT
    company_id,
    TRIM(LOWER(unnest(string_to_array(detected_competitors, ',')))) AS competitor_name
  FROM prompt_responses
  WHERE detected_competitors IS NOT NULL
    AND detected_competitors != ''
)
SELECT
  company_id,
  competitor_name,
  COUNT(*) AS mention_count
FROM competitor_mentions
WHERE competitor_name != ''
GROUP BY company_id, competitor_name;

CREATE INDEX IF NOT EXISTS company_competitors_mv_company_id_idx 
  ON company_competitors_mv (company_id, mention_count DESC);

-- ============================================================
-- MV 4: company_llm_rankings_mv
-- Replaces llmMentionRankings useMemo
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS company_llm_rankings_mv AS
SELECT
  company_id,
  ai_model,
  COUNT(*) AS total_responses,
  COUNT(*) FILTER (WHERE company_mentioned = TRUE) AS mentions,
  ROUND((COUNT(*) FILTER (WHERE company_mentioned = TRUE)::NUMERIC / NULLIF(COUNT(*), 0)) * 100, 1) AS mention_pct
FROM prompt_responses
WHERE ai_model IS NOT NULL
GROUP BY company_id, ai_model;

CREATE INDEX IF NOT EXISTS company_llm_rankings_mv_company_id_idx 
  ON company_llm_rankings_mv (company_id, mentions DESC);

