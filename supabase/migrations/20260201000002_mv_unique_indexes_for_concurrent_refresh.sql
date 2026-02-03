-- ============================================================================
-- Unique indexes for REFRESH MATERIALIZED VIEW CONCURRENTLY
-- ============================================================================
-- PostgreSQL requires a UNIQUE index with no WHERE clause on a materialized
-- view to allow REFRESH MATERIALIZED VIEW CONCURRENTLY. Without it you get:
--   ERROR: 55000: cannot refresh materialized view "..." concurrently
--   HINT: Create a unique index with no WHERE clause on one or more columns
--
-- Each MV row is uniquely identified by (company_id, response_month, prompt_type,
-- prompt_category, prompt_theme, industry_context) from the underlying GROUP BY.

-- Sentiment MV: unique index (no WHERE clause)
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_sentiment_scores_mv_unique
  ON company_sentiment_scores_mv (company_id, response_month, prompt_type, prompt_category, prompt_theme, industry_context);

-- Relevance MV: unique index (no WHERE clause)
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_relevance_scores_mv_unique
  ON company_relevance_scores_mv (company_id, response_month, prompt_type, prompt_category, prompt_theme, industry_context);
