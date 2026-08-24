-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260225064415; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Drop and recreate all 6 views without SECURITY DEFINER

CREATE OR REPLACE VIEW public.company_llm_rankings
WITH (security_invoker = true)
AS
SELECT company_id,
    ai_model,
    total_responses,
    mentions,
    mention_pct
FROM company_llm_rankings_mv r
WHERE EXISTS (
    SELECT 1 FROM company_members cm
    WHERE cm.company_id = r.company_id
      AND cm.user_id = (SELECT auth.uid())
);

CREATE OR REPLACE VIEW public.company_relevance_scores
WITH (security_invoker = true)
AS
SELECT company_id,
    response_month,
    prompt_type,
    prompt_category,
    prompt_theme,
    industry_context,
    total_citations,
    valid_citations,
    relevance_score,
    citation_coverage_percentage,
    calculated_at
FROM company_relevance_scores_mv mv
WHERE EXISTS (
    SELECT 1 FROM company_members cm
    WHERE cm.company_id = mv.company_id
      AND cm.user_id = (SELECT auth.uid())
);

CREATE OR REPLACE VIEW public.company_overview_metrics
WITH (security_invoker = true)
AS
SELECT company_id,
    total_responses,
    mentioned_count,
    visibility_pct,
    last_tested_at,
    total_citations,
    unique_domains,
    sentiment_pct,
    positive_themes,
    negative_themes,
    refreshed_at
FROM company_overview_metrics_mv m
WHERE EXISTS (
    SELECT 1 FROM company_members cm
    WHERE cm.company_id = m.company_id
      AND cm.user_id = (SELECT auth.uid())
);

CREATE OR REPLACE VIEW public.company_top_sources
WITH (security_invoker = true)
AS
SELECT company_id,
    domain,
    sample_url,
    citation_count,
    pct_of_total
FROM company_top_sources_mv s
WHERE EXISTS (
    SELECT 1 FROM company_members cm
    WHERE cm.company_id = s.company_id
      AND cm.user_id = (SELECT auth.uid())
);

CREATE OR REPLACE VIEW public.company_sentiment_scores
WITH (security_invoker = true)
AS
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
    sentiment_ratio,
    avg_sentiment_score,
    calculated_at
FROM company_sentiment_scores_mv s
WHERE EXISTS (
    SELECT 1 FROM company_members cm
    WHERE cm.company_id = s.company_id
      AND cm.user_id = (SELECT auth.uid())
);

CREATE OR REPLACE VIEW public.company_competitors
WITH (security_invoker = true)
AS
SELECT company_id,
    competitor_name,
    mention_count
FROM company_competitors_mv c
WHERE EXISTS (
    SELECT 1 FROM company_members cm
    WHERE cm.company_id = c.company_id
      AND cm.user_id = (SELECT auth.uid())
);

