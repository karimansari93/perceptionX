-- ============================================================================
-- Claude back in client-facing figures from September 2026 (part 1: functions)
-- ============================================================================
-- Methodology v2 (20260719120000) excluded ('claude','gemini','deepseek') from
-- every client-facing rollup. Decision (Karim, 2026-09-25): Claude counts
-- again for response months from 2026-09 onward. Earlier months keep
-- excluding it so figures already reported (Netflix / PepsiCo July,
-- Cloudera March) do not restate. Gemini and DeepSeek stay excluded.
--
-- The rule now lives in ONE place, is_published_model(); change it there.
-- Part 2 (next migration) rebuilds the by-location matviews on it.

CREATE OR REPLACE FUNCTION public.is_published_model(p_model text, p_response_month date)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT p_model NOT IN ('gemini', 'deepseek')
     AND NOT (p_model = 'claude' AND p_response_month < DATE '2026-09-01');
$$;

-- Rewrite every live function carrying the v2 literal filter. Done from the
-- LIVE definitions (pg_get_functiondef) because prod has drifted from this
-- repo's migration files; each keeps its body, grants and settings and only
-- swaps the predicate. Every current occurrence filters prompt_responses, so
-- response_month is in scope under the same alias.
DO $$
DECLARE
  f record;
  v_def text;
  v_new text;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND pg_get_functiondef(p.oid) ~* 'ai_model NOT IN \(''claude'',''gemini'',''deepseek''\)'
  LOOP
    v_def := pg_get_functiondef(f.oid);
    v_new := regexp_replace(
      v_def,
      '(\m\w+\.)?ai_model NOT IN \(''claude'',''gemini'',''deepseek''\)',
      'public.is_published_model(\1ai_model, \1response_month)',
      'gi');
    EXECUTE v_new;
    RAISE NOTICE 'published-model filter updated in %', f.proname;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND pg_get_functiondef(p.oid) ~* 'NOT IN \(''claude'',''gemini'',''deepseek''\)'
  ) THEN
    RAISE EXCEPTION 'a function still carries the old model filter';
  END IF;
END;
$$;

-- The dashboard's response stream: callers pass the always-excluded models;
-- the month-dependent Claude rule is applied here so the client never needs it.
CREATE OR REPLACE FUNCTION public.get_company_responses_page(p_company_id uuid, p_excluded_models text[] DEFAULT '{}'::text[], p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_tested_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 1000)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET work_mem TO '16MB'
AS $function$
  SELECT COALESCE(jsonb_agg(row_j), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id', pr.id,
      'confirmed_prompt_id', pr.confirmed_prompt_id,
      'company_id', pr.company_id,
      'ai_model', pr.ai_model,
      'tested_at', pr.tested_at,
      'created_at', pr.created_at,
      'updated_at', pr.updated_at,
      'response_month', pr.response_month,
      'company_mentioned', pr.company_mentioned,
      'detected_competitors', CASE
        WHEN pr.canonicalized_at IS NOT NULL THEN pr.canonical_competitors
        ELSE public.canonicalize_competitor_list(pr.detected_competitors)
      END,
      'citations', public.slim_citation_list(CASE
        WHEN pr.canonicalized_at IS NOT NULL THEN pr.canonical_citations
        ELSE public.canonicalize_citations(pr.citations)
      END),
      'for_index', pr.for_index,
      'index_period', pr.index_period,
      'sentiment_total_themes', crs.total_themes,
      'sentiment_positive_themes', crs.positive_themes,
      'sentiment_negative_themes', crs.negative_themes,
      'sentiment_ratio', crs.sentiment_ratio
    ) AS row_j
    FROM prompt_responses pr
    LEFT JOIN company_response_sentiment_mv crs
      ON crs.company_id = pr.company_id AND crs.response_id = pr.id
    WHERE pr.company_id = p_company_id
      AND pr.tested_at >= COALESCE(p_since, '-infinity'::timestamptz)
      AND pr.tested_at <= COALESCE(p_before_tested_at, 'infinity'::timestamptz)
      AND NOT (pr.ai_model = ANY (p_excluded_models))
      AND public.is_published_model(pr.ai_model, pr.response_month)
      AND (
        p_before_tested_at IS NULL
        OR pr.tested_at < p_before_tested_at
        OR pr.id < p_before_id
      )
    ORDER BY pr.tested_at DESC, pr.id DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 2000)
  ) page;
$function$;

-- Only companies with Claude responses from 2026-09 on change; queue them for
-- the staleness-driven metrics tick instead of rebuilding every company.
INSERT INTO public.company_metrics_dirty (company_id, dirtied_at)
SELECT DISTINCT pr.company_id, now()
FROM public.prompt_responses pr
WHERE pr.ai_model = 'claude' AND pr.response_month >= DATE '2026-09-01' AND pr.company_id IS NOT NULL
ON CONFLICT (company_id) DO UPDATE SET dirtied_at = EXCLUDED.dirtied_at;
