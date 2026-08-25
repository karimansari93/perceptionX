-- Phase 1 of the dashboard data-diet (2026-08-25 incident follow-up):
-- shrink what the two hot dashboard RPCs put on the wire, changing nothing
-- about the shapes the client reads.
--
-- Measured on the largest response corpus (8.7k rows), per 1000-row page:
-- citations are 2.6 MB of the 3.2 MB payload (81%). Each citation object
-- carries seven keys, but the dashboard's Citation type (and every consumer,
-- audited 2026-08-25) reads only url / domain / title — and `title` is the
-- url string verbatim on the vast majority of rows, `type` is the constant
-- "website", and confidence / canonical_name / canonical_domain are pipeline
-- metadata no client code reads. Slimming each object to url + domain
-- (+ title only when it differs from url) cuts citation wire bytes to ~67%
-- with zero client changes.
--
-- get_dashboard_rollups' sentiment/relevance families returned to_jsonb(t)
-- full MV rows; the client aggregators read only the metric columns plus
-- response_month and job_function_context. Typed lists drop the unread
-- prompt_type / prompt_category / prompt_theme / industry_context /
-- calculated_at / citation_coverage_percentage / sentiment_ratio / company_id
-- baggage (verified unread in every client revision since the composite-RPC
-- refactor these functions shipped with). Same for get_location_rollups,
-- which additionally keeps location_context (the client's canonicalization
-- post-filter reads it).

-- Order-preserving per-element slim. Non-array input and non-object elements
-- pass through untouched (legacy citation payloads can be strings).
CREATE OR REPLACE FUNCTION public.slim_citation_list(p jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p IS NULL OR jsonb_typeof(p) <> 'array' THEN p
    ELSE COALESCE((
      SELECT jsonb_agg(
        CASE
          WHEN jsonb_typeof(e) <> 'object' THEN e
          ELSE jsonb_build_object('url', e->>'url', 'domain', e->>'domain')
               || CASE WHEN (e->>'title') IS NOT NULL AND e->>'title' IS DISTINCT FROM e->>'url'
                       THEN jsonb_build_object('title', e->>'title')
                       ELSE '{}'::jsonb END
        END
        ORDER BY ord)
      FROM jsonb_array_elements(p) WITH ORDINALITY AS t(e, ord)
    ), '[]'::jsonb)
  END;
$$;

-- Same body as 20260811120000, with citations passed through the slimmer.
CREATE OR REPLACE FUNCTION public.get_company_responses_page(
  p_company_id uuid,
  p_excluded_models text[] DEFAULT '{}',
  p_since timestamptz DEFAULT NULL,
  p_before_tested_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit int DEFAULT 1000
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
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
      -- COALESCE bounds (not `param IS NULL OR ...`) so the generic plan keeps
      -- a tight (company_id, tested_at) index range: measured 37 ms/page vs
      -- 2.4 s with the OR form.
      AND pr.tested_at >= COALESCE(p_since, '-infinity'::timestamptz)
      AND pr.tested_at <= COALESCE(p_before_tested_at, 'infinity'::timestamptz)
      AND NOT (pr.ai_model = ANY (p_excluded_models))
      -- Keyset boundary: drop rows at the cursor's tested_at already returned.
      AND (
        p_before_tested_at IS NULL
        OR pr.tested_at < p_before_tested_at
        OR pr.id < p_before_id
      )
    ORDER BY pr.tested_at DESC, pr.id DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 2000)
  ) page;
$$;

-- Same body as 20260811090000, with sentiment/relevance as typed lists.
CREATE OR REPLACE FUNCTION public.get_dashboard_rollups(p_company_ids uuid[])
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
    'sentiment', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'response_month', t.response_month,
        'job_function_context', t.job_function_context,
        'total_themes', t.total_themes,
        'positive_themes', t.positive_themes,
        'negative_themes', t.negative_themes,
        'neutral_themes', t.neutral_themes,
        'avg_sentiment_score', t.avg_sentiment_score))
      FROM company_sentiment_scores_mv t
      WHERE t.company_id IN (SELECT company_id FROM ids)
    ), '[]'::jsonb),
    'relevance', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'response_month', t.response_month,
        'job_function_context', t.job_function_context,
        'total_citations', t.total_citations,
        'valid_citations', t.valid_citations,
        'relevance_score', t.relevance_score))
      FROM company_relevance_scores_mv t
      WHERE t.company_id IN (SELECT company_id FROM ids)
    ), '[]'::jsonb),
    'top_sources', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('domain', s.domain, 'citation_count', s.citation_count))
      FROM ids i
      CROSS JOIN LATERAL (
        SELECT t.domain, t.citation_count
        FROM company_top_sources_mv t
        WHERE t.company_id = i.company_id
        ORDER BY t.citation_count DESC
        LIMIT 200
      ) s
    ), '[]'::jsonb),
    'competitors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('competitor_name', s.competitor_name, 'mention_count', s.mention_count))
      FROM ids i
      CROSS JOIN LATERAL (
        SELECT t.competitor_name, t.mention_count
        FROM company_competitors_mv t
        WHERE t.company_id = i.company_id
        ORDER BY t.mention_count DESC
        LIMIT 200
      ) s
    ), '[]'::jsonb),
    'llm_rankings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('ai_model', t.ai_model, 'mentions', t.mentions))
      FROM company_llm_rankings_mv t
      WHERE t.company_id IN (SELECT company_id FROM ids)
    ), '[]'::jsonb),
    'attribute_themes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'attribute_id', t.attribute_id, 'response_month', t.response_month,
        'job_function_context', t.job_function_context, 'total_themes', t.total_themes,
        'positive_themes', t.positive_themes, 'negative_themes', t.negative_themes,
        'neutral_themes', t.neutral_themes, 'avg_sentiment_score', t.avg_sentiment_score,
        'response_count', t.response_count))
      FROM company_attribute_themes_mv t
      WHERE t.company_id IN (SELECT company_id FROM ids)
    ), '[]'::jsonb),
    'visibility', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'company_id', t.company_id, 'location_context', t.location_context,
        'response_month', t.response_month, 'job_function_context', t.job_function_context,
        'total_responses', t.total_responses, 'mentioned_responses', t.mentioned_responses))
      FROM company_visibility_by_location_mv t
      WHERE t.company_id IN (SELECT company_id FROM ids)
    ), '[]'::jsonb),
    'location_buckets', COALESCE((
      SELECT jsonb_agg(DISTINCT COALESCE(t.location_context, ''))
      FROM company_llm_rankings_by_location_mv t
      WHERE t.company_id IN (SELECT company_id FROM ids)
    ), '[]'::jsonb)
  );
$$;

-- Same body as 20260811090000, with sentiment/relevance as typed lists
-- (location_context kept: the client's canonicalization post-filter reads it).
CREATE OR REPLACE FUNCTION public.get_location_rollups(
  p_owned_ids uuid[],
  p_owned_buckets text[],
  p_other_ids uuid[],
  p_other_buckets text[]
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
  )
  SELECT jsonb_build_object(
    'sentiment', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'location_context', t.location_context,
        'response_month', t.response_month,
        'job_function_context', t.job_function_context,
        'total_themes', t.total_themes,
        'positive_themes', t.positive_themes,
        'negative_themes', t.negative_themes,
        'neutral_themes', t.neutral_themes,
        'avg_sentiment_score', t.avg_sentiment_score))
      FROM jobs j
      JOIN company_sentiment_scores_by_location_mv t
        ON t.company_id = j.company_id AND t.location_context = ANY (j.buckets)
    ), '[]'::jsonb),
    'relevance', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'location_context', t.location_context,
        'response_month', t.response_month,
        'job_function_context', t.job_function_context,
        'total_citations', t.total_citations,
        'valid_citations', t.valid_citations,
        'relevance_score', t.relevance_score))
      FROM jobs j
      JOIN company_relevance_scores_by_location_mv t
        ON t.company_id = j.company_id AND t.location_context = ANY (j.buckets)
    ), '[]'::jsonb),
    'top_sources', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'domain', t.domain, 'citation_count', t.citation_count, 'location_context', t.location_context))
      FROM jobs j
      JOIN company_top_sources_by_location_mv t
        ON t.company_id = j.company_id AND t.location_context = ANY (j.buckets)
    ), '[]'::jsonb),
    'competitors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'competitor_name', t.competitor_name, 'mention_count', t.mention_count, 'location_context', t.location_context))
      FROM jobs j
      JOIN company_competitors_by_location_mv t
        ON t.company_id = j.company_id AND t.location_context = ANY (j.buckets)
    ), '[]'::jsonb),
    'llm_rankings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'ai_model', t.ai_model, 'mentions', t.mentions, 'location_context', t.location_context))
      FROM jobs j
      JOIN company_llm_rankings_by_location_mv t
        ON t.company_id = j.company_id AND t.location_context = ANY (j.buckets)
    ), '[]'::jsonb),
    'attribute_themes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'attribute_id', t.attribute_id, 'response_month', t.response_month,
        'job_function_context', t.job_function_context, 'total_themes', t.total_themes,
        'positive_themes', t.positive_themes, 'negative_themes', t.negative_themes,
        'neutral_themes', t.neutral_themes, 'avg_sentiment_score', t.avg_sentiment_score,
        'response_count', t.response_count, 'location_context', t.location_context))
      FROM jobs j
      JOIN company_attribute_themes_by_location_mv t
        ON t.company_id = j.company_id AND t.location_context = ANY (j.buckets)
    ), '[]'::jsonb)
  );
$$;
