-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260218070235; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- ============================================================
-- FIX 3: Drop duplicate index on confirmed_prompts
-- ============================================================
DROP INDEX IF EXISTS idx_unique_discovery_prompts_not_null_force;

