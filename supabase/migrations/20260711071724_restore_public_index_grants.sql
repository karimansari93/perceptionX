-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260711071724; this file was
-- back-filled afterwards and therefore post-dates the deployment.


GRANT SELECT ON public.rankings_overview, public.rankings_historical, public.company_search_index TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.rankings_overview, public.rankings_historical, public.company_search_index FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_industries() TO anon, authenticated;

