-- Page-level citations for the px-tools layer (MCP + in-app chat).
--
-- A host model (ChatGPT) can only link what the tools hand it, and until
-- now every source read returned domains and shares only. The reads below
-- explode the citation JSON of a random sample of the scope's answers
-- (1,500, the same budget as theme stats) and return the most-cited page
-- URLs with their titles:
--
--   * mcp_get_cited_pages   — pages for a scope, optionally one domain,
--                             capped per domain so one site cannot crowd
--                             the list (get_sources / get_citations);
--   * mcp_get_attribute_sources now carries top_pages per domain from the
--                             same sampled scan (get_attribute_themes).
--
-- URLs are normalized (fragment and tracking params dropped, trailing
-- slash trimmed) so one page is counted once. Titles drop the
-- "Opens in new tab." suffix Google AI Overviews append and become NULL
-- when the source carried no real title (a URL echoed as its own title);
-- the executors then show the URL.

CREATE OR REPLACE FUNCTION public.mcp_normalize_cited_url(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT
AS $$
  SELECT NULLIF(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(btrim(p_url), '#.*$', ''),
            '([?&])(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|ref_src)=[^&]*', '\1', 'g'),
          '([?&])&+', '\1', 'g'),
        '[?&]+$', ''),
      '(.)/$', '\1'),
    '')
$$;

CREATE OR REPLACE FUNCTION public.mcp_clean_cited_title(p_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN cleaned = '' OR cleaned ~* '^https?://' THEN NULL
    ELSE cleaned
  END
  FROM (SELECT regexp_replace(btrim(COALESCE(p_title, '')), '\s*Opens in new tab\.?$', '') AS cleaned) t
$$;

CREATE OR REPLACE FUNCTION public.mcp_get_cited_pages(
  p_company_ids uuid[],
  p_buckets text[] DEFAULT NULL,
  p_months date[] DEFAULT NULL,
  p_domain text DEFAULT NULL,
  p_limit int DEFAULT 20,
  p_per_domain int DEFAULT 3
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH pool AS (
    SELECT pr.id
    FROM public.prompt_responses pr
    WHERE pr.company_id = ANY (p_company_ids)
      AND pr.ai_model NOT IN ('claude','gemini','deepseek')
      AND pr.for_index IS NOT TRUE
      AND (p_months IS NULL OR COALESCE(pr.response_month, date_trunc('month', pr.tested_at)::date) = ANY (p_months))
      AND (p_buckets IS NULL OR EXISTS (
            SELECT 1 FROM public.confirmed_prompts cp
            WHERE cp.id = pr.confirmed_prompt_id
              AND COALESCE(NULLIF(btrim(cp.location_context), ''), '') = ANY (p_buckets)))
  ),
  sampled AS (
    SELECT id FROM pool ORDER BY random() LIMIT 1500
  ),
  resp AS (
    SELECT pr.id, COALESCE(pr.canonical_citations, pr.citations) AS cites
    FROM sampled s
    JOIN public.prompt_responses pr ON pr.id = s.id
  ),
  cites AS (
    SELECT r.id,
           lower(regexp_replace(c.value->>'domain', '^www\.', '')) AS domain,
           public.mcp_normalize_cited_url(c.value->>'url') AS url,
           public.mcp_clean_cited_title(c.value->>'title') AS title
    FROM resp r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.cites) = 'array' THEN r.cites ELSE '[]'::jsonb END) c(value)
    WHERE COALESCE(c.value->>'domain', '') <> ''
      AND COALESCE(c.value->>'url', '') <> ''
      AND (p_domain IS NULL
           OR lower(regexp_replace(c.value->>'domain', '^www\.', ''))
              = lower(regexp_replace(btrim(p_domain), '^www\.', '')))
  ),
  pages AS (
    SELECT domain, url,
           count(DISTINCT id) AS answers_citing,
           mode() WITHIN GROUP (ORDER BY title) AS title
    FROM cites
    WHERE url IS NOT NULL
    GROUP BY domain, url
  ),
  ranked AS (
    SELECT p.*,
           row_number() OVER (PARTITION BY p.domain ORDER BY p.answers_citing DESC, p.url) AS rank_in_domain
    FROM pages p
  ),
  picked AS (
    SELECT domain, url, title, answers_citing
    FROM ranked
    WHERE rank_in_domain <= GREATEST(p_per_domain, 1)
    ORDER BY answers_citing DESC, url
    LIMIT LEAST(GREATEST(p_limit, 1), 300)
  )
  SELECT jsonb_build_object(
    'answers_sampled', (SELECT count(*) FROM resp),
    'pool_answers', (SELECT count(*) FROM pool),
    'distinct_pages', (SELECT count(*) FROM pages),
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.answers_citing DESC, x.url) FROM picked x), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.mcp_get_cited_pages(uuid[], text[], date[], text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_get_cited_pages(uuid[], text[], date[], text, int, int) TO service_role;

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
    SELECT r.id,
           lower(regexp_replace(c.value->>'domain', '^www\.', '')) AS domain,
           public.mcp_normalize_cited_url(c.value->>'url') AS url,
           public.mcp_clean_cited_title(c.value->>'title') AS title
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
  ),
  pages AS (
    SELECT c.domain, c.url,
           count(DISTINCT c.id) AS answers_citing,
           mode() WITHIN GROUP (ORDER BY c.title) AS title
    FROM cites c
    WHERE c.url IS NOT NULL
      AND c.domain IN (SELECT domain FROM ranked)
    GROUP BY c.domain, c.url
  ),
  page_rank AS (
    SELECT p.*,
           row_number() OVER (PARTITION BY p.domain ORDER BY p.answers_citing DESC, p.url) AS rank_in_domain
    FROM pages p
  )
  SELECT jsonb_build_object(
    'answers_sampled', (SELECT count(*) FROM resp),
    'attribute_answers_pool', (SELECT count(*) FROM pool),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.answers_citing DESC, x.domain)
      FROM (
        SELECT r.domain, r.answers_citing,
               COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('url', p.url, 'title', p.title, 'answers_citing', p.answers_citing)
                                  ORDER BY p.answers_citing DESC, p.url)
                 FROM page_rank p
                 WHERE p.domain = r.domain AND p.rank_in_domain <= 3
               ), '[]'::jsonb) AS top_pages
        FROM ranked r
      ) x
    ), '[]'::jsonb)
  );
$$;
