-- ============================================================================
-- Fix sentiment MV: use ai_themes.sentiment text label instead of numeric
-- threshold on sentiment_score.
-- Fix relevance MV: join by exact URL (not domain) and only include
-- responses where company_mentioned = true.
-- ============================================================================

-- ============================
-- 1. Sentiment MV
-- ============================
-- Drop the RLS-safe view first (depends on the MV)
DROP VIEW IF EXISTS company_sentiment_scores;
DROP MATERIALIZED VIEW IF EXISTS company_sentiment_scores_mv;

CREATE MATERIALIZED VIEW company_sentiment_scores_mv AS
WITH sentiment_responses AS (
  SELECT 
    pr.id,
    pr.company_id,
    pr.tested_at,
    cp.prompt_type,
    cp.prompt_category,
    cp.prompt_theme,
    COALESCE(cp.industry_context, c.industry) as industry_context,
    DATE_TRUNC('month', pr.tested_at) as response_month
  FROM prompt_responses pr
  INNER JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  INNER JOIN companies c ON pr.company_id = c.id
  WHERE cp.prompt_type IN ('sentiment', 'competitive', 'talentx_sentiment', 'talentx_competitive')
    AND pr.company_id IS NOT NULL
),
ai_themes_aggregated AS (
  SELECT 
    sr.company_id,
    sr.response_month,
    sr.prompt_type,
    sr.prompt_category,
    sr.prompt_theme,
    sr.industry_context,
    COUNT(DISTINCT at.id) as total_themes,
    COUNT(DISTINCT at.id) FILTER (WHERE at.sentiment = 'positive') as positive_themes,
    COUNT(DISTINCT at.id) FILTER (WHERE at.sentiment = 'negative') as negative_themes,
    COUNT(DISTINCT at.id) FILTER (WHERE at.sentiment = 'neutral')  as neutral_themes,
    AVG(at.sentiment_score) as avg_sentiment_score
  FROM sentiment_responses sr
  LEFT JOIN ai_themes at ON sr.id = at.response_id
  GROUP BY sr.company_id, sr.response_month, sr.prompt_type, sr.prompt_category, sr.prompt_theme, sr.industry_context
)
SELECT 
  company_id,
  response_month,
  prompt_type,
  prompt_category,
  prompt_theme,
  industry_context,
  total_themes,
  positive_themes,
  negative_themes,
  neutral_themes,
  CASE 
    WHEN total_themes > 0 
    THEN positive_themes::NUMERIC / total_themes
    ELSE 0 
  END as sentiment_ratio,
  COALESCE(avg_sentiment_score, 0) as avg_sentiment_score,
  NOW() as calculated_at
FROM ai_themes_aggregated
WHERE total_themes > 0;

-- Indexes
CREATE INDEX idx_sentiment_mv_company_month 
  ON company_sentiment_scores_mv(company_id, response_month DESC);
CREATE INDEX idx_sentiment_mv_industry 
  ON company_sentiment_scores_mv(industry_context, response_month DESC);
CREATE INDEX idx_sentiment_mv_company_type 
  ON company_sentiment_scores_mv(company_id, prompt_type, response_month DESC);
CREATE UNIQUE INDEX idx_company_sentiment_scores_mv_unique
  ON company_sentiment_scores_mv (company_id, response_month, prompt_type, prompt_category, prompt_theme, industry_context);

GRANT SELECT ON company_sentiment_scores_mv TO authenticated;

-- Recreate RLS-safe view
CREATE OR REPLACE VIEW company_sentiment_scores AS
SELECT mv.*
FROM company_sentiment_scores_mv mv
WHERE EXISTS (
  SELECT 1 FROM company_members cm
  WHERE cm.company_id = mv.company_id
    AND cm.user_id = auth.uid()
);
GRANT SELECT ON company_sentiment_scores TO authenticated;

-- ============================
-- 2. Relevance MV
-- ============================
DROP VIEW IF EXISTS company_relevance_scores;
DROP MATERIALIZED VIEW IF EXISTS company_relevance_scores_mv;

CREATE MATERIALIZED VIEW company_relevance_scores_mv AS
WITH citation_urls AS (
  SELECT 
    pr.id as response_id,
    pr.company_id,
    pr.tested_at,
    cp.prompt_type,
    cp.prompt_category,
    cp.prompt_theme,
    COALESCE(cp.industry_context, c.industry) as industry_context,
    jsonb_array_elements(pr.citations::jsonb)->>'url' as citation_url,
    DATE_TRUNC('month', pr.tested_at) as response_month
  FROM prompt_responses pr
  INNER JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  INNER JOIN companies c ON pr.company_id = c.id
  WHERE pr.citations IS NOT NULL 
    AND jsonb_array_length(pr.citations::jsonb) > 0
    AND pr.company_id IS NOT NULL
    AND pr.company_mentioned = true
),
relevance_aggregated AS (
  SELECT 
    cu.company_id,
    cu.response_month,
    cu.prompt_type,
    cu.prompt_category,
    cu.prompt_theme,
    cu.industry_context,
    COUNT(DISTINCT cu.citation_url) as total_citations,
    COUNT(DISTINCT urc.url) FILTER (WHERE urc.recency_score IS NOT NULL) as valid_citations,
    AVG(urc.recency_score) FILTER (WHERE urc.recency_score IS NOT NULL) as avg_relevance_score
  FROM citation_urls cu
  LEFT JOIN url_recency_cache urc ON cu.citation_url = urc.url
  GROUP BY cu.company_id, cu.response_month, cu.prompt_type, cu.prompt_category, cu.prompt_theme, cu.industry_context
)
SELECT 
  company_id,
  response_month,
  prompt_type,
  prompt_category,
  prompt_theme,
  industry_context,
  total_citations,
  valid_citations,
  COALESCE(avg_relevance_score, 0) as relevance_score,
  CASE 
    WHEN total_citations > 0 
    THEN (valid_citations::NUMERIC / total_citations) * 100
    ELSE 0 
  END as citation_coverage_percentage,
  NOW() as calculated_at
FROM relevance_aggregated
WHERE total_citations > 0;

-- Indexes
CREATE INDEX idx_relevance_mv_company_month 
  ON company_relevance_scores_mv(company_id, response_month DESC);
CREATE INDEX idx_relevance_mv_industry 
  ON company_relevance_scores_mv(industry_context, response_month DESC);
CREATE INDEX idx_relevance_mv_company_type 
  ON company_relevance_scores_mv(company_id, prompt_type, response_month DESC);
CREATE UNIQUE INDEX idx_company_relevance_scores_mv_unique
  ON company_relevance_scores_mv (company_id, response_month, prompt_type, prompt_category, prompt_theme, industry_context);

GRANT SELECT ON company_relevance_scores_mv TO authenticated;

-- Recreate RLS-safe view
CREATE OR REPLACE VIEW company_relevance_scores AS
SELECT mv.*
FROM company_relevance_scores_mv mv
WHERE EXISTS (
  SELECT 1 FROM company_members cm
  WHERE cm.company_id = mv.company_id
    AND cm.user_id = auth.uid()
);
GRANT SELECT ON company_relevance_scores TO authenticated;

-- ============================
-- 3. Populate
-- ============================
REFRESH MATERIALIZED VIEW company_sentiment_scores_mv;
REFRESH MATERIALIZED VIEW company_relevance_scores_mv;
