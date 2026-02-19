-- ============================================================================
-- Materialized views: use new prompt_type values (four intents)
-- ============================================================================
-- Sentiment layer scores all prompt types (experience, competitive, discovery, informational).
-- Drop and recreate company_sentiment_scores_mv with new filter.

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
  WHERE cp.prompt_type IN (
    'experience', 'competitive', 'discovery', 'informational',
    'talentx_experience', 'talentx_competitive', 'talentx_discovery', 'talentx_informational'
  )
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
    COUNT(DISTINCT at.id) FILTER (WHERE at.sentiment_score > 0.1) as positive_themes,
    COUNT(DISTINCT at.id) FILTER (WHERE at.sentiment_score < -0.1) as negative_themes,
    COUNT(DISTINCT at.id) FILTER (WHERE at.sentiment_score >= -0.1 AND at.sentiment_score <= 0.1) as neutral_themes,
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

CREATE INDEX IF NOT EXISTS idx_sentiment_mv_company_month 
  ON company_sentiment_scores_mv(company_id, response_month DESC);
CREATE INDEX IF NOT EXISTS idx_sentiment_mv_industry 
  ON company_sentiment_scores_mv(industry_context, response_month DESC);
CREATE INDEX IF NOT EXISTS idx_sentiment_mv_company_type 
  ON company_sentiment_scores_mv(company_id, prompt_type, response_month DESC);

GRANT SELECT ON company_sentiment_scores_mv TO authenticated;

COMMENT ON MATERIALIZED VIEW company_sentiment_scores_mv IS 
  'Pre-calculated sentiment scores per company per month (four intents: experience, competitive, discovery, informational).';
