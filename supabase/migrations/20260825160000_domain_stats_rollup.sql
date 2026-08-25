-- Phase 3, slice 2: domain-grain stats cube + filtered RPC.
--
-- Serves the Sources surfaces (SourcesTab lists/trends/media types,
-- SourcesSummaryCard, Overview citation cards — audit items A9, A14, C2-C4,
-- E2-E7) without raw-row scans. Unlike the slice-1 scope cubes this one is
-- too large to ship whole (measured ~13-15K rows per large company at
-- domain × month × job-function grain), so it stays server-side behind
-- get_domain_stats, which collapses job-function/location per request and
-- returns month-grain rows for the top-N domains — one shape serving the
-- ranked list, prior-period deltas, and the trend chart at once
-- (~1-2K rows ≈ 100 KB per call).
--
-- Semantics follow the raw-row views this replaces (and slice 1's policy):
-- canonical citations, domains lowercased with a leading www. stripped,
-- models claude/gemini/deepseek excluded, "overall candidate experience"
-- excluded, for_index INCLUDED (the stream the UI computes from includes it).
-- Measures per the audit: responses_citing / mentioned_responses_citing are
-- deduped per response; citation_count counts occurrences.

CREATE TABLE IF NOT EXISTS public.company_domain_stats_mv (
  company_id                  uuid   NOT NULL,
  domain                      text   NOT NULL,
  response_month              date   NOT NULL,
  job_function_context        text   NOT NULL DEFAULT '',
  location_context            text   NOT NULL DEFAULT '',
  responses_citing            bigint NOT NULL DEFAULT 0,
  mentioned_responses_citing  bigint NOT NULL DEFAULT 0,
  citation_count              bigint NOT NULL DEFAULT 0,
  calculated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_domain_stats_company
  ON public.company_domain_stats_mv (company_id);

ALTER TABLE public.company_domain_stats_mv ENABLE ROW LEVEL SECURITY;
-- No policies: reads go through the SECURITY DEFINER RPC only.

CREATE OR REPLACE FUNCTION public._refresh_cm_domain_stats(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_domain_stats_mv', 0));
  DELETE FROM public.company_domain_stats_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_domain_stats_mv
    (company_id, domain, response_month, job_function_context, location_context,
     responses_citing, mentioned_responses_citing, citation_count, calculated_at)
  WITH rows AS (
    SELECT pr.id, pr.company_id,
           COALESCE(pr.response_month, date_trunc('month', pr.tested_at)::date) AS response_month,
           COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') AS job_function_context,
           COALESCE(NULLIF(btrim(cp.location_context), ''), '')     AS location_context,
           pr.company_mentioned,
           COALESCE(pr.canonical_citations, pr.citations) AS cites
    FROM prompt_responses pr
    JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
    WHERE pr.company_id IS NOT NULL AND pr.tested_at IS NOT NULL
      AND pr.ai_model NOT IN ('claude','gemini','deepseek')
      AND lower(COALESCE(btrim(cp.attribute_id), '')) <> 'overall-candidate-experience'
      AND lower(COALESCE(btrim(cp.prompt_theme), '')) <> 'overall candidate experience'
      AND (p_company_id IS NULL OR pr.company_id = p_company_id)
  ),
  cites AS (
    SELECT r.id, r.company_id, r.response_month, r.job_function_context, r.location_context,
           r.company_mentioned,
           lower(regexp_replace(c.value->>'domain', '^www\.', '')) AS domain
    FROM rows r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.cites) = 'array' THEN r.cites ELSE '[]'::jsonb END) c(value)
    WHERE COALESCE(c.value->>'domain','') <> ''
  )
  SELECT company_id, domain, response_month, job_function_context, location_context,
         count(DISTINCT id) AS responses_citing,
         count(DISTINCT id) FILTER (WHERE company_mentioned = true) AS mentioned_responses_citing,
         count(*) AS citation_count,
         now() AS calculated_at
  FROM cites
  GROUP BY company_id, domain, response_month, job_function_context, location_context;
END $$;

-- Pipeline registration: dispatch, per-company refresh, full rebuild list,
-- bookkeeping row.
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
SELECT t FROM unnest(ARRAY['company_domain_stats_mv']) AS t
WHERE NOT EXISTS (SELECT 1 FROM public.mv_refresh_state s WHERE s.mv_name = t);

-- Filtered read: collapse job-function and location per request, keep the
-- month grain, return only the top-N domains (ranked by responses_citing
-- across the whole filtered window). Location follows the
-- get_location_rollups convention: owned profiles read a widened bucket
-- list, other profiles read only the selection's spellings; pass
-- p_owned_buckets = NULL for "all locations" (no location predicate).
CREATE OR REPLACE FUNCTION public.get_domain_stats(
  p_owned_ids uuid[],
  p_owned_buckets text[] DEFAULT NULL,
  p_other_ids uuid[] DEFAULT '{}',
  p_other_buckets text[] DEFAULT '{}',
  p_months date[] DEFAULT NULL,
  p_job_functions text[] DEFAULT NULL,
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
           sum(t.responses_citing) AS responses_citing,
           sum(t.mentioned_responses_citing) AS mentioned_responses_citing,
           sum(t.citation_count) AS citation_count
    FROM jobs j
    JOIN company_domain_stats_mv t
      ON t.company_id = j.company_id
     AND (j.buckets IS NULL OR t.location_context = ANY (j.buckets))
    WHERE (p_months IS NULL OR t.response_month = ANY (p_months))
      AND (p_job_functions IS NULL OR t.job_function_context = ANY (p_job_functions))
    GROUP BY t.domain, t.response_month
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
        'responses_citing', f.responses_citing,
        'mentioned_responses_citing', f.mentioned_responses_citing,
        'citation_count', f.citation_count))
      FROM filtered f
      JOIN top_domains d ON d.domain = f.domain
    ), '[]'::jsonb),
    'domain_total', (SELECT count(DISTINCT domain) FROM filtered)
  );
$$;

REVOKE ALL ON FUNCTION public.get_domain_stats(uuid[], text[], uuid[], text[], date[], text[], int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_domain_stats(uuid[], text[], uuid[], text[], date[], text[], int) TO authenticated, service_role;

-- Backfill via the throttled dirty queue.
SELECT public.queue_all_companies_metrics_dirty();
