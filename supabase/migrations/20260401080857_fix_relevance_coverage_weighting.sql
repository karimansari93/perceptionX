-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260401080857; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Clean up bad data
DELETE FROM url_recency_cache WHERE extraction_method = 'bulk-heuristic';

-- Update extraction_method constraint to add diffbot-article
ALTER TABLE url_recency_cache DROP CONSTRAINT IF EXISTS valid_extraction_method;
ALTER TABLE url_recency_cache ADD CONSTRAINT valid_extraction_method CHECK (
  extraction_method = ANY (ARRAY[
    'url-pattern',
    'firecrawl-metadata',
    'firecrawl-relative',
    'firecrawl-absolute',
    'firecrawl-reddit',
    'firecrawl-json',
    'firecrawl-html',
    'not-found',
    'rate-limit-hit',
    'timeout',
    'problematic-domain',
    'cache-hit',
    'snippet-extraction',
    'diffbot-article'
  ])
);

-- Recreate relevance MV with coverage-weighted score
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
  CASE
    WHEN total_citations > 0 AND valid_citations > 0 THEN
      ROUND(
        (COALESCE(avg_relevance_score, 0) * (valid_citations::NUMERIC / total_citations))
        + (50.0 * (1.0 - valid_citations::NUMERIC / total_citations))
      , 2)
    ELSE 0
  END as relevance_score,
  CASE
    WHEN total_citations > 0
    THEN (valid_citations::NUMERIC / total_citations) * 100
    ELSE 0
  END as citation_coverage_percentage,
  NOW() as calculated_at
FROM relevance_aggregated
WHERE total_citations > 0;

CREATE INDEX idx_relevance_mv_company_month
  ON company_relevance_scores_mv(company_id, response_month DESC);
CREATE INDEX idx_relevance_mv_industry
  ON company_relevance_scores_mv(industry_context, response_month DESC);
CREATE INDEX idx_relevance_mv_company_type
  ON company_relevance_scores_mv(company_id, prompt_type, response_month DESC);
CREATE UNIQUE INDEX idx_company_relevance_scores_mv_unique
  ON company_relevance_scores_mv (company_id, response_month, prompt_type, prompt_category, prompt_theme, industry_context);

GRANT SELECT ON company_relevance_scores_mv TO authenticated;

CREATE OR REPLACE VIEW company_relevance_scores AS
SELECT mv.*
FROM company_relevance_scores_mv mv
WHERE EXISTS (
  SELECT 1 FROM company_members cm
  WHERE cm.company_id = mv.company_id
    AND cm.user_id = auth.uid()
);
GRANT SELECT ON company_relevance_scores TO authenticated;

REFRESH MATERIALIZED VIEW company_relevance_scores_mv;

