-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260312130240; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Add indexes to rankings_overview materialized view for PostgREST performance
CREATE INDEX IF NOT EXISTS idx_rankings_overview_country 
  ON rankings_overview (country);

CREATE INDEX IF NOT EXISTS idx_rankings_overview_canonical_name 
  ON rankings_overview (canonical_name);

CREATE INDEX IF NOT EXISTS idx_rankings_overview_canonical_country 
  ON rankings_overview (canonical_name, country);

CREATE INDEX IF NOT EXISTS idx_rankings_overview_industry 
  ON rankings_overview (industry_context);

-- Reload PostgREST schema cache after index creation
NOTIFY pgrst, 'reload schema';

