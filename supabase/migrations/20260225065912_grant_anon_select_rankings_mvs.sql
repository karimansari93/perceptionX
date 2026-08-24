-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260225065912; this file was
-- back-filled afterwards and therefore post-dates the deployment.


GRANT SELECT ON public.rankings_overview TO anon;
GRANT SELECT ON public.rankings_historical TO anon;

