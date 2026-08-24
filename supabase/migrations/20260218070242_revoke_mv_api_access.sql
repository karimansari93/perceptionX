-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260218070242; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- ============================================================
-- FIX 4: Revoke direct API access to materialized views
-- Users should access data through RLS-protected wrapper views
-- ============================================================

REVOKE SELECT ON company_sentiment_scores_mv FROM anon, authenticated;
REVOKE SELECT ON rankings_overview FROM anon, authenticated;
REVOKE SELECT ON mv_industry_stats FROM anon, authenticated;
REVOKE SELECT ON company_relevance_scores_mv FROM anon, authenticated;
REVOKE SELECT ON prompt_responses_with_prompts FROM anon, authenticated;
REVOKE SELECT ON rankings_historical FROM anon, authenticated;
REVOKE SELECT ON mv_company_mentions FROM anon, authenticated;

