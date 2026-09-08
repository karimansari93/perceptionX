-- mcp_get_theme_stats, sampled — and a plain index for the quotes read.
--
-- Live eval on the Ford brand scope (18 profiles, Q3 2026 ≈ 19k answers,
-- 58k theme rows): the first version joined EVERY theme row of the scope
-- to its answer to apply the period/market/model filters — 127k index
-- lookups on prompt_responses plus a 16k-block ai_themes scan — and hit
-- the 8 s PostgREST statement budget on every call (get_themes returned a
-- tool error; get_company_overview and get_model_breakdown silently lost
-- their theme data).
--
-- Now: the answers in scope are found from indexes only (ai_themes by
-- company, narrowed by market through the prompt ids), a uniform random
-- sample of up to 3,000 is drawn, THEN the period/model filters and the
-- theme join run on the sample. Theme shares are "of the sampled answers";
-- the payload reports answers_sampled and the executors label it.
--
-- idx_ai_themes_company_attribute_plain serves the PostgREST quotes read
-- in get_attribute_themes (.in(company_id).eq(attribute_id).order(created_at)),
-- which cannot use the expression index; built CONCURRENTLY by hand first.
CREATE INDEX IF NOT EXISTS idx_ai_themes_company_attribute_plain
  ON public.ai_themes (company_id, attribute_id, created_at DESC);

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
    SELECT id FROM pool ORDER BY random() LIMIT 3000
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

REVOKE ALL ON FUNCTION public.mcp_get_theme_stats(uuid[], text[], date[], int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_get_theme_stats(uuid[], text[], date[], int) TO service_role;
