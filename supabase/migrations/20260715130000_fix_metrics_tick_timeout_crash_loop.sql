-- =============================================================================
-- Fix: metrics-tick crash loop (statement_timeout) + confirmed_prompts RLS cost
-- =============================================================================
--
-- Outage 2026-07-14 -> 2026-07-15: dashboards returned PostgREST 500s on
-- confirmed_prompts / prompt_responses_canonical / company_response_sentiment_mv.
--
-- Root cause chain
-- ----------------
-- refresh_metrics_tick()'s full rebuild of company_response_sentiment_mv grew
-- to ~117s and started crossing pg_cron's 2-minute statement_timeout whenever
-- the box had any other load. Two assumptions in 20260628000001/20260706120000
-- turned out false:
--
--   1. `SET LOCAL statement_timeout = 0` inside the function body does NOT
--      lift the cap for the statement already in flight. The timer is armed
--      when `SELECT refresh_metrics_tick()` begins; changing the GUC
--      mid-statement never rearms it. It only appeared to work while every
--      refresh finished under 2 minutes.
--   2. `EXCEPTION WHEN OTHERS` does not catch QUERY_CANCELED (PL/pgSQL exempts
--      it from OTHERS), so the timeout aborted the WHOLE transaction --
--      including the mv_refresh_state bookkeeping. The tick re-picked the same
--      rollup on the next minute, forever: a permanent crash loop burning two
--      minutes of full-load Disk IO per minute. That starvation pushed
--      ordinary dashboard reads (already paying ~10k heap pages of RLS
--      subquery per confirmed_prompts SELECT, see fix C) past the
--      authenticated role's 8s statement_timeout -> 500s -> app down.
--
-- Fixes
-- -----
--   A. Schedule the cron job as `SET statement_timeout TO 0; SELECT ...`.
--      Since PG13, each statement of a multi-statement job string arms its own
--      timeout, so the SET genuinely applies to the tick call. The tick keeps
--      its own advisory-lock overlap guard, so an over-long refresh causes
--      later ticks to return 'busy' rather than pile up.
--   B. Catch QUERY_CANCELED explicitly in the tick, so any future cancel
--      (manual or timeout) still commits last_status='error' and
--      last_refresh_finished -- the 15-minute cooldown then prevents
--      hot-looping on a rollup that cannot finish.
--   C. Partial covering index for the confirmed_prompts SELECT policy's
--      `id IN (SELECT confirmed_prompt_id FROM prompt_responses WHERE
--      for_index = true)` subquery. The existing idx_prompt_responses_for_index
--      indexes only (for_index), so the subquery had to visit ~10k heap pages
--      on every confirmed_prompts query by every user; this index serves it
--      index-only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Disarm the 2-minute cap where it is actually armed: in the cron command,
--    before the tick statement starts.
-- -----------------------------------------------------------------------------
SELECT cron.alter_job(
  jobid,
  command => 'SET statement_timeout TO 0; SELECT public.refresh_metrics_tick();'
)
FROM cron.job
WHERE jobname = 'refresh-metrics-tick';

-- -----------------------------------------------------------------------------
-- B. Same tick as 20260706120000, with QUERY_CANCELED added to the handler so
--    a cancellation records an error + finish time instead of rolling back the
--    bookkeeping and retrying the same rollup every minute.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_metrics_tick()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_mv         text;
  v_watermark  timestamptz;
  v_start      timestamptz;
  v_rows       bigint;
  v_cooldown   interval := interval '15 minutes';
BEGIN
  -- Best effort only: this cannot rescue the *current* statement's armed
  -- timer (see header); the real cap removal is the SET in the cron command.
  SET LOCAL statement_timeout = 0;
  SET LOCAL lock_timeout = '30s';

  IF NOT pg_try_advisory_xact_lock(913372) THEN
    RETURN 'busy';
  END IF;

  SELECT data_changed_at INTO v_watermark FROM public.mv_refresh_watermark WHERE id;

  SELECT mv_name INTO v_mv
  FROM public.mv_refresh_state
  WHERE force_refresh
     OR last_refresh_finished IS NULL
     OR ( (v_watermark IS NOT NULL AND last_refresh_finished < v_watermark)
          AND last_refresh_finished < now() - v_cooldown )
  ORDER BY force_refresh DESC, last_refresh_finished ASC NULLS FIRST
  LIMIT 1;

  IF v_mv IS NULL THEN
    RETURN 'idle';
  END IF;

  v_start := clock_timestamp();
  UPDATE public.mv_refresh_state
     SET last_refresh_started = v_start, last_status = 'running'
   WHERE mv_name = v_mv;

  BEGIN
    -- Tables (the 7 company-level rollups) rebuild via their incremental
    -- helper; matviews (the 6 by-location rollups) via REFRESH CONCURRENTLY.
    PERFORM public._refresh_cm_dispatch(v_mv);
    EXECUTE format('SELECT count(*) FROM %I', v_mv) INTO v_rows;
    UPDATE public.mv_refresh_state
       SET last_refresh_finished = clock_timestamp(),
           last_status = 'success',
           last_error = NULL,
           last_duration_ms = round(extract(epoch FROM (clock_timestamp() - v_start)) * 1000)::int,
           row_count = v_rows,
           force_refresh = false
     WHERE mv_name = v_mv;
    RETURN 'refreshed:' || v_mv;
  -- QUERY_CANCELED must be named: WHEN OTHERS deliberately excludes it, and a
  -- statement_timeout cancel that escapes here rolls back the bookkeeping
  -- above -> the tick re-picks the same rollup every minute (the 07-14 loop).
  EXCEPTION WHEN query_canceled OR OTHERS THEN
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
$$;

-- -----------------------------------------------------------------------------
-- C. Covering index for the confirmed_prompts RLS subquery. IF NOT EXISTS:
--    on the live project this was created CONCURRENTLY during the incident.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_prompt_responses_for_index_prompt
  ON public.prompt_responses (confirmed_prompt_id)
  WHERE for_index = true;
