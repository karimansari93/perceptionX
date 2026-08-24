-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260217135345; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Drop and recreate with the optimized query
DROP VIEW IF EXISTS company_relevance_scores;
DROP MATERIALIZED VIEW IF EXISTS company_relevance_scores_mv;

CREATE MATERIALIZED VIEW company_relevance_scores_mv AS
WITH domain_scores AS (
    -- Pre-aggregate url_recency_cache to ONE row per domain (eliminates many-to-many explosion)
    SELECT domain, avg(recency_score) AS avg_recency_score, count(*) AS url_count
    FROM url_recency_cache
    WHERE recency_score IS NOT NULL AND domain IS NOT NULL
    GROUP BY domain
),
citation_urls AS (
    SELECT 
        pr.company_id,
        cp.prompt_type,
        cp.prompt_category,
        cp.prompt_theme,
        COALESCE(cp.industry_context, c.industry) AS industry_context,
        (jsonb_array_elements(pr.citations) ->> 'url') AS citation_url,
        date_trunc('month', pr.tested_at) AS response_month
    FROM prompt_responses pr
    JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
    JOIN companies c ON pr.company_id = c.id
    WHERE pr.citations IS NOT NULL 
      AND jsonb_array_length(pr.citations) > 0 
      AND pr.company_id IS NOT NULL
),
domain_normalized AS (
    SELECT *,
        lower(replace(split_part(citation_url, '/', 3), 'www.', '')) AS domain
    FROM citation_urls
    WHERE citation_url IS NOT NULL
)
SELECT 
    dn.company_id,
    dn.response_month,
    dn.prompt_type,
    dn.prompt_category,
    dn.prompt_theme,
    dn.industry_context,
    count(DISTINCT dn.citation_url) AS total_citations,
    count(DISTINCT dn.citation_url) FILTER (WHERE ds.avg_recency_score IS NOT NULL) AS valid_citations,
    COALESCE(avg(ds.avg_recency_score), 0::numeric) AS relevance_score,
    CASE
        WHEN count(DISTINCT dn.citation_url) > 0 
        THEN (count(DISTINCT dn.citation_url) FILTER (WHERE ds.avg_recency_score IS NOT NULL)::numeric 
              / count(DISTINCT dn.citation_url)::numeric) * 100::numeric
        ELSE 0::numeric
    END AS citation_coverage_percentage,
    now() AS calculated_at
FROM domain_normalized dn
LEFT JOIN domain_scores ds ON dn.domain = ds.domain
GROUP BY dn.company_id, dn.response_month, dn.prompt_type, dn.prompt_category, dn.prompt_theme, dn.industry_context
HAVING count(DISTINCT dn.citation_url) > 0;

-- Recreate indexes
CREATE UNIQUE INDEX idx_company_relevance_scores_mv_unique 
ON company_relevance_scores_mv (company_id, response_month, prompt_type, prompt_category, prompt_theme, industry_context);

CREATE INDEX idx_relevance_mv_company_month 
ON company_relevance_scores_mv (company_id, response_month DESC);

CREATE INDEX idx_relevance_mv_industry 
ON company_relevance_scores_mv (industry_context, response_month DESC);

-- Recreate the RLS wrapper view
CREATE VIEW company_relevance_scores AS
SELECT 
    mv.company_id,
    mv.response_month,
    mv.prompt_type,
    mv.prompt_category,
    mv.prompt_theme,
    mv.industry_context,
    mv.total_citations,
    mv.valid_citations,
    mv.relevance_score,
    mv.citation_coverage_percentage,
    mv.calculated_at
FROM company_relevance_scores_mv mv
WHERE EXISTS (
    SELECT 1 FROM company_members cm 
    WHERE cm.company_id = mv.company_id 
    AND cm.user_id = auth.uid()
);

