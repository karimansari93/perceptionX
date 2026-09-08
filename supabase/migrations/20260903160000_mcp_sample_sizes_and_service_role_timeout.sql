-- Cold-cache follow-up to the sampled px-tools reads.
--
-- The sampled reads are cheap on a warm cache (theme stats: 1.7 s on the
-- Ford brand scope) but each sampled answer is a random heap page of
-- prompt_responses, so a cold call costs ~4 blocks per sampled row:
-- 3,000 rows ≈ 12k reads ≈ 30 s on this storage. Two knobs:
--
--   1. Smaller samples (theme stats 3,000 → 1,500; attribute sources
--      2,000 → 1,500). Theme shares stay stable to a couple of points.
--   2. A 20 s statement budget for service_role. The edge functions reach
--      Postgres through PostgREST as `authenticator` (statement_timeout=8s
--      at login) and impersonate `service_role`, which had no setting of
--      its own — so the 8 s login default applied to every RPC. PostgREST
--      applies the impersonated role's settings per transaction, so this
--      raises the budget for service-role calls only; anon (3 s) and
--      authenticated (8 s) are untouched.
ALTER ROLE service_role SET statement_timeout = '20s';

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
  WITH scope_prompts AS (
    SELECT cp.id
    FROM public.confirmed_prompts cp
    WHERE cp.company_id = ANY (p_company_ids)
      AND (p_buckets IS NULL OR COALESCE(NULLIF(btrim(cp.location_context), ''), '') = ANY (p_buckets))
  ),
  pool AS (
    SELECT DISTINCT t.response_id AS id
    FROM public.ai_themes t
    WHERE t.company_id = ANY (p_company_ids)
      AND (p_buckets IS NULL OR t.response_id IN (
            SELECT pr.id FROM public.prompt_responses pr
            WHERE pr.confirmed_prompt_id IN (SELECT id FROM scope_prompts)))
  ),
  sampled AS (
    SELECT id FROM pool ORDER BY random() LIMIT 1500
  ),
  answers AS (
    SELECT pr.id, pr.ai_model
    FROM sampled s
    JOIN public.prompt_responses pr ON pr.id = s.id
    WHERE pr.ai_model NOT IN ('claude','gemini','deepseek')
      AND pr.for_index IS NOT TRUE
      AND (p_months IS NULL OR COALESCE(pr.response_month, date_trunc('month', pr.tested_at)::date) = ANY (p_months))
  ),
  base AS (
    SELECT t.response_id, t.theme_name, t.sentiment,
           NULLIF(btrim(t.attribute_id), '') AS attribute_id,
           t.theme_description, t.keywords, t.context_snippets,
           a.ai_model
    FROM answers a
    JOIN public.ai_themes t ON t.response_id = a.id
    WHERE t.theme_name IS NOT NULL
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
    'answers_sampled', (SELECT count(*) FROM answers),
    'pool_answers', (SELECT count(*) FROM pool),
    'responses_with_themes', (SELECT count(DISTINCT response_id) FROM base),
    'theme_total', (SELECT count(DISTINCT theme_name) FROM base)
  );
$$;

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
    SELECT id FROM pool ORDER BY random() LIMIT 1500
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
