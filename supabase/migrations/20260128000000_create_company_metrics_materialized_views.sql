-- ============================================================================
-- Create Materialized Views for Company Sentiment and Relevance Metrics
-- ============================================================================
-- This migration creates materialized views to pre-calculate sentiment and
-- relevance scores for companies, moving expensive calculations from the
-- frontend to the database backend for better performance.
--
-- These views are refreshed periodically (hourly/daily) via the refresh-company-metrics
-- edge function or pg_cron job.

-- ============================================================================
-- Materialized View: Company Sentiment Scores
-- ============================================================================
-- Pre-calculates sentiment metrics per company per month based on AI themes
CREATE MATERIALIZED VIEW IF NOT EXISTS company_sentiment_scores_mv AS
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
  END as sentiment_ratio, -- 0-1 scale (positive themes / total themes)
  COALESCE(avg_sentiment_score, 0) as avg_sentiment_score, -- -1 to 1 scale
  NOW() as calculated_at
FROM ai_themes_aggregated
WHERE total_themes > 0;

-- ============================================================================
-- Materialized View: Company Relevance Scores
-- ============================================================================
-- Pre-calculates relevance metrics per company per month based on citation recency
CREATE MATERIALIZED VIEW IF NOT EXISTS company_relevance_scores_mv AS
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
),
domain_normalized AS (
  SELECT 
    cu.*,
    CASE 
      WHEN cu.citation_url IS NOT NULL THEN
        LOWER(REPLACE(SPLIT_PART(cu.citation_url, '/', 3), 'www.', ''))
      ELSE NULL
    END as domain
  FROM citation_urls cu
  WHERE cu.citation_url IS NOT NULL
),
relevance_aggregated AS (
  SELECT 
    dn.company_id,
    dn.response_month,
    dn.prompt_type,
    dn.prompt_category,
    dn.prompt_theme,
    dn.industry_context,
    COUNT(DISTINCT dn.citation_url) as total_citations,
    COUNT(DISTINCT urc.url) FILTER (WHERE urc.recency_score IS NOT NULL) as valid_citations,
    AVG(urc.recency_score) FILTER (WHERE urc.recency_score IS NOT NULL) as avg_relevance_score
  FROM domain_normalized dn
  LEFT JOIN url_recency_cache urc ON dn.domain = LOWER(REPLACE(SPLIT_PART(urc.url, '/', 3), 'www.', ''))
  GROUP BY dn.company_id, dn.response_month, dn.prompt_type, dn.prompt_category, dn.prompt_theme, dn.industry_context
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
  COALESCE(avg_relevance_score, 0) as relevance_score, -- 0-100 scale
  CASE 
    WHEN total_citations > 0 
    THEN (valid_citations::NUMERIC / total_citations) * 100
    ELSE 0 
  END as citation_coverage_percentage, -- Percentage of citations with valid recency scores
  NOW() as calculated_at
FROM relevance_aggregated
WHERE total_citations > 0;

-- ============================================================================
-- Indexes for Performance
-- ============================================================================
-- Indexes on company_sentiment_scores_mv
CREATE INDEX IF NOT EXISTS idx_sentiment_mv_company_month 
  ON company_sentiment_scores_mv(company_id, response_month DESC);

CREATE INDEX IF NOT EXISTS idx_sentiment_mv_industry 
  ON company_sentiment_scores_mv(industry_context, response_month DESC);

CREATE INDEX IF NOT EXISTS idx_sentiment_mv_company_type 
  ON company_sentiment_scores_mv(company_id, prompt_type, response_month DESC);

-- Indexes on company_relevance_scores_mv
CREATE INDEX IF NOT EXISTS idx_relevance_mv_company_month 
  ON company_relevance_scores_mv(company_id, response_month DESC);

CREATE INDEX IF NOT EXISTS idx_relevance_mv_industry 
  ON company_relevance_scores_mv(industry_context, response_month DESC);

CREATE INDEX IF NOT EXISTS idx_relevance_mv_company_type 
  ON company_relevance_scores_mv(company_id, prompt_type, response_month DESC);

-- ============================================================================
-- Refresh Function
-- ============================================================================
-- Function to refresh both materialized views concurrently (non-blocking)
CREATE OR REPLACE FUNCTION refresh_company_metrics()
RETURNS TABLE (
  view_name TEXT,
  refresh_started TIMESTAMPTZ,
  refresh_completed TIMESTAMPTZ,
  success BOOLEAN,
  error_message TEXT
) AS $$
DECLARE
  v_start_time TIMESTAMPTZ;
  v_end_time TIMESTAMPTZ;
  v_error TEXT;
BEGIN
  -- Refresh sentiment scores
  v_start_time := NOW();
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY company_sentiment_scores_mv;
    v_end_time := NOW();
    RETURN QUERY SELECT 
      'company_sentiment_scores_mv'::TEXT,
      v_start_time,
      v_end_time,
      TRUE,
      NULL::TEXT;
  EXCEPTION WHEN OTHERS THEN
    v_end_time := NOW();
    v_error := SQLERRM;
    RETURN QUERY SELECT 
      'company_sentiment_scores_mv'::TEXT,
      v_start_time,
      v_end_time,
      FALSE,
      v_error;
  END;

  -- Refresh relevance scores
  v_start_time := NOW();
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY company_relevance_scores_mv;
    v_end_time := NOW();
    RETURN QUERY SELECT 
      'company_relevance_scores_mv'::TEXT,
      v_start_time,
      v_end_time,
      TRUE,
      NULL::TEXT;
  EXCEPTION WHEN OTHERS THEN
    v_end_time := NOW();
    v_error := SQLERRM;
    RETURN QUERY SELECT 
      'company_relevance_scores_mv'::TEXT,
      v_start_time,
      v_end_time,
      FALSE,
      v_error;
  END;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Grant Permissions
-- ============================================================================
-- Allow authenticated users to read the materialized views
GRANT SELECT ON company_sentiment_scores_mv TO authenticated;
GRANT SELECT ON company_relevance_scores_mv TO authenticated;

-- Allow service role to refresh
GRANT EXECUTE ON FUNCTION refresh_company_metrics() TO service_role;

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON MATERIALIZED VIEW company_sentiment_scores_mv IS 
  'Pre-calculated sentiment scores per company per month based on AI themes. Refresh via refresh_company_metrics() function.';

COMMENT ON MATERIALIZED VIEW company_relevance_scores_mv IS 
  'Pre-calculated relevance scores per company per month based on citation recency. Refresh via refresh_company_metrics() function.';

COMMENT ON FUNCTION refresh_company_metrics() IS 
  'Refreshes both company sentiment and relevance materialized views concurrently. Returns status for each view refresh.';

-- ============================================================================
-- Initial Data Population
-- ============================================================================
-- Populate the views with existing data
REFRESH MATERIALIZED VIEW company_sentiment_scores_mv;
REFRESH MATERIALIZED VIEW company_relevance_scores_mv;
