-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260225081032; this file was
-- back-filled afterwards and therefore post-dates the deployment.

GRANT SELECT ON company_relevance_scores_mv TO authenticated;
GRANT SELECT ON company_sentiment_scores_mv TO authenticated;
