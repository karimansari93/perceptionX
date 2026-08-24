-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260218104639; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Fix: Use ai_themes.sentiment text label instead of numeric sentiment_score threshold
-- This aligns dashboard classification with the report methodology

DROP MATERIALIZED VIEW IF EXISTS company_sentiment_scores_mv;

CREATE MATERIALIZED VIEW company_sentiment_scores_mv AS
WITH sentiment_responses AS (
  SELECT pr.id,
    pr.company_id,
    pr.tested_at,
    cp.prompt_type,
    cp.prompt_category,
    cp.prompt_theme,
    COALESCE(cp.industry_context, c.industry) AS industry_context,
    date_trunc('month', pr.tested_at) AS response_month
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  JOIN companies c ON pr.company_id = c.id
  WHERE cp.prompt_type = ANY (ARRAY[
    'experience', 'competitive', 'discovery', 'informational',
    'talentx_experience', 'talentx_competitive', 'talentx_discovery', 'talentx_informational'
  ])
  AND pr.company_id IS NOT NULL
),
ai_themes_aggregated AS (
  SELECT sr.company_id,
    sr.response_month,
    sr.prompt_type,
    sr.prompt_category,
    sr.prompt_theme,
    sr.industry_context,
    count(DISTINCT at.id) AS total_themes,
    count(DISTINCT at.id) FILTER (WHERE at.sentiment = 'positive') AS positive_themes,
    count(DISTINCT at.id) FILTER (WHERE at.sentiment = 'negative') AS negative_themes,
    count(DISTINCT at.id) FILTER (WHERE at.sentiment = 'neutral') AS neutral_themes,
    avg(at.sentiment_score) AS avg_sentiment_score
  FROM sentiment_responses sr
  LEFT JOIN ai_themes at ON sr.id = at.response_id
  GROUP BY sr.company_id, sr.response_month, sr.prompt_type, sr.prompt_category, sr.prompt_theme, sr.industry_context
)
SELECT company_id,
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
    WHEN total_themes > 0 THEN positive_themes::numeric / total_themes::numeric
    ELSE 0::numeric
  END AS sentiment_ratio,
  COALESCE(avg_sentiment_score, 0::double precision) AS avg_sentiment_score,
  now() AS calculated_at
FROM ai_themes_aggregated
WHERE total_themes > 0;

-- Recreate indexes
CREATE UNIQUE INDEX idx_company_sentiment_scores_mv_unique 
  ON company_sentiment_scores_mv (company_id, response_month, prompt_type, prompt_category, prompt_theme, industry_context);

CREATE INDEX idx_sentiment_mv_company_month 
  ON company_sentiment_scores_mv (company_id, response_month DESC);

CREATE INDEX idx_sentiment_mv_company_type 
  ON company_sentiment_scores_mv (company_id, prompt_type, response_month DESC);

CREATE INDEX idx_sentiment_mv_industry 
  ON company_sentiment_scores_mv (industry_context, response_month DESC);

