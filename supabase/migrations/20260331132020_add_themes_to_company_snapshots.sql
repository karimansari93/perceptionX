-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260331132020; this file was
-- back-filled afterwards and therefore post-dates the deployment.

ALTER TABLE company_snapshots ADD COLUMN IF NOT EXISTS themes jsonb DEFAULT '[]'::jsonb;
