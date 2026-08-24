-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260516110529; this file was
-- back-filled afterwards and therefore post-dates the deployment.

CREATE TABLE IF NOT EXISTS public.pipeline_freshness (
  object       text PRIMARY KEY,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  row_count    bigint,
  detail       text
);

ALTER TABLE public.pipeline_freshness ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pipeline_freshness_read ON public.pipeline_freshness;
CREATE POLICY pipeline_freshness_read ON public.pipeline_freshness
  FOR SELECT USING (true);

GRANT SELECT ON public.pipeline_freshness TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refresh_rankings_pipeline()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
    EXECUTE format('REFRESH MATERIALIZED VIEW public.%I', v_obj);
    EXECUTE format('SELECT count(*) FROM public.%I', v_obj) INTO v_count;
    INSERT INTO public.pipeline_freshness (object, refreshed_at, row_count, detail)
    VALUES (v_obj, now(), v_count, 'refresh_rankings_pipeline')
    ON CONFLICT (object) DO UPDATE
      SET refreshed_at = excluded.refreshed_at,
          row_count    = excluded.row_count,
          detail       = excluded.detail;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_stale_exclusions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  WITH stale AS (
    SELECT co.id
    FROM company_overrides co
    JOIN company_employee_tiers cet
      ON lower(cet.company_name) = lower(co.canonical_name)
    WHERE co.status = 'excluded'
      AND co.notes ILIKE '%no employee tier data%'
      AND cet.estimated_tier IS NOT NULL
      AND cet.estimated_tier <> ALL (ARRAY['<50','50-499','500-4999','unknown'])
  )
  DELETE FROM company_overrides co
  USING stale
  WHERE co.id = stale.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public.pipeline_freshness (object, refreshed_at, row_count, detail)
  VALUES ('reconcile_stale_exclusions', now(), v_deleted,
          'deleted stale no-tier-data exclusions')
  ON CONFLICT (object) DO UPDATE
    SET refreshed_at = excluded.refreshed_at,
        row_count    = excluded.row_count,
        detail       = excluded.detail;

  RETURN v_deleted;
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
    url     := v_url || '/functions/v1/generate-company-snapshots',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := '{}'::jsonb
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
AS $function$
BEGIN
  PERFORM public.reconcile_stale_exclusions();
  PERFORM public.refresh_rankings_pipeline();
  PERFORM public.trigger_snapshot_regen();
END;
$function$;

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('refresh-rankings-every-hour');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

SELECT cron.schedule(
  'rankings-refresh-hourly',
  '5 * * * *',
  $$SELECT public.refresh_rankings_pipeline();$$
);

SELECT cron.schedule(
  'rankings-maintenance-daily',
  '0 4 * * *',
  $$SELECT public.run_rankings_maintenance();$$
);
