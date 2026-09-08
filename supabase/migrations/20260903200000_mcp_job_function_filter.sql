-- Job-function filter for the px-tools reads (MCP + in-app chat).
--
-- 91% of Ford's Q3 2026 answers carry a job function (Finance 15%,
-- Marketing & Sales 12%, Human Resources 11%, ...), every cube stores it at
-- its grain and the dashboard filters on it — but the tools only exposed
-- `location`, so a host model asked "how does AI describe Ford for
-- engineers?" had no way to narrow and answered brand-wide. Every read RPC
-- gains p_job_functions text[] (NULL = all functions), matched the way
-- markets are: a bucket lister plus fuzzy matching in the executor.
--
-- Signatures change, so the old overloads are dropped first — PostgREST
-- resolves RPCs by named parameters and two candidates would be ambiguous.
-- The page cube has no job-function grain; with a job-function filter,
-- mcp_get_cited_pages falls back to a random sample of the filtered answers
-- and says so (answers_sampled).

DROP FUNCTION IF EXISTS public.mcp_get_measurement_periods(uuid[], text[]);
DROP FUNCTION IF EXISTS public.mcp_get_rollups(uuid[], text[], date[]);
DROP FUNCTION IF EXISTS public.mcp_get_domain_stats(uuid[], text[], date[], integer);
DROP FUNCTION IF EXISTS public.mcp_get_competitor_stats(uuid[], text[], date[], integer);
DROP FUNCTION IF EXISTS public.mcp_get_attribute_competitors(uuid[], text, text, text[], date[], integer);
DROP FUNCTION IF EXISTS public.mcp_get_theme_stats(uuid[], text[], date[], integer);
DROP FUNCTION IF EXISTS public.mcp_get_attribute_sources(uuid[], text, text[], date[], integer);
DROP FUNCTION IF EXISTS public.mcp_get_cited_pages(uuid[], text[], date[], text, integer, integer);

-- ─── Bucket lister ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mcp_list_job_function_buckets(p_company_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(DISTINCT t.job_function_context ORDER BY t.job_function_context), '[]'::jsonb)
  FROM public.company_scope_stats_mv t
  WHERE t.company_id = ANY (p_company_ids)
    AND t.job_function_context <> '';
$$;

-- ─── Measurement periods ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mcp_get_measurement_periods(
  p_company_ids uuid[],
  p_buckets text[] DEFAULT NULL,
  p_job_functions text[] DEFAULT NULL
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
          AND (p_job_functions IS NULL OR t.job_function_context = ANY (p_job_functions))
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

-- ─── Rollups ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mcp_get_rollups(
  p_company_ids uuid[],
  p_buckets text[] DEFAULT NULL,
  p_months date[] DEFAULT NULL,
  p_job_functions text[] DEFAULT NULL
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
          AND (p_job_functions IS NULL OR t.job_function_context = ANY (p_job_functions))
          AND (p_months IS NULL OR t.response_month = ANY (p_months))
        LIMIT 8000
      ) s
    ), '[]'::jsonb),
    'llm_stats', COALESCE((
      SELECT jsonb_agg(to_jsonb(s)) FROM (
        SELECT t.ai_model, t.response_month, t.location_context, t.job_function_context,
               t.total_responses, t.mentions
        FROM public.company_llm_stats_mv t
        WHERE t.company_id = ANY (p_company_ids)
          AND (p_buckets IS NULL OR t.location_context = ANY (p_buckets))
          AND (p_job_functions IS NULL OR t.job_function_context = ANY (p_job_functions))
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
          AND (p_job_functions IS NULL OR t.job_function_context = ANY (p_job_functions))
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
          AND (p_job_functions IS NULL OR t.job_function_context = ANY (p_job_functions))
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
          AND (p_job_functions IS NULL OR t.job_function_context = ANY (p_job_functions))
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
          AND (p_job_functions IS NULL OR t.job_function_context = ANY (p_job_functions))
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

-- ─── Domain stats ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mcp_get_domain_stats(
  p_company_ids uuid[],
  p_buckets text[] DEFAULT NULL,
  p_months date[] DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_job_functions text[] DEFAULT NULL
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
      AND (p_job_functions IS NULL OR t.job_function_context = ANY (p_job_functions))
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

-- ─── Competitor stats ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mcp_get_competitor_stats(
  p_company_ids uuid[],
  p_buckets text[] DEFAULT NULL,
  p_months date[] DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_job_functions text[] DEFAULT NULL
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
      AND (p_job_functions IS NULL OR t.job_function_context = ANY (p_job_functions))
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

-- ─── Attribute competitors (share of voice on an attribute) ─────────────────
CREATE OR REPLACE FUNCTION public.mcp_get_attribute_competitors(
  p_company_ids uuid[],
  p_attribute_id text,
  p_self_name text DEFAULT NULL,
  p_buckets text[] DEFAULT NULL,
  p_months date[] DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_job_functions text[] DEFAULT NULL
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
      AND (p_job_functions IS NULL OR COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') = ANY (p_job_functions))
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

-- ─── Theme stats (sampled) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mcp_get_theme_stats(
  p_company_ids uuid[],
  p_buckets text[] DEFAULT NULL,
  p_months date[] DEFAULT NULL,
  p_limit integer DEFAULT 30,
  p_job_functions text[] DEFAULT NULL
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
      AND (p_job_functions IS NULL OR COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') = ANY (p_job_functions))
  ),
  pool AS (
    SELECT DISTINCT t.response_id AS id
    FROM public.ai_themes t
    WHERE t.company_id = ANY (p_company_ids)
      AND ((p_buckets IS NULL AND p_job_functions IS NULL) OR t.response_id IN (
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

-- ─── Attribute sources (sampled, with top pages) ────────────────────────────
CREATE OR REPLACE FUNCTION public.mcp_get_attribute_sources(
  p_company_ids uuid[],
  p_attribute_id text,
  p_buckets text[] DEFAULT NULL,
  p_months date[] DEFAULT NULL,
  p_limit integer DEFAULT 10,
  p_job_functions text[] DEFAULT NULL
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
      AND (p_job_functions IS NULL OR COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') = ANY (p_job_functions))
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
           mode() WITHIN GROUP (ORDER BY c.title) FILTER (WHERE c.title IS NOT NULL) AS title
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

-- ─── Cited pages: cube when unfiltered by job function, sampled otherwise ───
CREATE OR REPLACE FUNCTION public.mcp_get_cited_pages(
  p_company_ids uuid[],
  p_buckets text[] DEFAULT NULL,
  p_months date[] DEFAULT NULL,
  p_domain text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_per_domain integer DEFAULT 3,
  p_job_functions text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH cube_pages AS (
    SELECT s.domain, s.url,
           sum(s.responses_citing) AS answers_citing,
           (array_agg(s.title ORDER BY s.responses_citing DESC) FILTER (WHERE s.title IS NOT NULL))[1] AS title
    FROM public.company_page_stats_mv s
    WHERE p_job_functions IS NULL
      AND s.company_id = ANY (p_company_ids)
      AND (p_months IS NULL OR s.response_month = ANY (p_months))
      AND (p_buckets IS NULL OR s.location_context = ANY (p_buckets))
      AND (p_domain IS NULL OR s.domain = lower(regexp_replace(btrim(p_domain), '^www\.', '')))
    GROUP BY s.domain, s.url
  ),
  live_pool AS (
    SELECT pr.id
    FROM public.prompt_responses pr
    JOIN public.confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
    WHERE p_job_functions IS NOT NULL
      AND pr.company_id = ANY (p_company_ids)
      AND pr.tested_at IS NOT NULL
      AND pr.ai_model NOT IN ('claude','gemini','deepseek')
      AND lower(COALESCE(btrim(cp.attribute_id), '')) <> 'overall-candidate-experience'
      AND lower(COALESCE(btrim(cp.prompt_theme), '')) <> 'overall candidate experience'
      AND (p_months IS NULL OR COALESCE(pr.response_month, date_trunc('month', pr.tested_at)::date) = ANY (p_months))
      AND (p_buckets IS NULL OR COALESCE(NULLIF(btrim(cp.location_context), ''), '') = ANY (p_buckets))
      AND COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') = ANY (p_job_functions)
  ),
  live_sampled AS (
    SELECT id FROM live_pool ORDER BY random() LIMIT 1500
  ),
  live_resp AS (
    SELECT pr.id, COALESCE(pr.canonical_citations, pr.citations) AS cites
    FROM live_sampled s
    JOIN public.prompt_responses pr ON pr.id = s.id
  ),
  live_cites AS (
    SELECT r.id,
           lower(regexp_replace(c.value->>'domain', '^www\.', '')) AS domain,
           public.mcp_normalize_cited_url(c.value->>'url') AS url,
           public.mcp_clean_cited_title(c.value->>'title') AS title
    FROM live_resp r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.cites) = 'array' THEN r.cites ELSE '[]'::jsonb END) c(value)
    WHERE COALESCE(c.value->>'domain', '') <> ''
      AND COALESCE(c.value->>'url', '') <> ''
  ),
  live_pages AS (
    SELECT domain, url,
           count(DISTINCT id) AS answers_citing,
           mode() WITHIN GROUP (ORDER BY title) FILTER (WHERE title IS NOT NULL) AS title
    FROM live_cites
    WHERE url IS NOT NULL
      AND (p_domain IS NULL OR domain = lower(regexp_replace(btrim(p_domain), '^www\.', '')))
    GROUP BY domain, url
  ),
  pages AS (
    SELECT domain, url, answers_citing, title FROM cube_pages
    UNION ALL
    SELECT domain, url, answers_citing, title FROM live_pages
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
    'distinct_pages', (SELECT count(*) FROM pages),
    'answers_sampled', (SELECT count(*) FROM live_resp),
    'pool_answers', (SELECT count(*) FROM live_pool),
    'data_as_of', (SELECT max(s.calculated_at) FROM public.company_page_stats_mv s WHERE s.company_id = ANY (p_company_ids)),
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.answers_citing DESC, x.url) FROM picked x), '[]'::jsonb)
  );
$$;

-- ─── Grants ─────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.mcp_list_job_function_buckets(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_get_measurement_periods(uuid[], text[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_get_rollups(uuid[], text[], date[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_get_domain_stats(uuid[], text[], date[], integer, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_get_competitor_stats(uuid[], text[], date[], integer, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_get_attribute_competitors(uuid[], text, text, text[], date[], integer, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_get_theme_stats(uuid[], text[], date[], integer, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_get_attribute_sources(uuid[], text, text[], date[], integer, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_get_cited_pages(uuid[], text[], date[], text, integer, integer, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_list_job_function_buckets(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_get_measurement_periods(uuid[], text[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_get_rollups(uuid[], text[], date[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_get_domain_stats(uuid[], text[], date[], integer, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_get_competitor_stats(uuid[], text[], date[], integer, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_get_attribute_competitors(uuid[], text, text, text[], date[], integer, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_get_theme_stats(uuid[], text[], date[], integer, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_get_attribute_sources(uuid[], text, text[], date[], integer, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_get_cited_pages(uuid[], text[], date[], text, integer, integer, text[]) TO service_role;
