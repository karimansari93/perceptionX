-- Phase 3, slice 3: competitor stats cube, and job-function-aware reads for
-- both interactive cubes.
--
-- Payload decision (measured on the Ford scope): keeping the job-function
-- dimension in get_domain_stats' top-300 output is 12,660 rows (~1.2 MB)
-- versus 851 collapsed — heavy for a per-toggle fetch but cheap as a
-- once-per-scope+location fetch, and it makes every job-function/period
-- toggle a pure client-side pool over cube rows (instant, no fetch). Same
-- pattern for competitors (~5-6K rows per large company at full grain).
-- Both RPCs therefore fetch once per (scope, location selection) keeping
-- month × job-function (× prompt_type for competitors), and the client
-- pools.

-- ---------------------------------------------------------------------------
-- get_domain_stats gains p_keep_functions (new signature; the old one had no
-- deployed callers). p_keep_functions=false preserves the collapsed shape.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_domain_stats(uuid[], text[], uuid[], text[], date[], text[], int);

CREATE OR REPLACE FUNCTION public.get_domain_stats(
  p_owned_ids uuid[],
  p_owned_buckets text[] DEFAULT NULL,
  p_other_ids uuid[] DEFAULT '{}',
  p_other_buckets text[] DEFAULT '{}',
  p_months date[] DEFAULT NULL,
  p_job_functions text[] DEFAULT NULL,
  p_keep_functions boolean DEFAULT false,
  p_limit int DEFAULT 300
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH jobs AS (
    SELECT unnest(public.accessible_company_ids(p_owned_ids)) AS company_id,
           p_owned_buckets AS buckets
    UNION ALL
    SELECT unnest(public.accessible_company_ids(p_other_ids)) AS company_id,
           p_other_buckets AS buckets
    WHERE COALESCE(array_length(p_other_buckets, 1), 0) > 0
  ),
  filtered AS (
    SELECT t.domain, t.response_month,
           CASE WHEN p_keep_functions THEN t.job_function_context ELSE '' END AS job_function_context,
           sum(t.responses_citing) AS responses_citing,
           sum(t.mentioned_responses_citing) AS mentioned_responses_citing,
           sum(t.citation_count) AS citation_count
    FROM jobs j
    JOIN company_domain_stats_mv t
      ON t.company_id = j.company_id
     AND (j.buckets IS NULL OR t.location_context = ANY (j.buckets))
    WHERE (p_months IS NULL OR t.response_month = ANY (p_months))
      AND (p_job_functions IS NULL OR t.job_function_context = ANY (p_job_functions))
    GROUP BY 1, 2, 3
  ),
  top_domains AS (
    SELECT domain
    FROM filtered
    GROUP BY domain
    ORDER BY sum(responses_citing) DESC, domain
    LIMIT LEAST(GREATEST(p_limit, 1), 1000)
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'domain', f.domain, 'response_month', f.response_month,
        'job_function_context', f.job_function_context,
        'responses_citing', f.responses_citing,
        'mentioned_responses_citing', f.mentioned_responses_citing,
        'citation_count', f.citation_count))
      FROM filtered f
      JOIN top_domains d ON d.domain = f.domain
    ), '[]'::jsonb),
    'domain_total', (SELECT count(DISTINCT domain) FROM filtered)
  );
$$;

REVOKE ALL ON FUNCTION public.get_domain_stats(uuid[], text[], uuid[], text[], date[], text[], boolean, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_domain_stats(uuid[], text[], uuid[], text[], date[], text[], boolean, int) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Competitor cube. Canonicalization mirrors _refresh_cm_competitors exactly
-- (normalize → entity alias mapping → self-name and noise exclusion) so
-- names line up with the existing competitors rollup. Measures are deduped
-- per response: responses_mentioning counts responses naming the
-- competitor; co_mentions those where the company was also mentioned.
-- Includes for_index rows (parity with the raw stream the tabs compute
-- from today — the deliberate divergence from company_competitors_mv is
-- documented in the phase-3 notes).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_competitor_stats_mv (
  company_id           uuid   NOT NULL,
  competitor_name      text   NOT NULL,
  response_month       date   NOT NULL,
  job_function_context text   NOT NULL DEFAULT '',
  location_context     text   NOT NULL DEFAULT '',
  prompt_type          text   NOT NULL DEFAULT '',
  responses_mentioning bigint NOT NULL DEFAULT 0,
  co_mentions          bigint NOT NULL DEFAULT 0,
  calculated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_competitor_stats_company
  ON public.company_competitor_stats_mv (company_id);

ALTER TABLE public.company_competitor_stats_mv ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._refresh_cm_competitor_stats(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_competitor_stats_mv', 0));
  DELETE FROM public.company_competitor_stats_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_competitor_stats_mv
    (company_id, competitor_name, response_month, job_function_context, location_context,
     prompt_type, responses_mentioning, co_mentions, calculated_at)
  WITH raw AS (
    SELECT pr.id, pr.company_id,
           COALESCE(pr.response_month, date_trunc('month', pr.tested_at)::date) AS response_month,
           COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') AS job_function_context,
           COALESCE(NULLIF(btrim(cp.location_context), ''), '')     AS location_context,
           COALESCE(NULLIF(btrim(cp.prompt_type), ''), '')          AS prompt_type,
           pr.company_mentioned,
           normalize_entity_name(TRIM(BOTH FROM unnest(string_to_array(pr.detected_competitors, ',')))) AS normalized_alias
    FROM prompt_responses pr
    JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
    WHERE pr.company_id IS NOT NULL AND pr.tested_at IS NOT NULL
      AND pr.detected_competitors IS NOT NULL AND pr.detected_competitors <> ''
      AND pr.ai_model NOT IN ('claude','gemini','deepseek')
      AND lower(COALESCE(btrim(cp.attribute_id), '')) <> 'overall-candidate-experience'
      AND lower(COALESCE(btrim(cp.prompt_theme), '')) <> 'overall candidate experience'
      AND (p_company_id IS NULL OR pr.company_id = p_company_id)
  ), mapped AS (
    SELECT r.id, r.company_id, r.response_month, r.job_function_context, r.location_context,
           r.prompt_type, r.company_mentioned,
           COALESCE(ce.canonical_name, initcap(r.normalized_alias)) AS competitor_name, ce.is_active
    FROM raw r
      LEFT JOIN entity_aliases ea ON ea.normalized_alias = r.normalized_alias
      LEFT JOIN canonical_entities ce ON ce.id = ea.canonical_id
    WHERE r.normalized_alias IS NOT NULL AND r.normalized_alias <> '' AND length(r.normalized_alias) > 1
      AND (r.normalized_alias <> ALL (ARRAY['none','n/a','na','null','undefined']))
      AND r.normalized_alias !~ '^[0-9]+$' AND r.normalized_alias ~ '[a-z0-9]'
  )
  SELECT m.company_id, m.competitor_name, m.response_month, m.job_function_context,
         m.location_context, m.prompt_type,
         count(DISTINCT m.id) AS responses_mentioning,
         count(DISTINCT m.id) FILTER (WHERE m.company_mentioned = true) AS co_mentions,
         now() AS calculated_at
  FROM mapped m
  JOIN companies c ON c.id = m.company_id
  WHERE m.is_active IS NOT FALSE
    AND NOT (
      m.competitor_name ~* ('\m' || regexp_replace(c.name, '([.^$|()\[\]{}*+?\\])', '\\\1', 'g') || '\M')
      OR lower(m.competitor_name) = lower(c.name)
    )
  GROUP BY m.company_id, m.competitor_name, m.response_month, m.job_function_context,
           m.location_context, m.prompt_type;
END $$;

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
    WHEN 'company_domain_stats_mv'              THEN PERFORM public._refresh_cm_domain_stats(NULL);
    WHEN 'company_competitor_stats_mv'          THEN PERFORM public._refresh_cm_competitor_stats(NULL);
    ELSE EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I', p_mv_name);
  END CASE;
END $$;

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
  PERFORM public._refresh_cm_domain_stats(p_company_id);
  PERFORM public._refresh_cm_competitor_stats(p_company_id);
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
    'company_scope_prompt_type_stats_mv','company_llm_stats_mv','company_domain_stats_mv',
    'company_competitor_stats_mv',
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

INSERT INTO public.mv_refresh_state (mv_name)
SELECT t FROM unnest(ARRAY['company_competitor_stats_mv']) AS t
WHERE NOT EXISTS (SELECT 1 FROM public.mv_refresh_state s WHERE s.mv_name = t);

-- Filtered competitor read: month × job-function × prompt_type kept, top-N
-- competitors by responses_mentioning across the filtered window.
CREATE OR REPLACE FUNCTION public.get_competitor_stats(
  p_owned_ids uuid[],
  p_owned_buckets text[] DEFAULT NULL,
  p_other_ids uuid[] DEFAULT '{}',
  p_other_buckets text[] DEFAULT '{}',
  p_months date[] DEFAULT NULL,
  p_limit int DEFAULT 300
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH jobs AS (
    SELECT unnest(public.accessible_company_ids(p_owned_ids)) AS company_id,
           p_owned_buckets AS buckets
    UNION ALL
    SELECT unnest(public.accessible_company_ids(p_other_ids)) AS company_id,
           p_other_buckets AS buckets
    WHERE COALESCE(array_length(p_other_buckets, 1), 0) > 0
  ),
  filtered AS (
    SELECT t.competitor_name, t.response_month, t.job_function_context, t.prompt_type,
           sum(t.responses_mentioning) AS responses_mentioning,
           sum(t.co_mentions) AS co_mentions
    FROM jobs j
    JOIN company_competitor_stats_mv t
      ON t.company_id = j.company_id
     AND (j.buckets IS NULL OR t.location_context = ANY (j.buckets))
    WHERE (p_months IS NULL OR t.response_month = ANY (p_months))
    GROUP BY 1, 2, 3, 4
  ),
  top_competitors AS (
    SELECT competitor_name
    FROM filtered
    GROUP BY competitor_name
    ORDER BY sum(responses_mentioning) DESC, competitor_name
    LIMIT LEAST(GREATEST(p_limit, 1), 1000)
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'competitor_name', f.competitor_name, 'response_month', f.response_month,
        'job_function_context', f.job_function_context, 'prompt_type', f.prompt_type,
        'responses_mentioning', f.responses_mentioning, 'co_mentions', f.co_mentions))
      FROM filtered f
      JOIN top_competitors d ON d.competitor_name = f.competitor_name
    ), '[]'::jsonb),
    'competitor_total', (SELECT count(DISTINCT competitor_name) FROM filtered)
  );
$$;

REVOKE ALL ON FUNCTION public.get_competitor_stats(uuid[], text[], uuid[], text[], date[], int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_competitor_stats(uuid[], text[], uuid[], text[], date[], int) TO authenticated, service_role;

SELECT public.queue_all_companies_metrics_dirty();
