-- =============================================================================
-- px-tools read RPCs, round 2 (service-role only, additive).
--
-- Guardrail audit ahead of the Ford pilot (2026-09-03). Three defects in the
-- shared data-tool layer would have made the ChatGPT/Claude answers look
-- wrong next to the dashboard:
--
--   1. Periods were CALENDAR quarters. Collection runs in waves (Ford: one
--      wave in Apr/May, one in July), so a calendar window said "Q4 2025 …
--      Q3 2026" while the data had two periods — the host model read that as
--      gaps ("no data for Q1"). The running calendar quarter was also labeled
--      "(in progress)" even when its wave was complete, which reads as "the
--      drop may not be real". mcp_get_measurement_periods returns the MEASURED
--      months for a scope plus whether a collection is actually in flight.
--   2. EPS read relevance from `company_relevance_scores`, a relation that
--      does not exist — relevance silently scored 0 and EPS lost its 20%
--      component. mcp_get_rollups (replaced in place, same signature) now
--      returns a `relevance` family from the same MVs the dashboard reads.
--   3. Theme / competitor / citation / platform aggregates were computed in
--      the edge function from raw rows pulled through PostgREST, which caps
--      at max_rows=1000 — every real company's counts were truncated.
--      mcp_get_theme_stats aggregates in SQL; the other families already had
--      cube twins.
--
-- Plus mcp_get_attribute_sources: the domains cited in answers that discuss
-- one attribute — the "these are the sources where it happened" half of an
-- attribute answer (response-level association, not causal).
--
-- All functions are STABLE SECURITY DEFINER, executable by service_role ONLY;
-- the edge function has validated tenancy of every company id before calling.
-- =============================================================================

-- ── Measured periods for a scope ────────────────────────────────────────────
-- `months` is the client-facing period source of truth (distinct
-- response_month with data, location-filtered when buckets are given);
-- `by_company` lets list_companies show each profile's latest period;
-- `active_collection` / `last_collected_day` decide whether the latest
-- quarter is genuinely still filling in.
CREATE OR REPLACE FUNCTION public.mcp_get_measurement_periods(
  p_company_ids uuid[],
  p_buckets text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'months', COALESCE((
      SELECT jsonb_agg(m.response_month ORDER BY m.response_month)
      FROM (
        SELECT DISTINCT t.response_month
        FROM public.company_scope_stats_mv t
        WHERE t.company_id = ANY (p_company_ids)
          AND (p_buckets IS NULL OR t.location_context = ANY (p_buckets))
          AND t.total_responses > 0
      ) m
    ), '[]'::jsonb),
    'by_company', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'company_id', s.company_id, 'months', s.months, 'answers', s.answers))
      FROM (
        SELECT t.company_id,
               jsonb_agg(DISTINCT t.response_month) AS months,
               sum(t.total_responses) AS answers
        FROM public.company_scope_stats_mv t
        WHERE t.company_id = ANY (p_company_ids)
          AND t.total_responses > 0
        GROUP BY t.company_id
      ) s
    ), '[]'::jsonb),
    'last_collected_day', (
      SELECT max(d.tested_day)
      FROM public.company_scope_daily_stats_mv d
      WHERE d.company_id = ANY (p_company_ids)
    ),
    'active_collection', EXISTS (
      SELECT 1
      FROM public.company_batch_queue q
      WHERE q.company_id = ANY (p_company_ids)
        AND q.status IN ('pending', 'processing')
        AND q.is_cancelled IS NOT TRUE
    )
  );
$$;

-- ── Core rollups (replaced in place): + `relevance` family ──────────────────
-- Same families as 20260831120100 plus `relevance`: per-month valid-citation
-- weights and the citation-weighted relevance sum, from
-- company_relevance_scores_mv (company-wide) or its by-location twin when
-- buckets are given — the dashboard's aggregateRelevanceRows inputs.
CREATE OR REPLACE FUNCTION public.mcp_get_rollups(
  p_company_ids uuid[],
  p_buckets text[] DEFAULT NULL,
  p_months date[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'scope_stats', COALESCE((
      SELECT jsonb_agg(to_jsonb(s)) FROM (
        SELECT t.company_id, t.response_month, t.job_function_context, t.location_context,
               t.total_responses, t.mentioned_responses, t.total_citations, t.distinct_domains,
               t.positive_themes, t.negative_themes, t.neutral_themes
        FROM public.company_scope_stats_mv t
        WHERE t.company_id = ANY (p_company_ids)
          AND (p_buckets IS NULL OR t.location_context = ANY (p_buckets))
          AND (p_months IS NULL OR t.response_month = ANY (p_months))
        LIMIT 8000
      ) s
    ), '[]'::jsonb),
    'llm_stats', COALESCE((
      SELECT jsonb_agg(to_jsonb(s)) FROM (
        SELECT t.ai_model, t.response_month, t.location_context,
               t.total_responses, t.mentions
        FROM public.company_llm_stats_mv t
        WHERE t.company_id = ANY (p_company_ids)
          AND (p_buckets IS NULL OR t.location_context = ANY (p_buckets))
          AND (p_months IS NULL OR t.response_month = ANY (p_months))
        LIMIT 8000
      ) s
    ), '[]'::jsonb),
    'attribute_themes', CASE WHEN p_buckets IS NULL THEN COALESCE((
      SELECT jsonb_agg(to_jsonb(s)) FROM (
        SELECT t.attribute_id, t.response_month, t.job_function_context,
               t.total_themes, t.positive_themes, t.negative_themes, t.neutral_themes,
               t.response_count
        FROM public.company_attribute_themes_mv t
        WHERE t.company_id = ANY (p_company_ids)
          AND (p_months IS NULL OR t.response_month = ANY (p_months))
        LIMIT 8000
      ) s
    ), '[]'::jsonb) ELSE COALESCE((
      SELECT jsonb_agg(to_jsonb(s)) FROM (
        SELECT t.attribute_id, t.response_month, t.job_function_context, t.location_context,
               t.total_themes, t.positive_themes, t.negative_themes, t.neutral_themes,
               t.response_count
        FROM public.company_attribute_themes_by_location_mv t
        WHERE t.company_id = ANY (p_company_ids)
          AND t.location_context = ANY (p_buckets)
          AND (p_months IS NULL OR t.response_month = ANY (p_months))
        LIMIT 8000
      ) s
    ), '[]'::jsonb) END,
    'relevance', CASE WHEN p_buckets IS NULL THEN COALESCE((
      SELECT jsonb_agg(to_jsonb(s)) FROM (
        SELECT (t.response_month AT TIME ZONE 'UTC')::date AS response_month,
               sum(t.valid_citations) AS valid_citations,
               sum(t.relevance_score * t.valid_citations) AS weighted_relevance
        FROM public.company_relevance_scores_mv t
        WHERE t.company_id = ANY (p_company_ids)
          AND (p_months IS NULL OR (t.response_month AT TIME ZONE 'UTC')::date = ANY (p_months))
        GROUP BY 1
      ) s
    ), '[]'::jsonb) ELSE COALESCE((
      SELECT jsonb_agg(to_jsonb(s)) FROM (
        SELECT (t.response_month AT TIME ZONE 'UTC')::date AS response_month,
               sum(t.valid_citations) AS valid_citations,
               sum(t.relevance_score * t.valid_citations) AS weighted_relevance
        FROM public.company_relevance_scores_by_location_mv t
        WHERE t.company_id = ANY (p_company_ids)
          AND t.location_context = ANY (p_buckets)
          AND (p_months IS NULL OR (t.response_month AT TIME ZONE 'UTC')::date = ANY (p_months))
        GROUP BY 1
      ) s
    ), '[]'::jsonb) END,
    'data_as_of', (
      SELECT max(t.calculated_at)
      FROM public.company_scope_stats_mv t
      WHERE t.company_id = ANY (p_company_ids)
    )
  );
$$;

-- ── Theme aggregates in SQL (replaces raw-row pulls capped at 1000) ─────────
-- Families:
--   themes               → by theme_name: distinct answers, sentiment split,
--                          attribute ids, platforms, one description / keyword
--                          set / snippet (top p_limit by answers)
--   by_platform          → per AI platform: answers with themes + sentiment
--   attribute_top_themes → attribute_id → top-3 theme names
--   responses_with_themes / theme_total → sample-size context
CREATE OR REPLACE FUNCTION public.mcp_get_theme_stats(
  p_company_ids uuid[],
  p_buckets text[] DEFAULT NULL,
  p_months date[] DEFAULT NULL,
  p_limit int DEFAULT 30
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT t.response_id, t.theme_name, t.sentiment,
           NULLIF(btrim(t.attribute_id), '') AS attribute_id,
           t.theme_description, t.keywords, t.context_snippets,
           pr.ai_model
    FROM public.ai_themes t
    JOIN public.prompt_responses pr ON pr.id = t.response_id
    JOIN public.confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
    WHERE t.company_id = ANY (p_company_ids)
      AND t.theme_name IS NOT NULL
      AND pr.ai_model NOT IN ('claude','gemini','deepseek')
      AND pr.for_index IS NOT TRUE
      AND (p_months IS NULL OR COALESCE(pr.response_month, date_trunc('month', pr.tested_at)::date) = ANY (p_months))
      AND (p_buckets IS NULL OR COALESCE(NULLIF(btrim(cp.location_context), ''), '') = ANY (p_buckets))
  ),
  themes AS (
    SELECT b.theme_name,
           count(DISTINCT b.response_id) AS responses,
           count(*) FILTER (WHERE b.sentiment = 'positive') AS positive,
           count(*) FILTER (WHERE b.sentiment = 'negative') AS negative,
           count(*) FILTER (WHERE b.sentiment = 'neutral')  AS neutral,
           array_remove(array_agg(DISTINCT b.attribute_id), NULL) AS attribute_ids,
           array_remove(array_agg(DISTINCT b.ai_model), NULL) AS platforms,
           (array_agg(b.theme_description) FILTER (WHERE b.theme_description IS NOT NULL))[1] AS description,
           -- jsonb, not text[]: array_agg over text[] rows of differing
           -- lengths raises "cannot accumulate arrays of different dimensionality".
           (array_agg(to_jsonb(b.keywords)) FILTER (WHERE b.keywords IS NOT NULL AND cardinality(b.keywords) > 0))[1] AS keywords,
           (array_agg(b.context_snippets[1]) FILTER (WHERE b.context_snippets[1] IS NOT NULL))[1] AS snippet
    FROM base b
    GROUP BY b.theme_name
    ORDER BY responses DESC, b.theme_name
    LIMIT LEAST(GREATEST(p_limit, 1), 200)
  ),
  by_platform AS (
    SELECT b.ai_model,
           count(DISTINCT b.response_id) AS responses_with_themes,
           count(*) FILTER (WHERE b.sentiment = 'positive') AS positive,
           count(*) FILTER (WHERE b.sentiment = 'negative') AS negative,
           count(*) FILTER (WHERE b.sentiment = 'neutral')  AS neutral
    FROM base b
    WHERE b.ai_model IS NOT NULL
    GROUP BY b.ai_model
  ),
  ranked AS (
    SELECT b.attribute_id, b.theme_name,
           count(DISTINCT b.response_id) AS responses,
           row_number() OVER (
             PARTITION BY b.attribute_id
             ORDER BY count(DISTINCT b.response_id) DESC, b.theme_name
           ) AS rn
    FROM base b
    WHERE b.attribute_id IS NOT NULL
    GROUP BY b.attribute_id, b.theme_name
  )
  SELECT jsonb_build_object(
    'themes', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.responses DESC, t.theme_name) FROM themes t), '[]'::jsonb),
    'by_platform', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.responses_with_themes DESC) FROM by_platform p), '[]'::jsonb),
    'attribute_top_themes', COALESCE((
      SELECT jsonb_object_agg(r.attribute_id, r.names)
      FROM (
        SELECT attribute_id, jsonb_agg(theme_name ORDER BY responses DESC, theme_name) AS names
        FROM ranked
        WHERE rn <= 3
        GROUP BY attribute_id
      ) r
    ), '{}'::jsonb),
    'responses_with_themes', (SELECT count(DISTINCT response_id) FROM base),
    'theme_total', (SELECT count(DISTINCT theme_name) FROM base)
  );
$$;

-- ── Sources cited in answers that discuss one attribute ─────────────────────
-- Response-level association: answers carrying at least one theme of the
-- attribute → the domains those answers cite (same domain rule as
-- company_domain_stats_mv: canonical citations, lowercased, leading www.
-- stripped). NOT a claim that the source caused the sentiment.
CREATE OR REPLACE FUNCTION public.mcp_get_attribute_sources(
  p_company_ids uuid[],
  p_attribute_id text,
  p_buckets text[] DEFAULT NULL,
  p_months date[] DEFAULT NULL,
  p_limit int DEFAULT 10
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ids AS (
    SELECT DISTINCT t.response_id AS id
    FROM public.ai_themes t
    WHERE t.company_id = ANY (p_company_ids)
      AND lower(btrim(t.attribute_id)) = lower(btrim(p_attribute_id))
  ),
  resp AS (
    SELECT pr.id, COALESCE(pr.canonical_citations, pr.citations) AS cites
    FROM ids
    JOIN public.prompt_responses pr ON pr.id = ids.id
    JOIN public.confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
    WHERE pr.ai_model NOT IN ('claude','gemini','deepseek')
      AND pr.for_index IS NOT TRUE
      AND (p_months IS NULL OR COALESCE(pr.response_month, date_trunc('month', pr.tested_at)::date) = ANY (p_months))
      AND (p_buckets IS NULL OR COALESCE(NULLIF(btrim(cp.location_context), ''), '') = ANY (p_buckets))
  ),
  cites AS (
    SELECT r.id, lower(regexp_replace(c.value->>'domain', '^www\.', '')) AS domain
    FROM resp r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.cites) = 'array' THEN r.cites ELSE '[]'::jsonb END) c(value)
    WHERE COALESCE(c.value->>'domain', '') <> ''
  ),
  ranked AS (
    SELECT domain, count(DISTINCT id) AS answers_citing
    FROM cites
    GROUP BY domain
    ORDER BY answers_citing DESC, domain
    LIMIT LEAST(GREATEST(p_limit, 1), 50)
  )
  SELECT jsonb_build_object(
    'attribute_answers', (SELECT count(*) FROM resp),
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.answers_citing DESC, x.domain) FROM ranked x), '[]'::jsonb)
  );
$$;

-- ── Grants: service_role ONLY ───────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.mcp_get_measurement_periods(uuid[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_get_rollups(uuid[], text[], date[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_get_theme_stats(uuid[], text[], date[], int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_get_attribute_sources(uuid[], text, text[], date[], int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_get_measurement_periods(uuid[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_get_rollups(uuid[], text[], date[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_get_theme_stats(uuid[], text[], date[], int) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_get_attribute_sources(uuid[], text, text[], date[], int) TO service_role;
