-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260217135146; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Drop dependent view and MV
DROP VIEW IF EXISTS company_relevance_scores;
DROP MATERIALIZED VIEW IF EXISTS company_relevance_scores_mv;

-- Recreate MV with NO DATA (just the definition, no population)
CREATE MATERIALIZED VIEW company_relevance_scores_mv AS
WITH citation_urls AS (
    SELECT 
        pr.id AS response_id,
        pr.company_id,
        pr.tested_at,
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
    SELECT 
        cu.response_id,
        cu.company_id,
        cu.tested_at,
        cu.prompt_type,
        cu.prompt_category,
        cu.prompt_theme,
        cu.industry_context,
        cu.citation_url,
        cu.response_month,
        CASE
            WHEN cu.citation_url IS NOT NULL 
            THEN lower(replace(split_part(cu.citation_url, '/', 3), 'www.', ''))
            ELSE NULL
        END AS domain
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
        count(DISTINCT dn.citation_url) AS total_citations,
        count(DISTINCT urc.url) FILTER (WHERE urc.recency_score IS NOT NULL) AS valid_citations,
        avg(urc.recency_score) FILTER (WHERE urc.recency_score IS NOT NULL) AS avg_relevance_score
    FROM domain_normalized dn
    LEFT JOIN url_recency_cache urc ON dn.domain = urc.domain
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
    COALESCE(avg_relevance_score, 0::numeric) AS relevance_score,
    CASE
        WHEN total_citations > 0 
        THEN (valid_citations::numeric / total_citations::numeric) * 100::numeric
        ELSE 0::numeric
    END AS citation_coverage_percentage,
    now() AS calculated_at
FROM relevance_aggregated
WHERE total_citations > 0
WITH NO DATA;

-- Recreate indexes on MV
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

