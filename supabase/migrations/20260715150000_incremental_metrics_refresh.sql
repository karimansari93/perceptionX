-- =============================================================================
-- Incremental (dirty-company) metrics refresh
-- =============================================================================
--
-- Why (2026-07-15 Disk IO incident, follow-up to 20260715130000)
-- --------------------------------------------------------------
-- The staleness tick refreshed the 7 company-level rollup tables by rebuilding
-- ALL ~219 companies whenever ANY company's data changed. pg_stat_statements
-- put refresh_metrics_tick() + refresh_company_metrics() at ~1.5 TB of shared
-- reads -- an order of magnitude above every other consumer -- and the account
-- repeatedly exhausted its Disk IO budget, throttling the disk until ordinary
-- dashboard reads blew the authenticated role's 8s statement_timeout (HTTP 500s).
--
-- Fix: track WHICH companies changed and refresh only those, a few per tick.
--
--   * company_metrics_dirty is a queue of changed company_ids, fed by
--     statement-level transition-table triggers on prompt_responses and
--     ai_themes (the two company-scoped base tables).
--   * Cross-company writers (entity canonicalization, recency rescoring)
--     can't be attributed to single companies, so they enqueue ALL companies
--     -- debounced to once per 10 minutes -- and the tick chunks through them
--     a small batch at a time instead of one monolithic rebuild.
--   * The tick drains up to METRICS_DIRTY_BATCH companies per run via the
--     existing per-company helpers (indexed, sub-second-to-seconds each).
--     A full all-companies pass becomes ~44 gentle minutes of small
--     transactions instead of one 2-minute-plus disk grind, and the steady
--     state (one company collected -> one company refreshed) costs megabytes,
--     not gigabytes.
--   * The 6 by-location rollups are still matviews (only refreshable in
--     full); they keep the watermark + REFRESH CONCURRENTLY path but their
--     cooldown rises from 15 to 60 minutes -- location-filtered dashboards
--     tolerate an hour of staleness, and each refresh is 30-100s of IO.
--   * The admin "Refresh metrics" force flag on a company-level table now
--     enqueues all companies (chunked) instead of triggering a monolith.
--
-- Contracts preserved: mv_refresh_state keeps one row per rollup (Data Health
-- tab), refresh_company_metrics(uuid) keeps its signature (and now also clears
-- the company's queue entry), request_company_metrics_refresh() still works.
--
-- Deploy note: does NOT touch cron job scheduling/active state. The
-- refresh-metrics-tick job was deliberately paused during the incident and is
-- re-enabled manually once the Disk IO budget recovers.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The dirty-company queue.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_metrics_dirty (
  company_id uuid PRIMARY KEY,
  dirtied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_metrics_dirty ENABLE ROW LEVEL SECURITY;
-- No policies: only SECURITY DEFINER functions below read/write it.

-- -----------------------------------------------------------------------------
-- 2. Enqueue helpers.
-- -----------------------------------------------------------------------------

-- Enqueue every company. Used by cross-company writers and the force-refresh
-- path. ON CONFLICT DO NOTHING keeps the original dirtied_at so drain order
-- stays oldest-first and repeat writers can't starve anyone.
CREATE OR REPLACE FUNCTION public.queue_all_companies_metrics_dirty()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  INSERT INTO public.company_metrics_dirty (company_id)
  SELECT id FROM public.companies
  ON CONFLICT (company_id) DO NOTHING;
$$;

-- Statement-level trigger for company-scoped base tables (prompt_responses,
-- ai_themes). Transition tables make bulk writes cheap: one DISTINCT scan per
-- statement instead of one queue upsert per row.
CREATE OR REPLACE FUNCTION public.trg_mark_company_metrics_dirty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    INSERT INTO public.company_metrics_dirty (company_id)
    SELECT DISTINCT company_id FROM new_rows WHERE company_id IS NOT NULL
    ON CONFLICT (company_id) DO NOTHING;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    INSERT INTO public.company_metrics_dirty (company_id)
    SELECT DISTINCT company_id FROM old_rows WHERE company_id IS NOT NULL
    ON CONFLICT (company_id) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;

-- Statement-level trigger for cross-company writers. Debounced to one
-- enqueue-all per 10 minutes (tracked on the watermark singleton) so a
-- recency-rescore campaign writing url_recency_cache row-by-row for hours
-- doesn't run the 219-row upsert on every statement.
ALTER TABLE public.mv_refresh_watermark
  ADD COLUMN IF NOT EXISTS all_dirty_marked_at timestamptz;

CREATE OR REPLACE FUNCTION public.trg_mark_all_companies_metrics_dirty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.mv_refresh_watermark
     SET all_dirty_marked_at = now()
   WHERE id
     AND (all_dirty_marked_at IS NULL
          OR all_dirty_marked_at < now() - interval '10 minutes');
  IF FOUND THEN
    PERFORM public.queue_all_companies_metrics_dirty();
  END IF;
  RETURN NULL;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Wire up the triggers.
--    prompt_responses / ai_themes: per-op statement triggers (transition
--    tables require one trigger per operation).
--    entity_aliases / canonical_entities / url_recency_cache: cross-company.
--    (The existing mark_metrics_data_changed watermark triggers stay: the
--    by-location matview path still keys off the watermark.)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['prompt_responses', 'ai_themes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_dirty_ins ON public.%I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_dirty_upd ON public.%I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_dirty_del ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_dirty_ins AFTER INSERT ON public.%I
         REFERENCING NEW TABLE AS new_rows
         FOR EACH STATEMENT EXECUTE FUNCTION public.trg_mark_company_metrics_dirty()', t);
    EXECUTE format(
      'CREATE TRIGGER trg_dirty_upd AFTER UPDATE ON public.%I
         REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
         FOR EACH STATEMENT EXECUTE FUNCTION public.trg_mark_company_metrics_dirty()', t);
    EXECUTE format(
      'CREATE TRIGGER trg_dirty_del AFTER DELETE ON public.%I
         REFERENCING OLD TABLE AS old_rows
         FOR EACH STATEMENT EXECUTE FUNCTION public.trg_mark_company_metrics_dirty()', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['entity_aliases', 'canonical_entities', 'url_recency_cache'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_dirty_all_companies ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_dirty_all_companies AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH STATEMENT EXECUTE FUNCTION public.trg_mark_all_companies_metrics_dirty()', t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 4. refresh_company_metrics(uuid): same body as 20260706120000, plus it clears
--    the company's dirty-queue entry, so the post-collection fast path also
--    dequeues the work the collection's own writes just enqueued.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_company_metrics(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'p_company_id is required; use refresh_company_metrics() for a full rebuild';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('refresh_company_metrics:' || p_company_id::text, 0));
  PERFORM public._refresh_cm_sentiment_scores(p_company_id);
  PERFORM public._refresh_cm_relevance_scores(p_company_id);
  PERFORM public._refresh_cm_top_sources(p_company_id);
  PERFORM public._refresh_cm_competitors(p_company_id);
  PERFORM public._refresh_cm_llm_rankings(p_company_id);
  PERFORM public._refresh_cm_attribute_themes(p_company_id);
  PERFORM public._refresh_cm_response_sentiment(p_company_id);
  DELETE FROM public.company_metrics_dirty WHERE company_id = p_company_id;
END $fn$;

-- -----------------------------------------------------------------------------
-- 5. The tick, incremental edition.
--    Order of work per run (at most one phase does real work per tick):
--      a. Convert force flags on company-level tables into an enqueue-all.
--      b. Drain up to c_batch dirty companies via refresh_company_metrics.
--      c. Otherwise refresh the single most-stale by-location matview
--         (watermark + 60-min cooldown), as before.
--    Keeps: advisory-lock overlap guard, query_canceled-safe bookkeeping
--    (20260715130000), mv_refresh_state rows for the Data Health tab.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_metrics_tick()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c_company_tables constant text[] := ARRAY[
    'company_sentiment_scores_mv','company_relevance_scores_mv','company_top_sources_mv',
    'company_competitors_mv','company_llm_rankings_mv','company_attribute_themes_mv',
    'company_response_sentiment_mv'];
  c_batch      constant int := 5;          -- companies refreshed per tick
  v_cooldown   constant interval := interval '60 minutes';  -- by-location matviews
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
  -- Belt only -- cannot rescue the in-flight statement's armed timer; the cron
  -- command's own `SET statement_timeout TO 0;` prefix is what lifts the cap.
  SET LOCAL statement_timeout = 0;
  SET LOCAL lock_timeout = '30s';

  IF NOT pg_try_advisory_xact_lock(913372) THEN
    RETURN 'busy';
  END IF;

  -- (a) Admin force flags on company-level tables -> enqueue every company and
  -- let the drain chunk through them. (By-location force flags are honored in
  -- phase (c) as before.)
  IF EXISTS (SELECT 1 FROM public.mv_refresh_state
             WHERE force_refresh AND mv_name = ANY (c_company_tables)) THEN
    UPDATE public.mv_refresh_state SET force_refresh = false
     WHERE force_refresh AND mv_name = ANY (c_company_tables);
    PERFORM public.queue_all_companies_metrics_dirty();
    RETURN 'force-queued:all-companies';
  END IF;

  -- (b) Drain a batch of dirty companies.
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
        -- Dequeue anyway: a company whose refresh fails must not wedge the
        -- queue. The next data change re-enqueues it; the error is surfaced
        -- in mv_refresh_state.last_error below.
        DELETE FROM public.company_metrics_dirty WHERE company_id = v_id;
        v_errors := coalesce(v_errors || '; ', '') || v_id || ': ' || SQLERRM;
      END;
    END LOOP;

    SELECT count(*) INTO v_remaining FROM public.company_metrics_dirty;

    -- Data Health liveness: stamp the 7 company-level rows each drain.
    UPDATE public.mv_refresh_state
       SET last_refresh_started  = v_start,
           last_refresh_finished = clock_timestamp(),
           last_status = CASE WHEN v_errors IS NULL THEN 'success' ELSE 'error' END,
           last_error  = v_errors,
           last_duration_ms = round(extract(epoch FROM (clock_timestamp() - v_start)) * 1000)::int
     WHERE mv_name = ANY (c_company_tables);

    RETURN 'drained:' || v_done || ' queue:' || v_remaining
           || coalesce(' errors:' || v_errors, '');
  END IF;

  -- (c) By-location matviews: unchanged watermark logic, longer cooldown.
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
  -- query_canceled must be named: WHEN OTHERS excludes it, and an uncaught
  -- cancel rolls back this bookkeeping -> same-MV retry loop (the 07-14 outage).
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

GRANT EXECUTE ON FUNCTION public.refresh_metrics_tick() TO postgres, service_role;
REVOKE ALL ON FUNCTION public.queue_all_companies_metrics_dirty() FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 6. Seed: companies whose base data changed during the incident window (the
--    tick was failing/paused, so their rollups may be stale). Everything else
--    is current from the 13:0x catch-up drain.
-- -----------------------------------------------------------------------------
INSERT INTO public.company_metrics_dirty (company_id)
SELECT DISTINCT company_id FROM public.prompt_responses
WHERE company_id IS NOT NULL
  AND (created_at > '2026-07-14T00:00:00Z' OR updated_at > '2026-07-14T00:00:00Z')
ON CONFLICT (company_id) DO NOTHING;

INSERT INTO public.company_metrics_dirty (company_id)
SELECT DISTINCT company_id FROM public.ai_themes
WHERE company_id IS NOT NULL AND created_at > '2026-07-14T00:00:00Z'
ON CONFLICT (company_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 7. Comments
-- -----------------------------------------------------------------------------
COMMENT ON TABLE public.company_metrics_dirty IS
  'Queue of companies whose base data changed and whose 7 company-level rollup tables need a per-company refresh. Fed by triggers on prompt_responses/ai_themes (per-company) and entity_aliases/canonical_entities/url_recency_cache (all companies, debounced). Drained c_batch at a time by refresh_metrics_tick(); refresh_company_metrics(company_id) also dequeues.';
COMMENT ON FUNCTION public.refresh_metrics_tick() IS
  'Per-minute staleness tick. Drains up to 5 dirty companies per run via refresh_company_metrics(company_id) (incremental; replaces the all-companies rebuilds that exhausted the Disk IO budget on 2026-07-14/15), converts admin force flags into an enqueue-all, and refreshes at most one stale by-location matview per run (watermark + 60-min cooldown).';
