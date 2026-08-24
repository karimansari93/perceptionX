-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260218104702; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Add company_mentioned = true filter to relevance MV
-- Only score citations from responses where the company was actually mentioned

-- Drop dependent view first
DROP VIEW IF EXISTS company_relevance_scores;

DROP MATERIALIZED VIEW IF EXISTS company_relevance_scores_mv;

CREATE MATERIALIZED VIEW company_relevance_scores_mv AS
WITH citation_urls AS (
  SELECT 
    pr.company_id,
    cp.prompt_type,
    cp.prompt_category,
    cp.prompt_theme,
    COALESCE(cp.industry_context, c.industry) AS industry_context,
    jsonb_array_elements(pr.citations) ->> 'url' AS citation_url,
    date_trunc('month', pr.tested_at) AS response_month
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  JOIN companies c ON pr.company_id = c.id
  WHERE pr.citations IS NOT NULL 
    AND jsonb_array_length(pr.citations) > 0 
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
    COUNT(DISTINCT cu.citation_url) AS total_citations,
    COUNT(DISTINCT cu.citation_url) FILTER (WHERE urc.recency_score IS NOT NULL) AS valid_citations,
    AVG(urc.recency_score) FILTER (WHERE urc.recency_score IS NOT NULL) AS avg_relevance_score
  FROM citation_urls cu
  LEFT JOIN url_recency_cache urc ON cu.citation_url = urc.url
  WHERE cu.citation_url IS NOT NULL
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
  COALESCE(avg_relevance_score, 0) AS relevance_score,
  CASE 
    WHEN total_citations > 0 THEN (valid_citations::numeric / total_citations::numeric) * 100
    ELSE 0 
  END AS citation_coverage_percentage,
  NOW() AS calculated_at
FROM relevance_aggregated
WHERE total_citations > 0;

-- Recreate indexes
CREATE UNIQUE INDEX idx_company_relevance_scores_mv_unique 
  ON company_relevance_scores_mv (company_id, response_month, prompt_type, prompt_category, prompt_theme, industry_context);

CREATE INDEX idx_relevance_mv_company_month 
  ON company_relevance_scores_mv (company_id, response_month DESC);

CREATE INDEX idx_relevance_mv_industry 
  ON company_relevance_scores_mv (industry_context, response_month DESC);

-- Recreate RLS-safe view
CREATE VIEW company_relevance_scores AS
SELECT 
  company_id, response_month, prompt_type, prompt_category, prompt_theme,
  industry_context, total_citations, valid_citations, relevance_score,
  citation_coverage_percentage, calculated_at
FROM company_relevance_scores_mv mv
WHERE EXISTS (
  SELECT 1 FROM company_members cm 
  WHERE cm.company_id = mv.company_id 
    AND cm.user_id = (SELECT auth.uid())
);

COMMENT ON VIEW company_relevance_scores IS 
  'RLS-safe view over company_relevance_scores_mv; use this for dashboard queries.';

