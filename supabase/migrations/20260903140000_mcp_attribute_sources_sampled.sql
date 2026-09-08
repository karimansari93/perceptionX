-- mcp_get_attribute_sources, sampled.
--
-- The first version exploded the citation JSON of EVERY answer carrying a
-- theme of the attribute. On the Ford brand scope (18 profiles) that is
-- ~5k wide prompt_responses rows per quarter — ~15 s cold even with the
-- attribute index, past the 8 s statement budget the edge function's
-- PostgREST connection allows, so the tool silently returned no sources.
--
-- Now: a uniform random sample of up to 2,000 answers carrying the attribute
-- (drawn from the index-only pool, THEN filtered by period/market/model),
-- so the read touches at most 2,000 wide rows. Percentages are "of the
-- sampled answers"; the payload says so (answers_sampled + the pool size).
-- Same signature, so the executor's call shape is unchanged.
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
  WITH pool AS (
    SELECT t.response_id AS id
    FROM public.ai_themes t
    WHERE t.company_id = ANY (p_company_ids)
      AND lower(btrim(t.attribute_id)) = lower(btrim(p_attribute_id))
    GROUP BY t.response_id
  ),
  sampled AS (
    SELECT id FROM pool ORDER BY random() LIMIT 2000
  ),
  resp AS (
    SELECT pr.id, COALESCE(pr.canonical_citations, pr.citations) AS cites
    FROM sampled s
    JOIN public.prompt_responses pr ON pr.id = s.id
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
    'answers_sampled', (SELECT count(*) FROM resp),
    'attribute_answers_pool', (SELECT count(*) FROM pool),
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.answers_citing DESC, x.domain) FROM ranked x), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.mcp_get_attribute_sources(uuid[], text, text[], date[], int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_get_attribute_sources(uuid[], text, text[], date[], int) TO service_role;
