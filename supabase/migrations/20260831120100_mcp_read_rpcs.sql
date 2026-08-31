-- =============================================================================
-- Service-role read RPCs for the shared data-tool layer (chat + MCP server).
--
-- Why these exist: the dashboard's composite RPCs (get_dashboard_rollups,
-- get_domain_stats, …) guard through accessible_company_ids(), which resolves
-- membership for auth.uid(). The MCP/chat executors run as the SERVICE ROLE
-- on behalf of an OAuth/PAT principal — auth.uid() is NULL there, so those
-- guards would return empty. These twins take explicit company ids instead;
-- the edge function has ALREADY validated that every id belongs to the
-- token's organization (validateCompanyOwnership / resolveBrandScope) before
-- calling. They are executable by service_role ONLY — REVOKEd from every
-- client-facing role — so the app-layer check remains the single boundary.
--
-- Semantics deliberately mirror the dashboard RPCs they twin (same cubes,
-- same filters, same model exclusions) so chat/MCP numbers match the app.
-- =============================================================================

-- ── Distinct location buckets for a scope (drives fuzzy location matching) ──
CREATE OR REPLACE FUNCTION public.mcp_list_location_buckets(p_company_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(DISTINCT t.location_context ORDER BY t.location_context), '[]'::jsonb)
  FROM public.company_scope_stats_mv t
  WHERE t.company_id = ANY (p_company_ids)
    AND t.location_context <> '';
$$;

-- ── Core rollups: visibility / sentiment / model split / attribute themes ───
-- One call returns everything the insight tools aggregate from. Families:
--   scope_stats      → company_scope_stats_mv rows (visibility + theme counts
--                      + citation totals, month × job-function × location)
--   llm_stats        → company_llm_stats_mv rows (per-model totals/mentions)
--   attribute_themes → by-location cube when p_buckets is given (matches the
--                      dashboard's location view), company-wide cube otherwise
--   data_as_of       → max(calculated_at) over the scope's stats rows
-- Row caps are defensive only; real volumes are a few hundred rows per scope.
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
    'data_as_of', (
      SELECT max(t.calculated_at)
      FROM public.company_scope_stats_mv t
      WHERE t.company_id = ANY (p_company_ids)
    )
  );
$$;

-- ── Domain stats twin (canonical citations; month grain; top-N domains) ─────
-- Mirrors public.get_domain_stats with p_keep_functions=false.
CREATE OR REPLACE FUNCTION public.mcp_get_domain_stats(
  p_company_ids uuid[],
  p_buckets text[] DEFAULT NULL,
  p_months date[] DEFAULT NULL,
  p_limit int DEFAULT 100
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH filtered AS (
    SELECT t.domain, t.response_month,
           sum(t.responses_citing) AS responses_citing,
           sum(t.mentioned_responses_citing) AS mentioned_responses_citing,
           sum(t.citation_count) AS citation_count
    FROM public.company_domain_stats_mv t
    WHERE t.company_id = ANY (p_company_ids)
      AND (p_buckets IS NULL OR t.location_context = ANY (p_buckets))
      AND (p_months IS NULL OR t.response_month = ANY (p_months))
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
    'domain_total', (SELECT count(DISTINCT domain) FROM filtered),
    'data_as_of', (
      SELECT max(t.calculated_at) FROM public.company_domain_stats_mv t
      WHERE t.company_id = ANY (p_company_ids)
    )
  );
$$;

-- ── Competitor stats twin (month × prompt_type kept, jf collapsed) ──────────
CREATE OR REPLACE FUNCTION public.mcp_get_competitor_stats(
  p_company_ids uuid[],
  p_buckets text[] DEFAULT NULL,
  p_months date[] DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH filtered AS (
    SELECT t.competitor_name, t.response_month, t.prompt_type,
           sum(t.responses_mentioning) AS responses_mentioning,
           sum(t.co_mentions) AS co_mentions
    FROM public.company_competitor_stats_mv t
    WHERE t.company_id = ANY (p_company_ids)
      AND (p_buckets IS NULL OR t.location_context = ANY (p_buckets))
      AND (p_months IS NULL OR t.response_month = ANY (p_months))
    GROUP BY 1, 2, 3
  ),
  top_competitors AS (
    SELECT competitor_name
    FROM filtered
    GROUP BY competitor_name
    ORDER BY sum(responses_mentioning) DESC, competitor_name
    LIMIT LEAST(GREATEST(p_limit, 1), 500)
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'competitor_name', f.competitor_name, 'response_month', f.response_month,
        'prompt_type', f.prompt_type,
        'responses_mentioning', f.responses_mentioning, 'co_mentions', f.co_mentions))
      FROM filtered f
      JOIN top_competitors d ON d.competitor_name = f.competitor_name
    ), '[]'::jsonb),
    'competitor_total', (SELECT count(DISTINCT competitor_name) FROM filtered),
    'data_as_of', (
      SELECT max(t.calculated_at) FROM public.company_competitor_stats_mv t
      WHERE t.company_id = ANY (p_company_ids)
    )
  );
$$;

-- ── Attribute-scoped competitor share of voice ──────────────────────────────
-- "Who gets named when <attribute> comes up?" — competitors extracted from
-- canonical_competitors on responses whose PROMPT carries the attribute
-- (methodology v2 rows only; attribute_id is NULL on v1 prompts, which the
-- envelope must caveat). This is share-of-voice on attribute prompts, NOT
-- competitor sentiment — competitor_themes (forward-accruing) is the future
-- sentiment source and is read separately by the executor.
CREATE OR REPLACE FUNCTION public.mcp_get_attribute_competitors(
  p_company_ids uuid[],
  p_attribute_id text,
  p_self_name text DEFAULT NULL,
  p_buckets text[] DEFAULT NULL,
  p_months date[] DEFAULT NULL,
  p_limit int DEFAULT 25
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT pr.id,
           COALESCE(pr.response_month, date_trunc('month', pr.tested_at)::date) AS response_month,
           pr.canonical_competitors
    FROM public.prompt_responses pr
    JOIN public.confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
    WHERE pr.company_id = ANY (p_company_ids)
      AND pr.for_index IS NOT TRUE
      AND pr.ai_model NOT IN ('claude','gemini','deepseek')
      AND lower(COALESCE(btrim(cp.attribute_id), '')) = lower(btrim(p_attribute_id))
      AND (p_buckets IS NULL OR COALESCE(NULLIF(btrim(cp.location_context), ''), '') = ANY (p_buckets))
      AND (p_months IS NULL OR COALESCE(pr.response_month, date_trunc('month', pr.tested_at)::date) = ANY (p_months))
  ),
  names AS (
    SELECT b.id, btrim(unnest(string_to_array(b.canonical_competitors, ','))) AS competitor_name
    FROM base b
    WHERE b.canonical_competitors IS NOT NULL AND b.canonical_competitors <> ''
  ),
  counted AS (
    SELECT n.competitor_name, count(DISTINCT n.id) AS responses_naming
    FROM names n
    WHERE n.competitor_name <> ''
      AND (p_self_name IS NULL OR NOT (
        n.competitor_name ~* ('\m' || regexp_replace(p_self_name, '([.^$|()\[\]{}*+?\\])', '\\\1', 'g') || '\M')
        OR lower(n.competitor_name) = lower(p_self_name)
      ))
    GROUP BY n.competitor_name
    ORDER BY responses_naming DESC, n.competitor_name
    LIMIT LEAST(GREATEST(p_limit, 1), 200)
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM counted c), '[]'::jsonb),
    'attribute_responses', (SELECT count(*) FROM base),
    'attribute_responses_with_competitors', (SELECT count(DISTINCT id) FROM names)
  );
$$;

-- ── Grants: service_role ONLY ───────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.mcp_list_location_buckets(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_get_rollups(uuid[], text[], date[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_get_domain_stats(uuid[], text[], date[], int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_get_competitor_stats(uuid[], text[], date[], int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_get_attribute_competitors(uuid[], text, text, text[], date[], int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_list_location_buckets(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_get_rollups(uuid[], text[], date[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_get_domain_stats(uuid[], text[], date[], int) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_get_competitor_stats(uuid[], text[], date[], int) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_get_attribute_competitors(uuid[], text, text, text[], date[], int) TO service_role;
