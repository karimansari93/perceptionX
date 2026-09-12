-- Off-peak by-location refreshes + tick logging (reliability audit P1-3).
--
-- The minute tick refreshed one by-location matview CONCURRENTLY whenever the
-- data watermark moved and the 60-minute cooldown had passed — at any hour.
-- Measured on 2026-09-11: company_relevance_scores_by_location_mv 98 s,
-- company_attribute_themes_by_location_mv 33 s, each evicting the dashboard's
-- working set from a 256 MB buffer cache while users were loading. The
-- 13:00–14:00 UTC failure clusters in the API log coincide with this.
--
-- Change (everything else byte-identical to 20260811140000):
--   * watermark-driven by-location refreshes run only 21:00–06:00 UTC;
--   * force_refresh and the starvation guard (now 26 h, so a missed window
--     costs at most one extra day) still refresh at any hour;
--   * the per-company drain (5 companies/min, ~2.7 s per batch) is unchanged;
--   * RAISE LOG / RAISE WARNING lines so refreshes can be correlated with
--     API-side timeouts in the Postgres log.
--
-- Trade-off: location-filtered dashboard views can lag the company-wide
-- numbers by up to a day during a collection wave. Company-wide metrics
-- (per-company tables) stay minute-fresh. Revert by re-applying the
-- refresh_metrics_tick definition from 20260811140000.

CREATE OR REPLACE FUNCTION public.refresh_metrics_tick()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c_company_tables constant text[] := ARRAY[
    'company_sentiment_scores_mv','company_relevance_scores_mv','company_top_sources_mv',
    'company_competitors_mv','company_llm_rankings_mv','company_attribute_themes_mv',
    'company_response_sentiment_mv'];
  c_batch      constant int := 5;
  v_cooldown   constant interval := interval '60 minutes';
  -- By-location matviews refresh CONCURRENTLY (33–98 s each, measured
  -- 2026-09-11) only in the off-peak window below; the starvation guard
  -- (26 h) caps how stale they can get if a window is missed.
  c_starvation constant interval := interval '26 hours';
  c_offpeak_start_hour constant int := 21;  -- UTC, inclusive
  c_offpeak_end_hour   constant int := 6;   -- UTC, exclusive
  v_hour       int := extract(hour FROM (now() AT TIME ZONE 'UTC'))::int;
  v_offpeak    boolean;
  v_ids        uuid[];
  v_id         uuid;
  v_done       int := 0;
  v_errors     text := NULL;
  v_remaining  bigint;
  v_mv         text;
  v_watermark  timestamptz;
  v_start      timestamptz;
  v_rows       bigint;
BEGIN
  SET LOCAL statement_timeout = 0;
  SET LOCAL lock_timeout = '30s';
  v_offpeak := (v_hour >= c_offpeak_start_hour OR v_hour < c_offpeak_end_hour);

  IF NOT pg_try_advisory_xact_lock(913372) THEN
    RETURN 'busy';
  END IF;

  IF EXISTS (SELECT 1 FROM public.mv_refresh_state
             WHERE force_refresh AND mv_name = ANY (c_company_tables)) THEN
    UPDATE public.mv_refresh_state SET force_refresh = false
     WHERE force_refresh AND mv_name = ANY (c_company_tables);
    PERFORM public.queue_all_companies_metrics_dirty();
    RETURN 'force-queued:all-companies';
  END IF;

  -- ANTI-STARVATION: a by-location view stale beyond the threshold (or
  -- force-flagged) refreshes ahead of the company drain.
  SELECT mv_name INTO v_mv
  FROM public.mv_refresh_state
  WHERE mv_name LIKE '%\_by\_location\_mv' ESCAPE '\'
    AND ( force_refresh
       OR last_refresh_finished IS NULL
       OR last_refresh_finished < now() - c_starvation )
  ORDER BY force_refresh DESC, last_refresh_finished ASC NULLS FIRST
  LIMIT 1;

  IF v_mv IS NULL THEN
    v_start := clock_timestamp();
    v_ids := ARRAY(
      SELECT company_id FROM public.company_metrics_dirty
      ORDER BY dirtied_at
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED);

    IF array_length(v_ids, 1) > 0 THEN
      FOREACH v_id IN ARRAY v_ids LOOP
        BEGIN
          PERFORM public.refresh_company_metrics(v_id);
          v_done := v_done + 1;
        EXCEPTION WHEN query_canceled OR OTHERS THEN
          DELETE FROM public.company_metrics_dirty WHERE company_id = v_id;
          v_errors := coalesce(v_errors || '; ', '') || v_id || ': ' || SQLERRM;
        END;
      END LOOP;

      SELECT count(*) INTO v_remaining FROM public.company_metrics_dirty;

      UPDATE public.mv_refresh_state
         SET last_refresh_started  = v_start,
             last_refresh_finished = clock_timestamp(),
             last_status = CASE WHEN v_errors IS NULL THEN 'success' ELSE 'error' END,
             last_error  = v_errors,
             last_duration_ms = round(extract(epoch FROM (clock_timestamp() - v_start)) * 1000)::int
       WHERE mv_name = ANY (c_company_tables);

      RAISE LOG 'refresh_metrics_tick: drained % companies in % ms (queue %)%',
        v_done, round(extract(epoch FROM (clock_timestamp() - v_start)) * 1000)::int, v_remaining,
        coalesce(' errors: ' || v_errors, '');
      RETURN 'drained:' || v_done || ' queue:' || v_remaining
             || coalesce(' errors:' || v_errors, '');
    END IF;

    -- Queue empty: the watermark-driven by-location refresh runs only in the
    -- off-peak window. During business hours a 98 s CONCURRENTLY refresh of
    -- company_relevance_scores_by_location_mv competed with the dashboard's
    -- own queries for a 1 GB instance (reliability audit P1-3). Force-flagged
    -- or starving views (above) still refresh at any hour.
    IF NOT v_offpeak THEN
      RETURN 'idle:peak-hours';
    END IF;

    SELECT data_changed_at INTO v_watermark FROM public.mv_refresh_watermark WHERE id;

    SELECT mv_name INTO v_mv
    FROM public.mv_refresh_state
    WHERE mv_name LIKE '%\_by\_location\_mv' ESCAPE '\'
      AND ( force_refresh
         OR last_refresh_finished IS NULL
         OR ( (v_watermark IS NOT NULL AND last_refresh_finished < v_watermark)
              AND last_refresh_finished < now() - v_cooldown ) )
    ORDER BY force_refresh DESC, last_refresh_finished ASC NULLS FIRST
    LIMIT 1;

    IF v_mv IS NULL THEN
      RETURN 'idle';
    END IF;
  END IF;

  v_start := clock_timestamp();
  UPDATE public.mv_refresh_state
     SET last_refresh_started = v_start, last_status = 'running'
   WHERE mv_name = v_mv;
  RAISE LOG 'refresh_metrics_tick: refreshing % (off-peak: %)', v_mv, v_offpeak;

  BEGIN
    EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I', v_mv);
    EXECUTE format('SELECT count(*) FROM %I', v_mv) INTO v_rows;
    UPDATE public.mv_refresh_state
       SET last_refresh_finished = clock_timestamp(),
           last_status = 'success',
           last_error = NULL,
           last_duration_ms = round(extract(epoch FROM (clock_timestamp() - v_start)) * 1000)::int,
           row_count = v_rows,
           force_refresh = false
     WHERE mv_name = v_mv;
    RAISE LOG 'refresh_metrics_tick: refreshed % in % ms (% rows)',
      v_mv, round(extract(epoch FROM (clock_timestamp() - v_start)) * 1000)::int, v_rows;
    RETURN 'refreshed:' || v_mv;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    RAISE WARNING 'refresh_metrics_tick: % failed after % ms: %',
      v_mv, round(extract(epoch FROM (clock_timestamp() - v_start)) * 1000)::int, SQLERRM;
    UPDATE public.mv_refresh_state
       SET last_refresh_finished = clock_timestamp(),
           last_status = 'error',
           last_error = SQLERRM,
           last_duration_ms = round(extract(epoch FROM (clock_timestamp() - v_start)) * 1000)::int,
           force_refresh = false
     WHERE mv_name = v_mv;
    RETURN 'error:' || v_mv || ':' || SQLERRM;
  END;
END;
$function$;
