-- Phase 3, slice 1: scope-stats rollups.
--
-- Four small pre-aggregated tables that replace the dashboard's raw-row
-- computations for the Overview scorecard, trends, period list, and
-- job-function metrics (audit 2026-08-25: consumers A1-A13, A16, B1-B8, C1,
-- D1, F4, G3, H1 in docs/DASHBOARD_DATA_ARCHITECTURE.md's phase-3 section).
-- Cardinality per company is months × job-functions × location-spellings —
-- tens to low hundreds of rows — so the whole cube ships with
-- get_dashboard_rollups and client-side filter toggles stay instant.
--
-- Semantics (deliberate, documented):
-- * response_month = COALESCE(pr.response_month, date_trunc('month', tested_at))
--   — the client's responsePeriodKey rule and the visibility MV's rule.
-- * job_function_context / location_context: btrim'd, '' = untagged; location
--   keeps RAW spellings — the client canonicalizes post-filter (same contract
--   as the by-location MVs).
-- * ai_model NOT IN ('claude','gemini','deepseek') everywhere (parity with the
--   stream RPC and every other rollup).
-- * "Overall candidate experience" prompts excluded everywhere (parity with
--   the visibility MV and the client's central isOverallCandidateExperience
--   filter).
-- * for_index rows are INCLUDED in scope/daily/prompt-type stats — the raw
--   response stream includes them and the client never filters them, so
--   excluding them here would shift the numbers users see today. The llm
--   stats EXCLUDE for_index for parity with company_llm_rankings_mv, whose
--   numbers the LLM card already shows.
-- * Theme counts come from company_response_sentiment_mv (response grain) —
--   the same source the stream's sentiment_* columns use.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.company_scope_stats_mv (
  company_id           uuid   NOT NULL,
  response_month       date   NOT NULL,
  job_function_context text   NOT NULL DEFAULT '',
  location_context     text   NOT NULL DEFAULT '',
  total_responses      bigint NOT NULL DEFAULT 0,
  mentioned_responses  bigint NOT NULL DEFAULT 0,
  total_citations      bigint NOT NULL DEFAULT 0,
  distinct_domains     bigint NOT NULL DEFAULT 0,
  distinct_models      bigint NOT NULL DEFAULT 0,
  positive_themes      bigint NOT NULL DEFAULT 0,
  negative_themes      bigint NOT NULL DEFAULT 0,
  neutral_themes       bigint NOT NULL DEFAULT 0,
  calculated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_scope_stats_company
  ON public.company_scope_stats_mv (company_id);

CREATE TABLE IF NOT EXISTS public.company_scope_daily_stats_mv (
  company_id             uuid   NOT NULL,
  tested_day             date   NOT NULL,
  job_function_context   text   NOT NULL DEFAULT '',
  location_context       text   NOT NULL DEFAULT '',
  total_responses        bigint NOT NULL DEFAULT 0,
  mentioned_responses    bigint NOT NULL DEFAULT 0,
  total_citations        bigint NOT NULL DEFAULT 0,
  distinct_prompt_models bigint NOT NULL DEFAULT 0,
  positive_themes        bigint NOT NULL DEFAULT 0,
  negative_themes        bigint NOT NULL DEFAULT 0,
  calculated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_scope_daily_stats_company
  ON public.company_scope_daily_stats_mv (company_id);

CREATE TABLE IF NOT EXISTS public.company_scope_prompt_type_stats_mv (
  company_id           uuid   NOT NULL,
  response_month       date   NOT NULL,
  job_function_context text   NOT NULL DEFAULT '',
  location_context     text   NOT NULL DEFAULT '',
  prompt_type          text   NOT NULL DEFAULT '',
  total_responses      bigint NOT NULL DEFAULT 0,
  mentioned_responses  bigint NOT NULL DEFAULT 0,
  calculated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_scope_pt_stats_company
  ON public.company_scope_prompt_type_stats_mv (company_id);

CREATE TABLE IF NOT EXISTS public.company_llm_stats_mv (
  company_id           uuid   NOT NULL,
  response_month       date   NOT NULL,
  job_function_context text   NOT NULL DEFAULT '',
  location_context     text   NOT NULL DEFAULT '',
  ai_model             text   NOT NULL,
  total_responses      bigint NOT NULL DEFAULT 0,
  mentions             bigint NOT NULL DEFAULT 0,
  calculated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_llm_stats_company
  ON public.company_llm_stats_mv (company_id);

ALTER TABLE public.company_scope_stats_mv             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_scope_daily_stats_mv       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_scope_prompt_type_stats_mv ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_llm_stats_mv               ENABLE ROW LEVEL SECURITY;
-- No policies: reads go through the SECURITY DEFINER rollup RPC (with its
-- explicit accessible_company_ids guard), never through PostgREST directly.

-- ---------------------------------------------------------------------------
-- Per-company refreshers (DELETE + INSERT under an advisory lock — the same
-- pattern as every _refresh_cm_* function).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._refresh_cm_scope_stats(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_scope_stats_mv', 0));
  DELETE FROM public.company_scope_stats_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_scope_stats_mv
    (company_id, response_month, job_function_context, location_context,
     total_responses, mentioned_responses, total_citations, distinct_domains,
     distinct_models, positive_themes, negative_themes, neutral_themes, calculated_at)
  WITH rows AS (
    SELECT pr.id, pr.company_id,
           COALESCE(pr.response_month, date_trunc('month', pr.tested_at)::date) AS response_month,
           COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') AS job_function_context,
           COALESCE(NULLIF(btrim(cp.location_context), ''), '')     AS location_context,
           pr.company_mentioned, pr.ai_model,
           pr.confirmed_prompt_id,
           COALESCE(pr.canonical_citations, pr.citations) AS cites,
           crs.positive_themes, crs.negative_themes,
           (crs.total_themes - COALESCE(crs.positive_themes,0) - COALESCE(crs.negative_themes,0)) AS neutral_themes
    FROM prompt_responses pr
    JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
    LEFT JOIN company_response_sentiment_mv crs
      ON crs.company_id = pr.company_id AND crs.response_id = pr.id
    WHERE pr.company_id IS NOT NULL AND pr.tested_at IS NOT NULL
      AND pr.ai_model NOT IN ('claude','gemini','deepseek')
      AND lower(COALESCE(btrim(cp.attribute_id), '')) <> 'overall-candidate-experience'
      AND lower(COALESCE(btrim(cp.prompt_theme), '')) <> 'overall candidate experience'
      AND (p_company_id IS NULL OR pr.company_id = p_company_id)
  ),
  cite_stats AS (
    SELECT r.id, count(*) AS citation_count
    FROM rows r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.cites) = 'array' THEN r.cites ELSE '[]'::jsonb END) c(value)
    GROUP BY r.id
  ),
  -- distinct cited domains within each output key (one unnest pass, not a
  -- correlated re-scan per group)
  domain_stats AS (
    SELECT r.company_id, r.response_month, r.job_function_context, r.location_context,
           count(DISTINCT lower(regexp_replace(c.value->>'domain', '^www\.', ''))) AS distinct_domains
    FROM rows r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.cites) = 'array' THEN r.cites ELSE '[]'::jsonb END) c(value)
    WHERE COALESCE(c.value->>'domain','') <> ''
    GROUP BY 1, 2, 3, 4
  )
  SELECT r.company_id, r.response_month, r.job_function_context, r.location_context,
         count(*) AS total_responses,
         count(*) FILTER (WHERE r.company_mentioned = true) AS mentioned_responses,
         COALESCE(sum(cs.citation_count), 0) AS total_citations,
         COALESCE(max(ds.distinct_domains), 0) AS distinct_domains,
         count(DISTINCT r.ai_model) AS distinct_models,
         COALESCE(sum(r.positive_themes), 0) AS positive_themes,
         COALESCE(sum(r.negative_themes), 0) AS negative_themes,
         COALESCE(sum(GREATEST(r.neutral_themes, 0)), 0) AS neutral_themes,
         now() AS calculated_at
  FROM rows r
  LEFT JOIN cite_stats cs ON cs.id = r.id
  LEFT JOIN domain_stats ds
    ON ds.company_id = r.company_id AND ds.response_month = r.response_month
   AND ds.job_function_context = r.job_function_context AND ds.location_context = r.location_context
  GROUP BY r.company_id, r.response_month, r.job_function_context, r.location_context;
END $$;

CREATE OR REPLACE FUNCTION public._refresh_cm_scope_daily_stats(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_scope_daily_stats_mv', 0));
  DELETE FROM public.company_scope_daily_stats_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_scope_daily_stats_mv
    (company_id, tested_day, job_function_context, location_context,
     total_responses, mentioned_responses, total_citations, distinct_prompt_models,
     positive_themes, negative_themes, calculated_at)
  WITH rows AS (
    SELECT pr.id, pr.company_id, pr.tested_at::date AS tested_day,
           COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') AS job_function_context,
           COALESCE(NULLIF(btrim(cp.location_context), ''), '')     AS location_context,
           pr.company_mentioned, pr.ai_model, pr.confirmed_prompt_id,
           COALESCE(pr.canonical_citations, pr.citations) AS cites,
           crs.positive_themes, crs.negative_themes
    FROM prompt_responses pr
    JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
    LEFT JOIN company_response_sentiment_mv crs
      ON crs.company_id = pr.company_id AND crs.response_id = pr.id
    WHERE pr.company_id IS NOT NULL AND pr.tested_at IS NOT NULL
      AND pr.ai_model NOT IN ('claude','gemini','deepseek')
      AND lower(COALESCE(btrim(cp.attribute_id), '')) <> 'overall-candidate-experience'
      AND lower(COALESCE(btrim(cp.prompt_theme), '')) <> 'overall candidate experience'
      AND (p_company_id IS NULL OR pr.company_id = p_company_id)
  ),
  cite_counts AS (
    SELECT r.id, count(*) AS citation_count
    FROM rows r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.cites) = 'array' THEN r.cites ELSE '[]'::jsonb END) c(value)
    GROUP BY r.id
  )
  SELECT r.company_id, r.tested_day, r.job_function_context, r.location_context,
         count(*) AS total_responses,
         count(*) FILTER (WHERE r.company_mentioned = true) AS mentioned_responses,
         COALESCE(sum(cc.citation_count), 0) AS total_citations,
         count(DISTINCT (r.confirmed_prompt_id::text || '|' || r.ai_model)) AS distinct_prompt_models,
         COALESCE(sum(r.positive_themes), 0) AS positive_themes,
         COALESCE(sum(r.negative_themes), 0) AS negative_themes,
         now() AS calculated_at
  FROM rows r
  LEFT JOIN cite_counts cc ON cc.id = r.id
  GROUP BY r.company_id, r.tested_day, r.job_function_context, r.location_context;
END $$;

CREATE OR REPLACE FUNCTION public._refresh_cm_scope_prompt_type_stats(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_scope_prompt_type_stats_mv', 0));
  DELETE FROM public.company_scope_prompt_type_stats_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_scope_prompt_type_stats_mv
    (company_id, response_month, job_function_context, location_context, prompt_type,
     total_responses, mentioned_responses, calculated_at)
  SELECT pr.company_id,
         COALESCE(pr.response_month, date_trunc('month', pr.tested_at)::date),
         COALESCE(NULLIF(btrim(cp.job_function_context), ''), ''),
         COALESCE(NULLIF(btrim(cp.location_context), ''), ''),
         COALESCE(NULLIF(btrim(cp.prompt_type), ''), ''),
         count(*),
         count(*) FILTER (WHERE pr.company_mentioned = true),
         now()
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
  WHERE pr.company_id IS NOT NULL AND pr.tested_at IS NOT NULL
    AND pr.ai_model NOT IN ('claude','gemini','deepseek')
    AND lower(COALESCE(btrim(cp.attribute_id), '')) <> 'overall-candidate-experience'
    AND lower(COALESCE(btrim(cp.prompt_theme), '')) <> 'overall candidate experience'
    AND (p_company_id IS NULL OR pr.company_id = p_company_id)
  GROUP BY 1, 2, 3, 4, 5;
END $$;

CREATE OR REPLACE FUNCTION public._refresh_cm_llm_stats(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_llm_stats_mv', 0));
  DELETE FROM public.company_llm_stats_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_llm_stats_mv
    (company_id, response_month, job_function_context, location_context, ai_model,
     total_responses, mentions, calculated_at)
  SELECT pr.company_id,
         COALESCE(pr.response_month, date_trunc('month', pr.tested_at)::date),
         COALESCE(NULLIF(btrim(cp.job_function_context), ''), ''),
         COALESCE(NULLIF(btrim(cp.location_context), ''), ''),
         pr.ai_model,
         count(*),
         count(*) FILTER (WHERE pr.company_mentioned = true),
         now()
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
  WHERE pr.company_id IS NOT NULL AND pr.tested_at IS NOT NULL
    AND pr.for_index IS NOT TRUE
    AND pr.ai_model IS NOT NULL
    AND pr.ai_model NOT IN ('claude','gemini','deepseek')
    AND lower(COALESCE(btrim(cp.attribute_id), '')) <> 'overall-candidate-experience'
    AND lower(COALESCE(btrim(cp.prompt_theme), '')) <> 'overall candidate experience'
    AND (p_company_id IS NULL OR pr.company_id = p_company_id)
  GROUP BY 1, 2, 3, 4, 5;
END $$;

-- ---------------------------------------------------------------------------
-- Pipeline registration
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._refresh_cm_dispatch(p_mv_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  CASE p_mv_name
    WHEN 'company_sentiment_scores_mv'          THEN PERFORM public._refresh_cm_sentiment_scores(NULL);
    WHEN 'company_relevance_scores_mv'          THEN PERFORM public._refresh_cm_relevance_scores(NULL);
    WHEN 'company_top_sources_mv'               THEN PERFORM public._refresh_cm_top_sources(NULL);
    WHEN 'company_competitors_mv'               THEN PERFORM public._refresh_cm_competitors(NULL);
    WHEN 'company_llm_rankings_mv'              THEN PERFORM public._refresh_cm_llm_rankings(NULL);
    WHEN 'company_attribute_themes_mv'          THEN PERFORM public._refresh_cm_attribute_themes(NULL);
    WHEN 'company_response_sentiment_mv'        THEN PERFORM public._refresh_cm_response_sentiment(NULL);
    WHEN 'company_scope_stats_mv'               THEN PERFORM public._refresh_cm_scope_stats(NULL);
    WHEN 'company_scope_daily_stats_mv'         THEN PERFORM public._refresh_cm_scope_daily_stats(NULL);
    WHEN 'company_scope_prompt_type_stats_mv'   THEN PERFORM public._refresh_cm_scope_prompt_type_stats(NULL);
    WHEN 'company_llm_stats_mv'                 THEN PERFORM public._refresh_cm_llm_stats(NULL);
    ELSE EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I', p_mv_name);
  END CASE;
END $$;

-- Per-company refresh gains the four new families. company_response_sentiment_mv
-- must refresh BEFORE the scope stats (they read it), and already does.
CREATE OR REPLACE FUNCTION public.refresh_company_metrics(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
  PERFORM public._refresh_cm_scope_stats(p_company_id);
  PERFORM public._refresh_cm_scope_daily_stats(p_company_id);
  PERFORM public._refresh_cm_scope_prompt_type_stats(p_company_id);
  PERFORM public._refresh_cm_llm_stats(p_company_id);
  DELETE FROM public.company_metrics_dirty WHERE company_id = p_company_id;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_company_metrics()
RETURNS TABLE(view_name text, refresh_started timestamp with time zone, refresh_completed timestamp with time zone, success boolean, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_mv    text;
  v_start timestamptz;
BEGIN
  FOREACH v_mv IN ARRAY ARRAY[
    'company_sentiment_scores_mv','company_relevance_scores_mv','company_top_sources_mv',
    'company_competitors_mv','company_llm_rankings_mv','company_attribute_themes_mv',
    'company_response_sentiment_mv',
    'company_scope_stats_mv','company_scope_daily_stats_mv',
    'company_scope_prompt_type_stats_mv','company_llm_stats_mv',
    'company_sentiment_scores_by_location_mv','company_relevance_scores_by_location_mv',
    'company_attribute_themes_by_location_mv','company_top_sources_by_location_mv',
    'company_competitors_by_location_mv','company_llm_rankings_by_location_mv'
  ] LOOP
    v_start := now();
    BEGIN
      PERFORM public._refresh_cm_dispatch(v_mv);
      RETURN QUERY SELECT v_mv, v_start, now(), TRUE, NULL::text;
    EXCEPTION WHEN OTHERS THEN
      RETURN QUERY SELECT v_mv, v_start, now(), FALSE, SQLERRM;
    END;
  END LOOP;
END $$;

-- Bookkeeping rows so the tick's status updates cover the new families.
INSERT INTO public.mv_refresh_state (mv_name)
SELECT t FROM unnest(ARRAY[
  'company_scope_stats_mv','company_scope_daily_stats_mv',
  'company_scope_prompt_type_stats_mv','company_llm_stats_mv'
]) AS t
WHERE NOT EXISTS (SELECT 1 FROM public.mv_refresh_state s WHERE s.mv_name = t);

-- ---------------------------------------------------------------------------
-- Ship the cube with the dashboard rollups (additive keys — the deployed
-- client ignores them until it switches over).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_scope_stats(p_company_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ids AS (
    SELECT unnest(public.accessible_company_ids(p_company_ids)) AS company_id
  )
  SELECT jsonb_build_object(
    'scope', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'company_id', t.company_id, 'response_month', t.response_month,
        'job_function_context', t.job_function_context, 'location_context', t.location_context,
        'total_responses', t.total_responses, 'mentioned_responses', t.mentioned_responses,
        'total_citations', t.total_citations, 'distinct_domains', t.distinct_domains,
        'distinct_models', t.distinct_models,
        'positive_themes', t.positive_themes, 'negative_themes', t.negative_themes,
        'neutral_themes', t.neutral_themes))
      FROM company_scope_stats_mv t
      WHERE t.company_id IN (SELECT company_id FROM ids)
    ), '[]'::jsonb),
    'daily', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'company_id', t.company_id, 'tested_day', t.tested_day,
        'job_function_context', t.job_function_context, 'location_context', t.location_context,
        'total_responses', t.total_responses, 'mentioned_responses', t.mentioned_responses,
        'total_citations', t.total_citations, 'distinct_prompt_models', t.distinct_prompt_models,
        'positive_themes', t.positive_themes, 'negative_themes', t.negative_themes))
      FROM company_scope_daily_stats_mv t
      WHERE t.company_id IN (SELECT company_id FROM ids)
    ), '[]'::jsonb),
    'prompt_types', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'company_id', t.company_id, 'response_month', t.response_month,
        'job_function_context', t.job_function_context, 'location_context', t.location_context,
        'prompt_type', t.prompt_type,
        'total_responses', t.total_responses, 'mentioned_responses', t.mentioned_responses))
      FROM company_scope_prompt_type_stats_mv t
      WHERE t.company_id IN (SELECT company_id FROM ids)
    ), '[]'::jsonb),
    'llm', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'company_id', t.company_id, 'response_month', t.response_month,
        'job_function_context', t.job_function_context, 'location_context', t.location_context,
        'ai_model', t.ai_model,
        'total_responses', t.total_responses, 'mentions', t.mentions))
      FROM company_llm_stats_mv t
      WHERE t.company_id IN (SELECT company_id FROM ids)
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.get_scope_stats(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_scope_stats(uuid[]) TO authenticated, service_role;

-- Backfill: queue every company through the existing dirty-queue so the
-- 1-minute tick populates the new tables at 5 companies/minute — no load
-- spike, same guardrails as any other refresh.
SELECT public.queue_all_companies_metrics_dirty();
