-- ============================================================================
-- Staleness-driven materialized-view refresh tick
-- ============================================================================
--
-- Problem this fixes (the recurring "null sentiment/relevance/themes when a
-- location filter is active" bug):
--
--   refresh_company_metrics() refreshes all 13 rollup MVs as ONE statement.
--   pg_cron / edge callers impose a ~120s statement timeout, and the 6
--   by-location MVs sit LAST in the array. As data grew the run started dying
--   around MV #7 (company_response_sentiment_mv), so positions 8-13 (every
--   by-location MV) were never reached. Any company/location collected after
--   the last lucky full refresh then showed null when filtered by location.
--
-- Fix: a tick that refreshes only the single most-stale MV per run.
--   * One MV per run -> always well under the timeout, and SET LOCAL
--     statement_timeout = 0 removes the cap entirely as a safety net.
--   * "Stale" = base data changed since the MV's last successful refresh,
--     tracked by a cheap debounced watermark (no per-tick max() seq scan,
--     which measured at ~8.5s here).
--   * No-op when nothing changed -> respects the Disk IO budget that got the
--     fixed-schedule crons disabled in 20260602000001.
--   * By-location MVs are first-class: ordered by oldest refresh, never starved.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Data-change watermark (single row). Bumped by statement-level triggers on
--    the base tables, debounced to ~30s so high-volume writers don't contend
--    on the row. The tick reads this instead of scanning base tables.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mv_refresh_watermark (
  id boolean PRIMARY KEY DEFAULT true,
  data_changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mv_refresh_watermark_singleton CHECK (id)
);
INSERT INTO public.mv_refresh_watermark (id, data_changed_at)
VALUES (true, now()) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.mv_refresh_watermark ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.mark_metrics_data_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Debounced: only the first writer in each ~30s window actually updates the
  -- row, so concurrent base-table writes don't serialize on this single row.
  UPDATE public.mv_refresh_watermark
     SET data_changed_at = now()
   WHERE id AND data_changed_at < now() - interval '30 seconds';
  RETURN NULL;  -- AFTER STATEMENT trigger
END;
$$;

DO $$
BEGIN
  -- prompt_responses: new/updated responses feed every rollup.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mark_metrics_prompt_responses') THEN
    CREATE TRIGGER trg_mark_metrics_prompt_responses
      AFTER INSERT OR UPDATE OR DELETE ON public.prompt_responses
      FOR EACH STATEMENT EXECUTE FUNCTION public.mark_metrics_data_changed();
  END IF;
  -- ai_themes: theme backfill / analysis feeds sentiment + attribute MVs.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mark_metrics_ai_themes') THEN
    CREATE TRIGGER trg_mark_metrics_ai_themes
      AFTER INSERT OR UPDATE OR DELETE ON public.ai_themes
      FOR EACH STATEMENT EXECUTE FUNCTION public.mark_metrics_data_changed();
  END IF;
  -- url_recency_cache: recency rescore feeds the relevance MV.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mark_metrics_url_recency_cache') THEN
    CREATE TRIGGER trg_mark_metrics_url_recency_cache
      AFTER INSERT OR UPDATE OR DELETE ON public.url_recency_cache
      FOR EACH STATEMENT EXECUTE FUNCTION public.mark_metrics_data_changed();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Per-MV refresh state. One row per rollup MV: last refresh, status, timing,
--    and a force flag the admin "Refresh metrics" button sets. Also the data
--    source for the admin Data Health view's staleness banner.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mv_refresh_state (
  mv_name               text PRIMARY KEY,
  last_refresh_started  timestamptz,
  last_refresh_finished timestamptz,
  last_status           text,           -- 'success' | 'error' | 'running'
  last_error            text,
  last_duration_ms      integer,
  row_count             bigint,
  force_refresh         boolean NOT NULL DEFAULT false
);

ALTER TABLE public.mv_refresh_state ENABLE ROW LEVEL SECURITY;

-- Seed the canonical 13 rollup MVs with NULL last_refresh so the tick performs
-- one clean refresh of each after deploy (one per minute, ~13 min, gentle).
INSERT INTO public.mv_refresh_state (mv_name)
VALUES
  ('company_sentiment_scores_mv'),
  ('company_relevance_scores_mv'),
  ('company_top_sources_mv'),
  ('company_competitors_mv'),
  ('company_llm_rankings_mv'),
  ('company_attribute_themes_mv'),
  ('company_response_sentiment_mv'),
  ('company_sentiment_scores_by_location_mv'),
  ('company_relevance_scores_by_location_mv'),
  ('company_attribute_themes_by_location_mv'),
  ('company_top_sources_by_location_mv'),
  ('company_competitors_by_location_mv'),
  ('company_llm_rankings_by_location_mv')
ON CONFLICT (mv_name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. The tick: refresh the single most-stale MV, then return.
-- ---------------------------------------------------------------------------
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
  -- Minimum gap between successive refreshes of the SAME MV. Bounds Disk IO
  -- during a long collection burst (when the watermark is continuously fresh)
  -- to ~once per window per MV, so the tick can't become the runaway Disk IO
  -- consumer that got the fixed-schedule crons disabled (20260602000001).
  -- A single MV refresh here measured ~40s, so 15 min keeps the duty cycle low.
  -- When idle (no data change) the tick does nothing regardless.
  v_cooldown   interval := interval '15 minutes';
BEGIN
  -- One MV refresh can exceed the cron 120s statement cap on a big account;
  -- disable the cap for this call (we only ever do ONE refresh per tick).
  SET LOCAL statement_timeout = 0;
  SET LOCAL lock_timeout = '30s';

  -- Overlap guard: if a previous tick is still mid-refresh, skip this one.
  -- Transaction-scoped, so it releases automatically when the tick ends.
  IF NOT pg_try_advisory_xact_lock(913372) THEN
    RETURN 'busy';
  END IF;

  SELECT data_changed_at INTO v_watermark FROM public.mv_refresh_watermark WHERE id;

  -- Pick the most-stale MV to refresh. Eligible when:
  --   * force-flagged (admin "Refresh metrics" -> refresh ASAP), OR
  --   * never refreshed (initial post-deploy drain), OR
  --   * base data changed since its last refresh AND it's past the cooldown.
  -- Oldest first so nothing is starved.
  SELECT mv_name INTO v_mv
  FROM public.mv_refresh_state
  WHERE force_refresh
     OR last_refresh_finished IS NULL
     OR ( (v_watermark IS NOT NULL AND last_refresh_finished < v_watermark)
          AND last_refresh_finished < now() - v_cooldown )
  ORDER BY force_refresh DESC, last_refresh_finished ASC NULLS FIRST
  LIMIT 1;

  IF v_mv IS NULL THEN
    RETURN 'idle';  -- everything current; cheap no-op
  END IF;

  v_start := clock_timestamp();
  UPDATE public.mv_refresh_state
     SET last_refresh_started = v_start, last_status = 'running'
   WHERE mv_name = v_mv;

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
    RETURN 'refreshed:' || v_mv;
  EXCEPTION WHEN OTHERS THEN
    -- Record the failure (no longer swallowed silently) and clear the force
    -- flag so a single bad MV can't wedge the tick on a permanent retry loop.
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

GRANT EXECUTE ON FUNCTION public.refresh_metrics_tick() TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 4. Schedule the tick every minute. Cheap no-op when nothing is stale.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule('refresh-metrics-tick');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('refresh-metrics-tick', '* * * * *', 'SELECT public.refresh_metrics_tick();');

-- ---------------------------------------------------------------------------
-- 5. Harden the admin "Refresh metrics" trigger.
--    Old behaviour scheduled a one-off pg_cron job that ran the full 13-MV
--    refresh and only self-unscheduled AFTER success -- so on the timeout it
--    retried every minute forever. New behaviour just force-flags every MV and
--    lets the tick drain them one at a time. Also clears any stuck one-off job.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_company_metrics_refresh()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can trigger a company-metrics refresh';
  END IF;

  -- Clear any legacy stuck one-off job from the old implementation.
  BEGIN
    PERFORM cron.unschedule('oneoff_company_metrics_refresh');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  UPDATE public.mv_refresh_state SET force_refresh = true;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Nudge the watermark so even MVs not force-flagged elsewhere are reconsidered.
  UPDATE public.mv_refresh_watermark SET data_changed_at = now() WHERE id;

  RETURN jsonb_build_object('status', 'scheduled', 'mvs', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_company_metrics_refresh() TO authenticated, service_role;
