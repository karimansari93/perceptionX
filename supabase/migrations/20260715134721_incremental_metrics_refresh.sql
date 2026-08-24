-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260715134721; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- See repo migration 20260715150000_incremental_metrics_refresh.sql
-- Incremental (dirty-company) metrics refresh: replaces all-companies rollup
-- rebuilds with a per-company dirty queue drained a few companies per tick.

CREATE TABLE IF NOT EXISTS public.company_metrics_dirty (
  company_id uuid PRIMARY KEY,
  dirtied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_metrics_dirty ENABLE ROW LEVEL SECURITY;

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
  c_batch      constant int := 5;
  v_cooldown   constant interval := interval '60 minutes';
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

INSERT INTO public.company_metrics_dirty (company_id)
SELECT DISTINCT company_id FROM public.prompt_responses
WHERE company_id IS NOT NULL
  AND (created_at > '2026-07-14T00:00:00Z' OR updated_at > '2026-07-14T00:00:00Z')
ON CONFLICT (company_id) DO NOTHING;

INSERT INTO public.company_metrics_dirty (company_id)
SELECT DISTINCT company_id FROM public.ai_themes
WHERE company_id IS NOT NULL AND created_at > '2026-07-14T00:00:00Z'
ON CONFLICT (company_id) DO NOTHING;

COMMENT ON TABLE public.company_metrics_dirty IS
  'Queue of companies whose base data changed and whose 7 company-level rollup tables need a per-company refresh. Fed by triggers on prompt_responses/ai_themes (per-company) and entity_aliases/canonical_entities/url_recency_cache (all companies, debounced). Drained c_batch at a time by refresh_metrics_tick(); refresh_company_metrics(company_id) also dequeues.';
COMMENT ON FUNCTION public.refresh_metrics_tick() IS
  'Per-minute staleness tick. Drains up to 5 dirty companies per run via refresh_company_metrics(company_id) (incremental), converts admin force flags into an enqueue-all, and refreshes at most one stale by-location matview per run (watermark + 60-min cooldown).';
