-- Dismantle the background load treadmill (verified 2026-08-11):
-- zero-row INSERTs from the entity-suggestion drain fired the statement-level
-- all-dirty triggers (no transition-table guard), marking all 220 companies
-- metrics-dirty every 10-minute debounce window. The drain rate (5
-- companies/min → 44 min for a full queue) could never outrun that refill, so
-- the 7 rollup tables rebuilt 24/7 (~12.2M rows churned), the by-location
-- views starved for a week, and user queries timed out behind the churn.
--
-- Collection and analysis are QUARTERLY. The steady state this migration
-- creates: triggers only fire on statements that touched rows, an all-dirty
-- sweep debounces at 60 min (> full drain time), by-location views can never
-- starve behind the queue, and the always-on analysis crons are paused or
-- gated on an actual collection cycle being active.

-- 1) Transition-table-guarded all-dirty trigger ------------------------------

CREATE OR REPLACE FUNCTION public.trg_mark_all_companies_metrics_dirty_guarded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Statement triggers fire even for statements that touch zero rows; the
  -- transition table is the only reliable signal that anything changed.
  IF NOT EXISTS (SELECT 1 FROM changed_rows) THEN
    RETURN NULL;
  END IF;
  -- Debounce ≥ full-queue drain time (220 companies / 5 per min ≈ 44 min);
  -- the previous 10-minute debounce guaranteed a permanent treadmill.
  UPDATE public.mv_refresh_watermark
     SET all_dirty_marked_at = now()
   WHERE id
     AND (all_dirty_marked_at IS NULL
          OR all_dirty_marked_at < now() - interval '60 minutes');
  IF FOUND THEN
    PERFORM public.queue_all_companies_metrics_dirty();
  END IF;
  RETURN NULL;
END;
$function$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['entity_aliases', 'canonical_entities', 'url_recency_cache'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_dirty_all_companies ON public.%I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_dirty_all_ins ON public.%I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_dirty_all_upd ON public.%I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_dirty_all_del ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_dirty_all_ins AFTER INSERT ON public.%I
         REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT
         EXECUTE FUNCTION public.trg_mark_all_companies_metrics_dirty_guarded()', t);
    EXECUTE format(
      'CREATE TRIGGER trg_dirty_all_upd AFTER UPDATE ON public.%I
         REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT
         EXECUTE FUNCTION public.trg_mark_all_companies_metrics_dirty_guarded()', t);
    EXECUTE format(
      'CREATE TRIGGER trg_dirty_all_del AFTER DELETE ON public.%I
         REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT
         EXECUTE FUNCTION public.trg_mark_all_companies_metrics_dirty_guarded()', t);
  END LOOP;
END $$;

-- 2) Anti-starvation for by-location rollups in refresh_metrics_tick --------
-- The old flow only refreshed by-location matviews when the company queue was
-- EMPTY — which, under the treadmill, was never. A view stale beyond 6 hours
-- (or force-flagged) now takes priority over the per-company drain.

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
  c_starvation constant interval := interval '6 hours';
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

      RETURN 'drained:' || v_done || ' queue:' || v_remaining
             || coalesce(' errors:' || v_errors, '');
    END IF;

    -- Queue empty: fall through to the watermark-driven by-location refresh.
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
$function$;

-- 3) Theme poster: pg_net's default 5 s timeout killed every invocation at
-- the DNS stage (verified: every call since Aug 4 died at exactly 5,000 ms).
-- Give the on-demand path room; the cron itself is paused below.

CREATE OR REPLACE FUNCTION public.theme_backfill_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_project_url TEXT;
    v_service_key TEXT;
BEGIN
    SELECT decrypted_secret INTO v_project_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url';
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

    IF v_project_url IS NULL OR v_service_key IS NULL THEN
        RAISE NOTICE 'theme_backfill_tick: missing vault secrets, skipping';
        RETURN jsonb_build_object('kicked', false, 'reason', 'missing_vault_secret');
    END IF;

    PERFORM net.http_post(
        url := v_project_url || '/functions/v1/theme-backfill-tick',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || v_service_key,
            'Content-Type',  'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
    );

    RETURN jsonb_build_object('kicked', true);
END;
$function$;

-- 4) Gate the always-on ticks on an actual collection cycle ------------------

CREATE OR REPLACE FUNCTION public.collection_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM company_batch_queue WHERE status NOT IN ('completed','failed'))
      OR EXISTS (SELECT 1 FROM visibility_queue   WHERE status NOT IN ('completed','failed'))
      OR EXISTS (SELECT 1 FROM claude_batch_jobs  WHERE status NOT IN ('completed','failed'));
$$;

REVOKE ALL ON FUNCTION public.collection_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collection_active() TO authenticated, service_role;

-- `SELECT fn() WHERE cond` skips the function call entirely when cond is
-- false — each gated tick costs three EXISTS probes while idle.
DO $$
BEGIN
  PERFORM cron.alter_job(5,  command := 'SELECT public.batch_queue_completion_tick() WHERE public.collection_active();');
  PERFORM cron.alter_job(6,  command := 'SELECT public.batch_queue_watchdog_tick() WHERE public.collection_active();');
  PERFORM cron.alter_job(7,  command := 'SELECT public.visibility_queue_watchdog_tick() WHERE public.collection_active();');
  PERFORM cron.alter_job(8,  command := 'SELECT public.visibility_queue_completion_tick() WHERE public.collection_active();');
  PERFORM cron.alter_job(9,  command := 'SELECT public.recency_rescore_tick() WHERE EXISTS (SELECT 1 FROM public.recency_rescore_job_urls);');
  PERFORM cron.alter_job(25, command := 'SELECT public.claude_batch_tick() WHERE public.collection_active();');
  -- Quarterly cadence: the always-on analysis crons pause outright. Theme
  -- backfill and the entity-suggestion drain run on demand as part of the
  -- post-collection analysis pass (their functions remain callable).
  PERFORM cron.alter_job(28, active := false);
  PERFORM cron.alter_job(35, active := false);
END $$;
