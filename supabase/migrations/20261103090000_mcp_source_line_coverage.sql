-- Source-line coverage: the share of answers citing ANY of a line's URLs.
--
-- Why this exists. A source line can fold several hosts into one platform
-- (in.linkedin.com + linkedin.com, glassdoor.co.in + glassdoor.com ...) or
-- carve a platform into "your pages and posts" and "other" by URL prefix.
-- company_domain_stats_mv and company_page_stats_mv count distinct answers
-- per host or per URL, and one answer often cites several of them, so their
-- counts cannot be added: the sum overstates coverage (and can pass 100%).
-- The only exact figure is a union of answers, which needs the answers
-- themselves.
--
-- What it does. One scan of prompt_responses scoped to the named companies
-- and months (never a whole-table scan), unnesting each answer's citations
-- once and testing every requested line against them. Filters and the
-- domain spelling are identical to _refresh_cm_domain_stats, so the
-- denominators match the domain cube and the scope cube.
--
-- Grouping is NOT decided here. The caller (TypeScript,
-- supabase/functions/_shared/source-platforms.ts) lists, per line, the raw
-- hosts as the cube spells them plus optional URL path rules:
--   { "key": "linkedin:owned",
--     "domains": ["linkedin.com", "in.linkedin.com"],
--     "include": [{"prefix": "/company/ford-india", "mode": "segment"}],
--     "exclude": null }
-- "include": only citations whose path matches one of the rules.
-- "exclude": every citation on those hosts except the ones that match.
-- Path rule modes: "raw" = plain string prefix (post slugs, "/posts/x_");
-- "segment" = equal to the prefix or continuing after a "/";
-- "wild" = the rule's "regex" (built in TypeScript from a pattern with "*",
-- e.g. "/*-e152871" for a Glassdoor employer ID at the end of the slug).
-- Paths are compared lower-cased, query and fragment dropped.
--
-- Load: one company-scoped read, bounded by the months passed. Ford
-- Business Solutions India is ~1.1k answers per quarter. The mcp_* readers
-- run under the service_role 20 s statement budget; callers skip this read
-- for scopes over ~15k answers rather than risk it.
--
-- Read-only and additive. Apply by hand (migrations do not deploy from main).

CREATE OR REPLACE FUNCTION public.mcp_path_matches(p_path text, p_prefix text, p_mode text, p_regex text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_mode = 'wild' THEN p_path ~ p_regex
    WHEN p_path = p_prefix THEN true
    WHEN p_mode = 'raw' THEN left(p_path, length(p_prefix)) = p_prefix
    ELSE left(p_path, length(p_prefix) + 1) = p_prefix || '/'
  END
$$;

CREATE OR REPLACE FUNCTION public.mcp_get_source_line_coverage(
  p_company_ids   uuid[],
  p_months        date[],
  p_lines         jsonb,
  p_buckets       text[] DEFAULT NULL,
  p_job_functions text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH lines AS (
    SELECT l.value->>'key' AS key,
           ARRAY(SELECT lower(x) FROM jsonb_array_elements_text(l.value->'domains') x) AS domains,
           CASE WHEN jsonb_typeof(l.value->'include') = 'array' THEN l.value->'include' END AS inc,
           CASE WHEN jsonb_typeof(l.value->'exclude') = 'array' THEN l.value->'exclude' END AS exc
    FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) l(value)
  ),
  resp AS (
    SELECT pr.id, pr.company_mentioned,
           COALESCE(pr.canonical_citations, pr.citations) AS cites
    FROM public.prompt_responses pr
    JOIN public.confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
    WHERE pr.company_id = ANY (p_company_ids)
      AND pr.tested_at IS NOT NULL
      AND COALESCE(pr.response_month, date_trunc('month', pr.tested_at)::date) = ANY (p_months)
      AND pr.ai_model NOT IN ('claude', 'gemini', 'deepseek')
      AND lower(COALESCE(btrim(cp.attribute_id), '')) <> 'overall-candidate-experience'
      AND lower(COALESCE(btrim(cp.prompt_theme), '')) <> 'overall candidate experience'
      AND (p_buckets IS NULL OR COALESCE(NULLIF(btrim(cp.location_context), ''), '') = ANY (p_buckets))
      AND (p_job_functions IS NULL OR COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') = ANY (p_job_functions))
  ),
  cites AS (
    SELECT r.id, r.company_mentioned,
           lower(regexp_replace(c.value->>'domain', '^www\.', '')) AS host,
           COALESCE(substring(lower(public.mcp_normalize_cited_url(c.value->>'url'))
                              from '^(?:[a-z][a-z0-9+.-]*:)?//[^/?#]*([^?#]*)'), '') AS path
    FROM resp r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.cites) = 'array' THEN r.cites ELSE '[]'::jsonb END) c(value)
    WHERE COALESCE(c.value->>'domain', '') <> ''
  ),
  hits AS (
    SELECT l.key, c.id, c.company_mentioned
    FROM cites c
    JOIN lines l ON c.host = ANY (l.domains)
    WHERE (l.inc IS NULL OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(l.inc) p
            WHERE public.mcp_path_matches(c.path, p->>'prefix', p->>'mode', p->>'regex')))
      AND (l.exc IS NULL OR NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(l.exc) p
            WHERE public.mcp_path_matches(c.path, p->>'prefix', p->>'mode', p->>'regex')))
  ),
  per_line AS (
    SELECT key,
           count(DISTINCT id) AS responses_citing,
           count(DISTINCT id) FILTER (WHERE company_mentioned = true) AS mentioned_responses_citing
    FROM hits
    GROUP BY key
  )
  SELECT jsonb_build_object(
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'key', l.key,
        'responses_citing', COALESCE(p.responses_citing, 0),
        'mentioned_responses_citing', COALESCE(p.mentioned_responses_citing, 0)))
      FROM lines l LEFT JOIN per_line p ON p.key = l.key
    ), '[]'::jsonb),
    'answers_in_scope', (SELECT count(*) FROM resp)
  );
$$;

REVOKE ALL ON FUNCTION public.mcp_get_source_line_coverage(uuid[], date[], jsonb, text[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_get_source_line_coverage(uuid[], date[], jsonb, text[], text[]) TO service_role;
REVOKE ALL ON FUNCTION public.mcp_path_matches(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_path_matches(text, text, text, text) TO service_role;
