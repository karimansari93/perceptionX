-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260519104623; this file was
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
  v_concurrent boolean;
  v_steps  text[][] := ARRAY[
    ARRAY['mv_industry_stats',    'true'],
    ARRAY['mv_company_mentions',  'false'],
    ARRAY['rankings_overview',    'true'],
    ARRAY['company_search_index', 'true']
  ];
  v_step text[];
BEGIN
  FOREACH v_step SLICE 1 IN ARRAY v_steps LOOP
    v_obj        := v_step[1];
    v_concurrent := v_step[2]::boolean;
    BEGIN
      IF v_concurrent THEN
        EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY public.%I', v_obj);
      ELSE
        EXECUTE format('REFRESH MATERIALIZED VIEW public.%I', v_obj);
      END IF;
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

CREATE OR REPLACE FUNCTION public.trigger_snapshot_regen()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url text;
  v_key text;
  v_req bigint;
BEGIN
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url';
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'trigger_snapshot_regen skipped: vault secrets missing';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url                  := v_url || '/functions/v1/generate-company-snapshots',
    body                 := '{}'::jsonb,
    headers              := jsonb_build_object(
                              'Content-Type', 'application/json',
                              'Authorization', 'Bearer ' || v_key),
    timeout_milliseconds := 120000
  ) INTO v_req;

  INSERT INTO public.pipeline_freshness (object, refreshed_at, row_count, detail)
  VALUES ('company_snapshots', now(), NULL,
          'snapshot regen requested (net request ' || v_req || ')')
  ON CONFLICT (object) DO UPDATE
    SET refreshed_at = excluded.refreshed_at,
        detail       = excluded.detail;

  RETURN v_req;
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_rankings_maintenance()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '600000'
AS $function$
BEGIN
  BEGIN
    PERFORM public.reconcile_stale_exclusions();
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.pipeline_freshness (object, refreshed_at, row_count, detail)
    VALUES ('reconcile_stale_exclusions', now(), NULL,
            'FAILED: ' || left(SQLERRM, 300))
    ON CONFLICT (object) DO UPDATE
      SET refreshed_at = excluded.refreshed_at, detail = excluded.detail;
  END;

  BEGIN
    PERFORM public.refresh_rankings_pipeline();
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.pipeline_freshness (object, refreshed_at, row_count, detail)
    VALUES ('refresh_rankings_pipeline', now(), NULL,
            'FAILED: ' || left(SQLERRM, 300))
    ON CONFLICT (object) DO UPDATE
      SET refreshed_at = excluded.refreshed_at, detail = excluded.detail;
  END;

  PERFORM public.trigger_snapshot_regen();
END;
$function$;

