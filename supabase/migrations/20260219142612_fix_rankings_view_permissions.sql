-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260219142612; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Fix missing SELECT permissions on rankings materialized views.
-- Both views exist but the anon role lost access, likely after a DROP+RECREATE
-- that didn't re-apply the GRANT statements.
GRANT SELECT ON public.rankings_overview TO anon, authenticated, service_role;
GRANT SELECT ON public.rankings_historical TO anon, authenticated, service_role;

