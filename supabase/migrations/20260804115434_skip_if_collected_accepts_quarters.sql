-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260804115434; this file was
-- back-filled afterwards and therefore post-dates the deployment.

COMMENT ON COLUMN public.company_batch_configs.skip_if_collected_in_month IS
'Optional "YYYY-MM" month or "YYYY-Qn" calendar quarter. When set, process-company-batch-queue passes this to collect-company-responses so prompts only re-run if they lack a response within that period (covered once per period).';
