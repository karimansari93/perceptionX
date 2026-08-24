-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260720083237; this file was
-- back-filled afterwards and therefore post-dates the deployment.

alter table public.profiles drop column if exists is_admin;
