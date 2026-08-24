-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260416070624; this file was
-- back-filled afterwards and therefore post-dates the deployment.


UPDATE company_canonical_names SET canonical_name = '21vianet', updated_at = now() WHERE lower(canonical_name) = '21vianet blue cloud';

