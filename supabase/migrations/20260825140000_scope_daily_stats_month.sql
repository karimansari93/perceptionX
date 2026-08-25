-- Phase 3 slice 1 fix: the daily stats table needs response_month.
--
-- The client's period filter selects responses by the QUARTER of
-- response_month (collection-cycle month), while day-grain trends bucket the
-- selected rows by tested_at day. A response tested Aug 3 can belong to
-- July's collection cycle, so day rows must carry BOTH dates for the cube to
-- reproduce "trend of the selected period" exactly. Grain grows from
-- (company, day, fn, loc) to (company, day, response_month, fn, loc) — in
-- practice a tested_day maps to 1-2 response_months, so row counts barely
-- move (measured 1,207 rows scope-wide before this change).

ALTER TABLE public.company_scope_daily_stats_mv
  ADD COLUMN IF NOT EXISTS response_month date;

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
    (company_id, tested_day, response_month, job_function_context, location_context,
     total_responses, mentioned_responses, total_citations, distinct_prompt_models,
     positive_themes, negative_themes, calculated_at)
  WITH rows AS (
    SELECT pr.id, pr.company_id, pr.tested_at::date AS tested_day,
           COALESCE(pr.response_month, date_trunc('month', pr.tested_at)::date) AS response_month,
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
  SELECT r.company_id, r.tested_day, r.response_month, r.job_function_context, r.location_context,
         count(*) AS total_responses,
         count(*) FILTER (WHERE r.company_mentioned = true) AS mentioned_responses,
         COALESCE(sum(cc.citation_count), 0) AS total_citations,
         count(DISTINCT (r.confirmed_prompt_id::text || '|' || r.ai_model)) AS distinct_prompt_models,
         COALESCE(sum(r.positive_themes), 0) AS positive_themes,
         COALESCE(sum(r.negative_themes), 0) AS negative_themes,
         now() AS calculated_at
  FROM rows r
  LEFT JOIN cite_counts cc ON cc.id = r.id
  GROUP BY r.company_id, r.tested_day, r.response_month, r.job_function_context, r.location_context;
END $$;

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
        'response_month', t.response_month,
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

-- Repopulate through the throttled dirty queue (a single global rebuild ran
-- past the migration client's timeout and rolled back; the queue path drains
-- at 5 companies/minute with no such ceiling). Until a company drains, its
-- daily rows carry NULL response_month — the client selector must treat those
-- as not-yet-refreshed.
SELECT public.queue_all_companies_metrics_dirty();
