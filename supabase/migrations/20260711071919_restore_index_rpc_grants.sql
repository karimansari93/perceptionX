-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260711071919; this file was
-- back-filled afterwards and therefore post-dates the deployment.


GRANT EXECUTE ON FUNCTION public.search_companies(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_periods(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_subsidiaries(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_trend(text, text, text, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_rankings_with_change(text, text, text) TO anon, authenticated;

