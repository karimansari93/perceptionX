-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260218070224; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- ============================================================
-- FIX 2: Recreate company_relevance_scores as SECURITY INVOKER
-- ============================================================

DROP VIEW IF EXISTS company_relevance_scores;

CREATE VIEW company_relevance_scores 
WITH (security_invoker = true) AS
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
    AND cm.user_id = (SELECT auth.uid())
);

