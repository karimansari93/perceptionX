-- Page-grain citation cube for the px-tools layer (MCP + in-app chat).
--
-- 20260903170000 computed page-level links at request time from a random
-- sample of answers. On Ford's brand scope over four quarters that scan ran
-- ~20 s (the pool walk touches every answer's heap row), right at the
-- service-role statement budget. This cube precomputes the same figures the
-- way company_domain_stats_mv does (same filters, same domain rule, same
-- refresh pipeline), so the read is an index lookup and page shares are
-- complete rather than sampled: a page's % of answers is directly
-- comparable with its domain's.
--
-- Grain: company × domain × url × month × location. URLs are normalized
-- (fragment, tracking params and trailing slash dropped). The title is the
-- most frequent real title; placeholders ("Source from glassdoor.com") and
-- a URL echoed as its own title become NULL and the executors show the URL.
--
-- mcp_get_attribute_sources keeps its sampled request-time scan: its pool is
-- one attribute's answers (small, index-fed), and a cube cannot be cut by
-- attribute.

CREATE OR REPLACE FUNCTION public.mcp_clean_cited_title(p_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN cleaned = '' OR cleaned ~* '^https?://' OR cleaned ~* '^source from ' THEN NULL
    ELSE cleaned
  END
  FROM (SELECT regexp_replace(btrim(COALESCE(p_title, '')), '\s*Opens in new tab\.?$', '') AS cleaned) t
$$;

CREATE TABLE IF NOT EXISTS public.company_page_stats_mv (
  company_id        uuid   NOT NULL,
  domain            text   NOT NULL,
  url               text   NOT NULL,
  response_month    date   NOT NULL,
  location_context  text   NOT NULL DEFAULT '',
  responses_citing  bigint NOT NULL DEFAULT 0,
  title             text,
  calculated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_page_stats_company_month
  ON public.company_page_stats_mv (company_id, response_month);

ALTER TABLE public.company_page_stats_mv ENABLE ROW LEVEL SECURITY;
-- No policies: reads go through the SECURITY DEFINER RPC only.

CREATE OR REPLACE FUNCTION public._refresh_cm_page_stats(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_page_stats_mv', 0));
  DELETE FROM public.company_page_stats_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_page_stats_mv
    (company_id, domain, url, response_month, location_context, responses_citing, title, calculated_at)
  WITH rows AS (
    SELECT pr.id, pr.company_id,
           COALESCE(pr.response_month, date_trunc('month', pr.tested_at)::date) AS response_month,
           COALESCE(NULLIF(btrim(cp.location_context), ''), '') AS location_context,
           COALESCE(pr.canonical_citations, pr.citations) AS cites
    FROM prompt_responses pr
    JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
    WHERE pr.company_id IS NOT NULL AND pr.tested_at IS NOT NULL
      AND pr.ai_model NOT IN ('claude','gemini','deepseek')
      AND lower(COALESCE(btrim(cp.attribute_id), '')) <> 'overall-candidate-experience'
      AND lower(COALESCE(btrim(cp.prompt_theme), '')) <> 'overall candidate experience'
      AND (p_company_id IS NULL OR pr.company_id = p_company_id)
  ),
  cites AS (
    SELECT r.id, r.company_id, r.response_month, r.location_context,
           lower(regexp_replace(c.value->>'domain', '^www\.', '')) AS domain,
           public.mcp_normalize_cited_url(c.value->>'url') AS url,
           public.mcp_clean_cited_title(c.value->>'title') AS title
    FROM rows r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.cites) = 'array' THEN r.cites ELSE '[]'::jsonb END) c(value)
    WHERE COALESCE(c.value->>'domain','') <> ''
      AND COALESCE(c.value->>'url','') <> ''
  )
  SELECT company_id, domain, url, response_month, location_context,
         count(DISTINCT id) AS responses_citing,
         mode() WITHIN GROUP (ORDER BY title) FILTER (WHERE title IS NOT NULL) AS title,
         now() AS calculated_at
  FROM cites
  WHERE url IS NOT NULL
  GROUP BY company_id, domain, url, response_month, location_context;
END $$;

-- Pipeline registration: dispatch, per-company refresh, full rebuild list.
CREATE OR REPLACE FUNCTION public._refresh_cm_dispatch(p_mv_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  CASE p_mv_name
    WHEN 'company_sentiment_scores_mv'          THEN PERFORM public._refresh_cm_sentiment_scores(NULL);
    WHEN 'company_relevance_scores_mv'          THEN PERFORM public._refresh_cm_relevance_scores(NULL);
    WHEN 'company_top_sources_mv'               THEN PERFORM public._refresh_cm_top_sources(NULL);
    WHEN 'company_competitors_mv'               THEN PERFORM public._refresh_cm_competitors(NULL);
    WHEN 'company_llm_rankings_mv'              THEN PERFORM public._refresh_cm_llm_rankings(NULL);
    WHEN 'company_attribute_themes_mv'          THEN PERFORM public._refresh_cm_attribute_themes(NULL);
    WHEN 'company_response_sentiment_mv'        THEN PERFORM public._refresh_cm_response_sentiment(NULL);
    WHEN 'company_scope_stats_mv'               THEN PERFORM public._refresh_cm_scope_stats(NULL);
    WHEN 'company_scope_daily_stats_mv'         THEN PERFORM public._refresh_cm_scope_daily_stats(NULL);
    WHEN 'company_scope_prompt_type_stats_mv'   THEN PERFORM public._refresh_cm_scope_prompt_type_stats(NULL);
    WHEN 'company_llm_stats_mv'                 THEN PERFORM public._refresh_cm_llm_stats(NULL);
    WHEN 'company_domain_stats_mv'              THEN PERFORM public._refresh_cm_domain_stats(NULL);
    WHEN 'company_competitor_stats_mv'          THEN PERFORM public._refresh_cm_competitor_stats(NULL);
    WHEN 'company_page_stats_mv'                THEN PERFORM public._refresh_cm_page_stats(NULL);
    ELSE EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I', p_mv_name);
  END CASE;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_company_metrics(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'p_company_id is required; use refresh_company_metrics() for a full rebuild';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('refresh_company_metrics:' || p_company_id::text, 0));
  PERFORM public._refresh_cm_sentiment_scores(p_company_id);
  PERFORM public._refresh_cm_relevance_scores(p_company_id);
  PERFORM public._refresh_cm_top_sources(p_company_id);
  PERFORM public._refresh_cm_competitors(p_company_id);
  PERFORM public._refresh_cm_llm_rankings(p_company_id);
  PERFORM public._refresh_cm_attribute_themes(p_company_id);
  PERFORM public._refresh_cm_response_sentiment(p_company_id);
  PERFORM public._refresh_cm_scope_stats(p_company_id);
  PERFORM public._refresh_cm_scope_daily_stats(p_company_id);
  PERFORM public._refresh_cm_scope_prompt_type_stats(p_company_id);
  PERFORM public._refresh_cm_llm_stats(p_company_id);
  PERFORM public._refresh_cm_domain_stats(p_company_id);
  PERFORM public._refresh_cm_competitor_stats(p_company_id);
  PERFORM public._refresh_cm_page_stats(p_company_id);
  DELETE FROM public.company_metrics_dirty WHERE company_id = p_company_id;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_company_metrics()
RETURNS TABLE(view_name text, refresh_started timestamptz, refresh_completed timestamptz, success boolean, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_mv    text;
  v_start timestamptz;
BEGIN
  FOREACH v_mv IN ARRAY ARRAY[
    'company_sentiment_scores_mv','company_relevance_scores_mv','company_top_sources_mv',
    'company_competitors_mv','company_llm_rankings_mv','company_attribute_themes_mv',
    'company_response_sentiment_mv',
    'company_scope_stats_mv','company_scope_daily_stats_mv',
    'company_scope_prompt_type_stats_mv','company_llm_stats_mv','company_domain_stats_mv',
    'company_competitor_stats_mv','company_page_stats_mv',
    'company_sentiment_scores_by_location_mv','company_relevance_scores_by_location_mv',
    'company_attribute_themes_by_location_mv','company_top_sources_by_location_mv',
    'company_competitors_by_location_mv','company_llm_rankings_by_location_mv'
  ] LOOP
    v_start := now();
    BEGIN
      PERFORM public._refresh_cm_dispatch(v_mv);
      RETURN QUERY SELECT v_mv, v_start, now(), TRUE, NULL::text;
    EXCEPTION WHEN OTHERS THEN
      RETURN QUERY SELECT v_mv, v_start, now(), FALSE, SQLERRM;
    END;
  END LOOP;
END $$;

-- The read: an index lookup on the cube, complete counts, same denominator
-- as the domain cube. Signature unchanged from 20260903170000.
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
  WITH pages AS (
    SELECT s.domain, s.url,
           sum(s.responses_citing) AS answers_citing,
           (array_agg(s.title ORDER BY s.responses_citing DESC) FILTER (WHERE s.title IS NOT NULL))[1] AS title
    FROM public.company_page_stats_mv s
    WHERE s.company_id = ANY (p_company_ids)
      AND (p_months IS NULL OR s.response_month = ANY (p_months))
      AND (p_buckets IS NULL OR s.location_context = ANY (p_buckets))
      AND (p_domain IS NULL OR s.domain = lower(regexp_replace(btrim(p_domain), '^www\.', '')))
    GROUP BY s.domain, s.url
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
    'data_as_of', (SELECT max(s.calculated_at) FROM public.company_page_stats_mv s WHERE s.company_id = ANY (p_company_ids)),
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.answers_citing DESC, x.url) FROM picked x), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.mcp_get_cited_pages(uuid[], text[], date[], text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_get_cited_pages(uuid[], text[], date[], text, int, int) TO service_role;
