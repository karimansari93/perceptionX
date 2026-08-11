-- Dashboard composite rollups: one RPC call replaces the ~112 per-company,
-- per-family, per-page PostgREST requests the dashboard issued on every
-- company switch (9 rollup families × N sibling profiles × offset pages).
--
-- Measured on the Ford org (18 sibling profiles): the rollup families alone
-- were 112 REST round-trips ≈ 10 MB and 30+ seconds of cumulative request
-- time through the client's 6-slot gate. This function returns the same rows
-- in a single round-trip, and is cheap server-side because every family table
-- is already indexed on (company_id, ...).
--
-- SECURITY DEFINER with an explicit org-membership guard replaces per-request
-- RLS evaluation. The guard intersects the requested ids with the caller's
-- accessible companies (platform admins pass through), so a caller can never
-- read a tenant they don't belong to — the same guarantee the RLS policies
-- ("Org members can read their companies") give on direct table reads.

CREATE OR REPLACE FUNCTION public.accessible_company_ids(p_company_ids uuid[])
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN (SELECT public.is_admin()) THEN p_company_ids
    ELSE ARRAY(
      SELECT oc.company_id
      FROM organization_companies oc
      JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE om.user_id = (SELECT auth.uid())
        AND oc.company_id = ANY (p_company_ids)
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.accessible_company_ids(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accessible_company_ids(uuid[]) TO authenticated, service_role;

-- Company-wide rollups for a brand scope (the current company plus its
-- same-name, same-org sibling profiles). Shapes mirror exactly what the
-- dashboard consumed via PostgREST so the client aggregation code is unchanged:
--   sentiment / relevance          → full MV rows
--   top_sources / competitors      → per-company top 200 by count
--   llm_rankings                   → all rows (ai_model, mentions)
--   attribute_themes               → rollup columns per attribute × month × function
--   visibility                     → all location buckets for the scope
--   location_buckets               → distinct location_context spellings (all-time)
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
      SELECT jsonb_agg(to_jsonb(t))
      FROM company_sentiment_scores_mv t
      WHERE t.company_id IN (SELECT company_id FROM ids)
    ), '[]'::jsonb),
    'relevance', COALESCE((
      SELECT jsonb_agg(to_jsonb(t))
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

REVOKE ALL ON FUNCTION public.get_dashboard_rollups(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_rollups(uuid[]) TO authenticated, service_role;

-- Location-scoped rollups: one call replaces the 6-family × N-company × pages
-- fan-out that ran on every country switch (measured: 119 REST round-trips).
-- "Owned" profiles (the country's own company rows) read a widened bucket
-- list (untagged + GLOBAL-like + the selection's raw spellings); "other"
-- sibling profiles read only the selection's spellings. The client keeps its
-- canonicalization post-filter — rows return location_context untouched.
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
      SELECT jsonb_agg(to_jsonb(t))
      FROM jobs j
      JOIN company_sentiment_scores_by_location_mv t
        ON t.company_id = j.company_id AND t.location_context = ANY (j.buckets)
    ), '[]'::jsonb),
    'relevance', COALESCE((
      SELECT jsonb_agg(to_jsonb(t))
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

REVOKE ALL ON FUNCTION public.get_location_rollups(uuid[], text[], uuid[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_location_rollups(uuid[], text[], uuid[], text[]) TO authenticated, service_role;

-- Scope prompts in one call. Direct confirmed_prompts reads pay a hidden RLS
-- tax: the select policy's `id IN (SELECT confirmed_prompt_id FROM
-- prompt_responses WHERE for_index)` arm builds a hashed subplan over the
-- for_index subset on EVERY request (measured 548 ms mean, 7.8 s max). The
-- explicit membership guard here preserves tenant isolation without that
-- per-request rebuild.
CREATE OR REPLACE FUNCTION public.get_scope_prompts(p_company_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', t.id, 'user_id', t.user_id, 'prompt_text', t.prompt_text,
      'company_id', t.company_id, 'prompt_category', t.prompt_category,
      'prompt_theme', t.prompt_theme, 'prompt_type', t.prompt_type,
      'industry_context', t.industry_context, 'job_function_context', t.job_function_context,
      'location_context', t.location_context, 'attribute_id', t.attribute_id))
    FROM confirmed_prompts t
    WHERE t.company_id = ANY (public.accessible_company_ids(p_company_ids))
  ), '[]'::jsonb);
$$;

REVOKE ALL ON FUNCTION public.get_scope_prompts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_scope_prompts(uuid[]) TO authenticated, service_role;
