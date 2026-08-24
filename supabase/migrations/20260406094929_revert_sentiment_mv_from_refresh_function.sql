-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260406094929; this file was
-- back-filled afterwards and therefore post-dates the deployment.


CREATE OR REPLACE FUNCTION public.refresh_rankings_views()
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW public.mv_industry_stats;
  REFRESH MATERIALIZED VIEW public.mv_company_mentions;
END;
$function$

