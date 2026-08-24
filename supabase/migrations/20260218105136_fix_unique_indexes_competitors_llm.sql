-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260218105136; this file was
-- back-filled afterwards and therefore post-dates the deployment.


DROP INDEX IF EXISTS company_competitors_mv_company_id_idx;
CREATE UNIQUE INDEX company_competitors_mv_unique_idx ON company_competitors_mv (company_id, competitor_name);

DROP INDEX IF EXISTS company_llm_rankings_mv_company_id_idx;
CREATE UNIQUE INDEX company_llm_rankings_mv_unique_idx ON company_llm_rankings_mv (company_id, ai_model);

