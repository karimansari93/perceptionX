-- The nightly refresh runs in one transaction, so each rankings view stays
-- locked to readers from its refresh until the whole pipeline ends.
-- Refreshing the job-function rankings first keeps the public industry
-- rankings locked no longer than before they were added
-- (20261019120000_index_country_status_swap.sql).

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
    'rankings_job_function',
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
