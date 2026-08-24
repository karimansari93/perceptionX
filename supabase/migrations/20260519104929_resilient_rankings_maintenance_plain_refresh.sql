-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260519104929; this file was
-- back-filled afterwards and therefore post-dates the deployment.


CREATE OR REPLACE FUNCTION public.refresh_rankings_pipeline()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '600000'
AS $function$
DECLARE
  v_count bigint;
  v_obj   text;
  v_order text[] := ARRAY[
    'mv_industry_stats',
    'mv_company_mentions',
    'rankings_overview',
    'company_search_index'
  ];
BEGIN
  FOREACH v_obj IN ARRAY v_order LOOP
    BEGIN
      EXECUTE format('REFRESH MATERIALIZED VIEW public.%I', v_obj);
      EXECUTE format('SELECT count(*) FROM public.%I', v_obj) INTO v_count;
      INSERT INTO public.pipeline_freshness (object, refreshed_at, row_count, detail)
      VALUES (v_obj, now(), v_count, 'refresh_rankings_pipeline')
      ON CONFLICT (object) DO UPDATE
        SET refreshed_at = excluded.refreshed_at,
            row_count    = excluded.row_count,
            detail       = excluded.detail;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.pipeline_freshness (object, refreshed_at, row_count, detail)
      VALUES (v_obj, now(), NULL,
              'refresh FAILED: ' || left(SQLERRM, 300))
      ON CONFLICT (object) DO UPDATE
        SET refreshed_at = excluded.refreshed_at,
            detail       = excluded.detail;
    END;
  END LOOP;
END;
$function$;

