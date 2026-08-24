-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260628111410; this file was
-- back-filled afterwards and therefore post-dates the deployment.

CREATE OR REPLACE FUNCTION public.refresh_metrics_tick()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_mv text; v_watermark timestamptz; v_start timestamptz; v_rows bigint;
  v_cooldown interval := interval '15 minutes';
BEGIN
  SET LOCAL statement_timeout = 0;
  SET LOCAL lock_timeout = '30s';
  IF NOT pg_try_advisory_xact_lock(913372) THEN RETURN 'busy'; END IF;
  SELECT data_changed_at INTO v_watermark FROM public.mv_refresh_watermark WHERE id;
  SELECT mv_name INTO v_mv FROM public.mv_refresh_state
  WHERE force_refresh
     OR last_refresh_finished IS NULL
     OR ( (v_watermark IS NOT NULL AND last_refresh_finished < v_watermark) AND last_refresh_finished < now() - v_cooldown )
  ORDER BY force_refresh DESC, last_refresh_finished ASC NULLS FIRST LIMIT 1;
  IF v_mv IS NULL THEN RETURN 'idle'; END IF;
  v_start := clock_timestamp();
  UPDATE public.mv_refresh_state SET last_refresh_started = v_start, last_status = 'running' WHERE mv_name = v_mv;
  BEGIN
    EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I', v_mv);
    EXECUTE format('SELECT count(*) FROM %I', v_mv) INTO v_rows;
    UPDATE public.mv_refresh_state SET last_refresh_finished = clock_timestamp(), last_status='success', last_error=NULL,
      last_duration_ms = round(extract(epoch FROM (clock_timestamp()-v_start))*1000)::int, row_count=v_rows, force_refresh=false
     WHERE mv_name = v_mv;
    RETURN 'refreshed:'||v_mv;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.mv_refresh_state SET last_refresh_finished = clock_timestamp(), last_status='error', last_error=SQLERRM,
      last_duration_ms = round(extract(epoch FROM (clock_timestamp()-v_start))*1000)::int, force_refresh=false
     WHERE mv_name = v_mv;
    RETURN 'error:'||v_mv||':'||SQLERRM;
  END;
END;
$$;
