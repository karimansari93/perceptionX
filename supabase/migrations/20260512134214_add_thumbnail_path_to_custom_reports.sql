-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260512134214; this file was
-- back-filled afterwards and therefore post-dates the deployment.

ALTER TABLE public.custom_reports
  ADD COLUMN IF NOT EXISTS thumbnail_path text;
