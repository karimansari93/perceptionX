-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260817154147; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Pin search_path on the stamp trigger function (house convention; advisors
-- flag mutable search_path on SECURITY DEFINER/trigger functions).
CREATE OR REPLACE FUNCTION public.stamp_themes_found()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
begin
  update public.prompt_responses p
     set themes_found_at = now()
   where p.themes_found_at is null
     and p.id in (select distinct response_id from new_rows where response_id is not null);
  return null;
end $function$;
