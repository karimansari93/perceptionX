-- =============================================================================
-- Company MVs: scope to org responses, normalize domains, schedule hourly refresh
-- =============================================================================
--
-- Context
-- -------
-- Three materialized views back the dashboard's "top sources", "top competitors",
-- and "LLM mention rankings" widgets:
--
--   * company_top_sources_mv
--   * company_competitors_mv
--   * company_llm_rankings_mv
--
-- They are wrapped by RLS-enforcing views (same name without `_mv`) that
-- filter rows through the `company_members` table. The frontend
-- (`useDashboardData.fetchMVData`) always reads the wrapping views and always
-- constrains by `company_id = currentCompany.id`.
--
-- Two problems with the current state:
--
-- 1. INDUSTRY-WIDE NOISE IN ORG-SCOPED MVs.
--    Responses inserted by `collect-industry-visibility` have
--    `company_id = NULL` and `for_index = true`. The MVs do `GROUP BY company_id`
--    without filtering these out, so they bucket ~12k (top_sources) and ~30k
--    (competitors) rows into a NULL company_id that no consumer reads but
--    that still grows the MV and slows every refresh.
--
-- 2. NO DOMAIN NORMALIZATION in `company_top_sources_mv`.
--    The MV stores whatever string is in `citation.domain` — so
--    `youtube.com` (11,359 citations) and `www.youtube.com` appear as
--    separate rows. Same for `jobs.netflix.com` (17,981 combined) and many
--    others. The Overview tab's top-sources list is silently undercounting
--    the real leaders today.
--
-- 3. NOT ON A REFRESH SCHEDULE.
--    The existing hourly cron job `refresh-company-metrics-every-hour` only
--    refreshes sentiment + relevance. These three MVs only refresh when
--    something manually triggers them, so they go stale quickly.
--
-- This migration fixes all three. It:
--
--   * Drops + recreates each MV with the `company_id IS NOT NULL` +
--     `for_index IS NOT TRUE` filter.
--   * Rebuilds `company_top_sources_mv` with normalized domain
--     (lowercased, `www.` stripped).
--   * Recreates the RLS-wrapping views on top of the new MVs.
--   * Extends the refresh function so the hourly cron also refreshes these.
--
-- Nothing else reads these MVs directly; confirmed via pg_depend —
-- the only dependents are the wrapper views.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Drop wrapper views + MVs (must drop wrappers first — they reference MVs)
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.company_top_sources;
DROP VIEW IF EXISTS public.company_competitors;
DROP VIEW IF EXISTS public.company_llm_rankings;

DROP MATERIALIZED VIEW IF EXISTS public.company_top_sources_mv;
DROP MATERIALIZED VIEW IF EXISTS public.company_competitors_mv;
DROP MATERIALIZED VIEW IF EXISTS public.company_llm_rankings_mv;


-- -----------------------------------------------------------------------------
-- 2. Recreate company_top_sources_mv
--    - Filter to org-scoped, non-industry responses
--    - Normalize domain (lower + strip www.)
--    - Ignore empty / invalid domains
-- -----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW public.company_top_sources_mv AS
WITH unnested AS (
    SELECT
        pr.company_id,
        LOWER(REGEXP_REPLACE(c.value ->> 'domain', '^www\.', '')) AS domain,
        c.value ->> 'url' AS url
    FROM public.prompt_responses pr,
         LATERAL jsonb_array_elements(pr.citations) c(value)
    WHERE pr.company_id IS NOT NULL
      AND pr.for_index IS NOT TRUE
      AND jsonb_typeof(pr.citations) = 'array'
      AND c.value ->> 'domain' IS NOT NULL
      AND c.value ->> 'domain' <> ''
)
SELECT
    company_id,
    domain,
    MIN(url) AS sample_url,
    COUNT(*) AS citation_count,
    ROUND(
        (COUNT(*)::numeric / SUM(COUNT(*)) OVER (PARTITION BY company_id)) * 100,
        1
    ) AS pct_of_total
FROM unnested
WHERE domain <> ''
GROUP BY company_id, domain;

CREATE UNIQUE INDEX company_top_sources_mv_unique_idx
    ON public.company_top_sources_mv (company_id, domain);

CREATE INDEX company_top_sources_mv_count_idx
    ON public.company_top_sources_mv (company_id, citation_count DESC);


-- -----------------------------------------------------------------------------
-- 3. Recreate company_competitors_mv
--    - Same content as before PLUS company_id IS NOT NULL + for_index filter
--    - Noise-word blacklist preserved verbatim
-- -----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW public.company_competitors_mv AS
WITH competitor_mentions AS (
    SELECT
        pr.company_id,
        TRIM(BOTH FROM LOWER(UNNEST(STRING_TO_ARRAY(pr.detected_competitors, ',')))) AS competitor_name
    FROM public.prompt_responses pr
    WHERE pr.company_id IS NOT NULL
      AND pr.for_index IS NOT TRUE
      AND pr.detected_competitors IS NOT NULL
      AND pr.detected_competitors <> ''
),
filtered AS (
    SELECT
        cm.company_id,
        cm.competitor_name
    FROM competitor_mentions cm
    WHERE cm.competitor_name <> ''
      AND LENGTH(cm.competitor_name) > 1
      -- Non-competitor domains that frequently appear as detected "competitors"
      AND cm.competitor_name <> ALL (ARRAY[
          'glassdoor', 'indeed', 'ambitionbox', 'workday', 'linkedin',
          'monster', 'careerbuilder', 'ziprecruiter', 'dice', 'angelist',
          'wellfound', 'builtin', 'stackoverflow', 'github'
      ])
      -- Common noise strings that LLMs produce when they don't know a competitor
      AND cm.competitor_name <> ALL (ARRAY[
          'none', 'n/a', 'na', 'null', 'undefined',
          'none.', 'none,', 'none:', 'none;', 'none)', 'none]', 'none}', 'none-', 'none_',
          'n/a.', 'n/a,', 'n/a:', 'n/a;', 'n/a)', 'n/a]', 'n/a}', 'n/a-', 'n/a_',
          'na.', 'na,', 'na:', 'na;', 'na)', 'na]', 'na}', 'na-', 'na_',
          'null.', 'null,', 'null:', 'null;', 'null)', 'null]', 'null}', 'null-', 'null_',
          'undefined.', 'undefined,', 'undefined:', 'undefined;', 'undefined)',
          'undefined]', 'undefined}', 'undefined-', 'undefined_'
      ])
      AND cm.competitor_name !~ '^[0-9]+$'
      AND cm.competitor_name ~ '[a-z0-9]'
      AND NOT (LENGTH(cm.competitor_name) <= 2 AND cm.competitor_name ~ '^[a-z]{1,2}$')
)
SELECT
    company_id,
    competitor_name,
    COUNT(*) AS mention_count
FROM filtered
GROUP BY company_id, competitor_name;

CREATE UNIQUE INDEX company_competitors_mv_unique_idx
    ON public.company_competitors_mv (company_id, competitor_name);

CREATE INDEX company_competitors_mv_count_idx
    ON public.company_competitors_mv (company_id, mention_count DESC);


-- -----------------------------------------------------------------------------
-- 4. Recreate company_llm_rankings_mv
--    - Same shape, adds company_id IS NOT NULL + for_index filter
-- -----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW public.company_llm_rankings_mv AS
SELECT
    company_id,
    ai_model,
    COUNT(*) AS total_responses,
    COUNT(*) FILTER (WHERE company_mentioned = true) AS mentions,
    ROUND(
        ((COUNT(*) FILTER (WHERE company_mentioned = true))::numeric /
         NULLIF(COUNT(*), 0)::numeric) * 100,
        1
    ) AS mention_pct
FROM public.prompt_responses
WHERE company_id IS NOT NULL
  AND for_index IS NOT TRUE
  AND ai_model IS NOT NULL
GROUP BY company_id, ai_model;

CREATE UNIQUE INDEX company_llm_rankings_mv_unique_idx
    ON public.company_llm_rankings_mv (company_id, ai_model);


-- -----------------------------------------------------------------------------
-- 5. Recreate the RLS-enforcing wrapper views
--    Same definitions they had before — only the underlying MVs changed.
-- -----------------------------------------------------------------------------
CREATE VIEW public.company_top_sources AS
SELECT company_id, domain, sample_url, citation_count, pct_of_total
FROM public.company_top_sources_mv s
WHERE EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE cm.company_id = s.company_id AND cm.user_id = (SELECT auth.uid())
);

CREATE VIEW public.company_competitors AS
SELECT company_id, competitor_name, mention_count
FROM public.company_competitors_mv c
WHERE EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE cm.company_id = c.company_id AND cm.user_id = (SELECT auth.uid())
);

CREATE VIEW public.company_llm_rankings AS
SELECT company_id, ai_model, total_responses, mentions, mention_pct
FROM public.company_llm_rankings_mv r
WHERE EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE cm.company_id = r.company_id AND cm.user_id = (SELECT auth.uid())
);


-- -----------------------------------------------------------------------------
-- 6. Grants
-- -----------------------------------------------------------------------------
GRANT SELECT ON public.company_top_sources_mv TO authenticated;
GRANT SELECT ON public.company_competitors_mv TO authenticated;
GRANT SELECT ON public.company_llm_rankings_mv TO authenticated;

GRANT SELECT ON public.company_top_sources TO authenticated;
GRANT SELECT ON public.company_competitors TO authenticated;
GRANT SELECT ON public.company_llm_rankings TO authenticated;


-- -----------------------------------------------------------------------------
-- 7. Extend the refresh function to also refresh these three MVs
--    The existing hourly cron calls `refresh_company_metrics()`, so adding
--    the new refreshes here wires them into the same schedule automatically.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_company_metrics()
RETURNS TABLE (
    view_name TEXT,
    refresh_started TIMESTAMPTZ,
    refresh_completed TIMESTAMPTZ,
    success BOOLEAN,
    error_message TEXT
) AS $$
DECLARE
    v_start_time TIMESTAMPTZ;
    v_end_time TIMESTAMPTZ;
    v_error TEXT;
BEGIN
    -- Existing: sentiment scores
    v_start_time := NOW();
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY company_sentiment_scores_mv;
        v_end_time := NOW();
        RETURN QUERY SELECT 'company_sentiment_scores_mv'::TEXT, v_start_time, v_end_time, TRUE, NULL::TEXT;
    EXCEPTION WHEN OTHERS THEN
        v_end_time := NOW(); v_error := SQLERRM;
        RETURN QUERY SELECT 'company_sentiment_scores_mv'::TEXT, v_start_time, v_end_time, FALSE, v_error;
    END;

    -- Existing: relevance scores
    v_start_time := NOW();
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY company_relevance_scores_mv;
        v_end_time := NOW();
        RETURN QUERY SELECT 'company_relevance_scores_mv'::TEXT, v_start_time, v_end_time, TRUE, NULL::TEXT;
    EXCEPTION WHEN OTHERS THEN
        v_end_time := NOW(); v_error := SQLERRM;
        RETURN QUERY SELECT 'company_relevance_scores_mv'::TEXT, v_start_time, v_end_time, FALSE, v_error;
    END;

    -- New: top sources
    v_start_time := NOW();
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY company_top_sources_mv;
        v_end_time := NOW();
        RETURN QUERY SELECT 'company_top_sources_mv'::TEXT, v_start_time, v_end_time, TRUE, NULL::TEXT;
    EXCEPTION WHEN OTHERS THEN
        v_end_time := NOW(); v_error := SQLERRM;
        RETURN QUERY SELECT 'company_top_sources_mv'::TEXT, v_start_time, v_end_time, FALSE, v_error;
    END;

    -- New: competitors
    v_start_time := NOW();
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY company_competitors_mv;
        v_end_time := NOW();
        RETURN QUERY SELECT 'company_competitors_mv'::TEXT, v_start_time, v_end_time, TRUE, NULL::TEXT;
    EXCEPTION WHEN OTHERS THEN
        v_end_time := NOW(); v_error := SQLERRM;
        RETURN QUERY SELECT 'company_competitors_mv'::TEXT, v_start_time, v_end_time, FALSE, v_error;
    END;

    -- New: LLM rankings
    v_start_time := NOW();
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY company_llm_rankings_mv;
        v_end_time := NOW();
        RETURN QUERY SELECT 'company_llm_rankings_mv'::TEXT, v_start_time, v_end_time, TRUE, NULL::TEXT;
    EXCEPTION WHEN OTHERS THEN
        v_end_time := NOW(); v_error := SQLERRM;
        RETURN QUERY SELECT 'company_llm_rankings_mv'::TEXT, v_start_time, v_end_time, FALSE, v_error;
    END;
END;
$$ LANGUAGE plpgsql;


-- -----------------------------------------------------------------------------
-- 8. Initial population. The first refresh on a new MV must be non-CONCURRENT
--    to populate the unique index.
-- -----------------------------------------------------------------------------
REFRESH MATERIALIZED VIEW public.company_top_sources_mv;
REFRESH MATERIALIZED VIEW public.company_competitors_mv;
REFRESH MATERIALIZED VIEW public.company_llm_rankings_mv;


-- -----------------------------------------------------------------------------
-- 9. Comments
-- -----------------------------------------------------------------------------
COMMENT ON MATERIALIZED VIEW public.company_top_sources_mv IS
    'Pre-aggregated citation counts per (company_id, normalized domain). Only org-scoped responses (company_id IS NOT NULL AND for_index IS NOT TRUE). Refresh via refresh_company_metrics().';

COMMENT ON MATERIALIZED VIEW public.company_competitors_mv IS
    'Pre-aggregated competitor mentions per (company_id, competitor_name). Only org-scoped responses. Has an inline blacklist of noise strings and non-competitor platforms. Refresh via refresh_company_metrics().';

COMMENT ON MATERIALIZED VIEW public.company_llm_rankings_mv IS
    'Pre-aggregated model-level mention counts per (company_id, ai_model). Only org-scoped responses. Refresh via refresh_company_metrics().';

COMMIT;
