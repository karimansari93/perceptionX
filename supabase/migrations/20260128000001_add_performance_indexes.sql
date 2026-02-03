-- ============================================================================
-- Add Performance Indexes for Common Query Patterns
-- ============================================================================
-- This migration adds composite B-tree indexes on frequently filtered columns
-- to improve query performance from hundreds of milliseconds to under 10ms.
--
-- Based on learnings from performance optimization analysis:
-- - industry_context, prompt_theme, and ai_model columns are frequently filtered
-- - Composite indexes are needed for multi-column WHERE clauses
-- - These indexes will significantly speed up dashboard queries

-- ============================================================================
-- Indexes on confirmed_prompts table
-- ============================================================================

-- Composite index for filtering by industry_context and prompt_theme
-- Used in: dashboard filters, thematic analysis, visibility rankings
CREATE INDEX IF NOT EXISTS idx_confirmed_prompts_industry_theme 
  ON confirmed_prompts(industry_context, prompt_theme)
  WHERE industry_context IS NOT NULL AND prompt_theme IS NOT NULL;

-- Composite index for common filter combinations
-- Used in: filtering prompts by industry, type, and category
CREATE INDEX IF NOT EXISTS idx_confirmed_prompts_industry_type_category 
  ON confirmed_prompts(industry_context, prompt_type, prompt_category)
  WHERE industry_context IS NOT NULL;

-- Index on prompt_theme alone (for theme-based queries)
CREATE INDEX IF NOT EXISTS idx_confirmed_prompts_prompt_theme 
  ON confirmed_prompts(prompt_theme)
  WHERE prompt_theme IS NOT NULL;

-- Index on industry_context alone (for industry-based queries)
CREATE INDEX IF NOT EXISTS idx_confirmed_prompts_industry_context 
  ON confirmed_prompts(industry_context)
  WHERE industry_context IS NOT NULL;

-- ============================================================================
-- Indexes on prompt_responses table
-- ============================================================================

-- Index on ai_model for filtering by AI model
-- Used in: filtering responses by model (GPT-4, Perplexity, etc.)
CREATE INDEX IF NOT EXISTS idx_prompt_responses_ai_model 
  ON prompt_responses(ai_model);

-- Composite index for company + tested_at queries (verify if exists, add if not)
-- Used in: dashboard queries, trend analysis
CREATE INDEX IF NOT EXISTS idx_prompt_responses_company_tested 
  ON prompt_responses(company_id, tested_at DESC)
  WHERE company_id IS NOT NULL;

-- Composite index for prompt + model lookups (verify if exists)
-- Used in: finding specific prompt response by prompt and model
CREATE INDEX IF NOT EXISTS idx_prompt_responses_prompt_model 
  ON prompt_responses(confirmed_prompt_id, ai_model);

-- Composite index for filtering by company and AI model
-- Used in: model-specific company analysis
CREATE INDEX IF NOT EXISTS idx_prompt_responses_company_model 
  ON prompt_responses(company_id, ai_model)
  WHERE company_id IS NOT NULL;

-- ============================================================================
-- Indexes on ai_themes table
-- ============================================================================

-- Composite index for company + sentiment queries
-- Used in: sentiment analysis, filtering themes by company
CREATE INDEX IF NOT EXISTS idx_ai_themes_company_sentiment 
  ON ai_themes(company_id, sentiment_score)
  WHERE company_id IS NOT NULL;

-- Index on response_id for joining with prompt_responses
-- Used in: joining themes with responses
CREATE INDEX IF NOT EXISTS idx_ai_themes_response_id 
  ON ai_themes(response_id)
  WHERE response_id IS NOT NULL;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON INDEX idx_confirmed_prompts_industry_theme IS 
  'Composite index for filtering prompts by industry and theme. Speeds up dashboard filters and thematic analysis.';

COMMENT ON INDEX idx_confirmed_prompts_industry_type_category IS 
  'Composite index for common filter combinations: industry + type + category. Used in prompt filtering queries.';

COMMENT ON INDEX idx_prompt_responses_ai_model IS 
  'Index for filtering responses by AI model. Speeds up model-specific queries.';

COMMENT ON INDEX idx_prompt_responses_company_tested IS 
  'Composite index for company queries ordered by date. Speeds up dashboard and trend analysis queries.';

COMMENT ON INDEX idx_ai_themes_company_sentiment IS 
  'Composite index for company sentiment queries. Speeds up sentiment analysis and filtering.';

-- ============================================================================
-- Verify Index Creation
-- ============================================================================

-- Query to verify indexes were created (for manual verification)
-- SELECT 
--   schemaname,
--   tablename,
--   indexname,
--   indexdef
-- FROM pg_indexes
-- WHERE tablename IN ('confirmed_prompts', 'prompt_responses', 'ai_themes')
--   AND indexname LIKE 'idx_%'
-- ORDER BY tablename, indexname;
