-- ============================================================================
-- Codify the by-location rollup materialized views (DB/repo drift fix)
-- ============================================================================
--
-- The flexible Location filter (commit 8d48689) reads six `company_*_by_location_mv`
-- views. Those views, their indexes, and the refresh function were created
-- directly in the production DB and never captured in a migration -- that drift
-- is part of why metrics regress silently (nothing in the repo describes the
-- objects the dashboard depends on).
--
-- This migration captures the five by-location MVs that are NOT already in a
-- migration (the sentiment one lives in 20260615120100), plus the canonical
-- `refresh_company_metrics()` body. Everything is idempotent:
--   - CREATE MATERIALIZED VIEW IF NOT EXISTS  -> no-op in prod, recreated on fresh envs
--   - CREATE [UNIQUE] INDEX IF NOT EXISTS     -> no-op in prod
--   - CREATE OR REPLACE FUNCTION             -> body is now version-controlled
--
-- No behavioural change in production. This is purely so the schema is
-- reproducible and reviewable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. company_relevance_scores_by_location_mv
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS public.company_relevance_scores_by_location_mv AS
WITH citation_urls AS (
  SELECT pr.id AS response_id,
         pr.company_id,
         pr.tested_at,
         cp.prompt_type,
         cp.prompt_category,
         cp.prompt_theme,
         COALESCE(cp.industry_context, c.industry) AS industry_context,
         COALESCE(cp.job_function_context, ''::text) AS job_function_context,
         COALESCE(NULLIF(btrim(cp.location_context), ''::text), ''::text) AS location_context,
         jsonb_array_elements(pr.citations) ->> 'url'::text AS citation_url,
         COALESCE((pr.collection_cycle::timestamp without time zone AT TIME ZONE 'UTC'::text),
                  date_trunc('month'::text, pr.tested_at)) AS response_month
  FROM prompt_responses pr
    JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
    JOIN companies c ON pr.company_id = c.id
  WHERE pr.citations IS NOT NULL
    AND jsonb_array_length(pr.citations) > 0
    AND pr.company_id IS NOT NULL
    AND pr.company_mentioned = true
), relevance_aggregated AS (
  SELECT cu.company_id,
         cu.location_context,
         cu.response_month,
         cu.prompt_type,
         cu.prompt_category,
         cu.prompt_theme,
         cu.industry_context,
         cu.job_function_context,
         count(DISTINCT cu.citation_url) AS total_citations,
         count(DISTINCT urc.url) FILTER (WHERE urc.recency_score IS NOT NULL) AS valid_citations,
         avg(urc.recency_score) FILTER (WHERE urc.recency_score IS NOT NULL) AS avg_relevance_score
  FROM citation_urls cu
    LEFT JOIN url_recency_cache urc ON cu.citation_url = urc.url
  GROUP BY cu.company_id, cu.location_context, cu.response_month, cu.prompt_type,
           cu.prompt_category, cu.prompt_theme, cu.industry_context, cu.job_function_context
)
SELECT company_id,
       location_context,
       response_month,
       prompt_type,
       prompt_category,
       prompt_theme,
       industry_context,
       job_function_context,
       total_citations,
       valid_citations,
       COALESCE(avg_relevance_score, 0::numeric) AS relevance_score,
       CASE WHEN total_citations > 0
            THEN valid_citations::numeric / total_citations::numeric * 100::numeric
            ELSE 0::numeric END AS citation_coverage_percentage,
       now() AS calculated_at
FROM relevance_aggregated
WHERE total_citations > 0;

CREATE UNIQUE INDEX IF NOT EXISTS company_relevance_by_location_mv_uniq
  ON public.company_relevance_scores_by_location_mv
  USING btree (company_id, location_context, response_month, prompt_type, prompt_category, prompt_theme, industry_context, job_function_context);
CREATE INDEX IF NOT EXISTS company_relevance_by_location_mv_lookup
  ON public.company_relevance_scores_by_location_mv
  USING btree (company_id, location_context, response_month DESC);

-- ---------------------------------------------------------------------------
-- 2. company_attribute_themes_by_location_mv
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS public.company_attribute_themes_by_location_mv AS
SELECT t.company_id,
       COALESCE(NULLIF(btrim(cp.location_context), ''::text), ''::text) AS location_context,
       date_trunc('month'::text, pr.tested_at)::date AS response_month,
       COALESCE(NULLIF(btrim(cp.job_function_context), ''::text), ''::text) AS job_function_context,
       btrim(t.attribute_id) AS attribute_id,
       count(*) AS total_themes,
       count(*) FILTER (WHERE t.sentiment = 'positive'::text) AS positive_themes,
       count(*) FILTER (WHERE t.sentiment = 'negative'::text) AS negative_themes,
       count(*) FILTER (WHERE t.sentiment = 'neutral'::text) AS neutral_themes,
       avg(t.sentiment_score) AS avg_sentiment_score,
       count(DISTINCT t.response_id) AS response_count,
       now() AS calculated_at
FROM ai_themes t
  JOIN prompt_responses pr ON pr.id = t.response_id
  JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
WHERE pr.tested_at IS NOT NULL
  AND btrim(t.attribute_id) = ANY (ARRAY[
    'mission-purpose','rewards-recognition','company-culture','social-impact','inclusion',
    'innovation','wellbeing-balance','leadership','security-perks','career-opportunities',
    'application-process','candidate-communication','interview-experience','candidate-feedback',
    'onboarding-experience','overall-candidate-experience'])
GROUP BY t.company_id,
         COALESCE(NULLIF(btrim(cp.location_context), ''::text), ''::text),
         date_trunc('month'::text, pr.tested_at),
         COALESCE(NULLIF(btrim(cp.job_function_context), ''::text), ''::text),
         btrim(t.attribute_id);

CREATE UNIQUE INDEX IF NOT EXISTS company_attribute_themes_by_location_mv_uniq
  ON public.company_attribute_themes_by_location_mv
  USING btree (company_id, location_context, response_month, job_function_context, attribute_id);
CREATE INDEX IF NOT EXISTS company_attribute_themes_by_location_mv_lookup
  ON public.company_attribute_themes_by_location_mv
  USING btree (company_id, location_context);

-- ---------------------------------------------------------------------------
-- 3. company_top_sources_by_location_mv
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS public.company_top_sources_by_location_mv AS
WITH unnested AS (
  SELECT pr.company_id,
         COALESCE(NULLIF(btrim(cp.location_context), ''::text), ''::text) AS location_context,
         lower(regexp_replace(c.value ->> 'domain'::text, '^www\.'::text, ''::text)) AS domain,
         c.value ->> 'url'::text AS url
  FROM prompt_responses pr
    JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
    CROSS JOIN LATERAL jsonb_array_elements(pr.citations) c(value)
  WHERE pr.company_id IS NOT NULL
    AND pr.for_index IS NOT TRUE
    AND jsonb_typeof(pr.citations) = 'array'::text
    AND (c.value ->> 'domain'::text) IS NOT NULL
    AND (c.value ->> 'domain'::text) <> ''::text
)
SELECT company_id,
       location_context,
       domain,
       min(url) AS sample_url,
       count(*) AS citation_count,
       round(count(*)::numeric / sum(count(*)) OVER (PARTITION BY company_id, location_context) * 100::numeric, 1) AS pct_of_total
FROM unnested
WHERE domain <> ''::text
GROUP BY company_id, location_context, domain;

CREATE UNIQUE INDEX IF NOT EXISTS company_top_sources_by_location_mv_uniq
  ON public.company_top_sources_by_location_mv
  USING btree (company_id, location_context, domain);
CREATE INDEX IF NOT EXISTS company_top_sources_by_location_mv_lookup
  ON public.company_top_sources_by_location_mv
  USING btree (company_id, location_context, citation_count DESC);

-- ---------------------------------------------------------------------------
-- 4. company_competitors_by_location_mv
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS public.company_competitors_by_location_mv AS
WITH raw AS (
  SELECT pr.company_id,
         COALESCE(NULLIF(btrim(cp.location_context), ''::text), ''::text) AS location_context,
         normalize_entity_name(btrim(unnest(string_to_array(pr.detected_competitors, ','::text)))) AS normalized_alias
  FROM prompt_responses pr
    JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
  WHERE pr.company_id IS NOT NULL
    AND pr.for_index IS NOT TRUE
    AND pr.detected_competitors IS NOT NULL
    AND pr.detected_competitors <> ''::text
), mapped AS (
  SELECT r.company_id,
         r.location_context,
         COALESCE(ce.canonical_name, initcap(r.normalized_alias)) AS competitor_name,
         ce.is_active
  FROM raw r
    LEFT JOIN entity_aliases ea ON ea.normalized_alias = r.normalized_alias
    LEFT JOIN canonical_entities ce ON ce.id = ea.canonical_id
  WHERE r.normalized_alias IS NOT NULL
    AND r.normalized_alias <> ''::text
    AND length(r.normalized_alias) > 1
    AND (r.normalized_alias <> ALL (ARRAY['glassdoor','indeed','ambitionbox','workday','linkedin','monster','careerbuilder','ziprecruiter','dice','angelist','wellfound','builtin','stackoverflow','github']))
    AND (r.normalized_alias <> ALL (ARRAY['none','n/a','na','null','undefined']))
    AND r.normalized_alias !~ '^[0-9]+$'::text
    AND r.normalized_alias ~ '[a-z0-9]'::text
    AND NOT (length(r.normalized_alias) <= 2 AND r.normalized_alias ~ '^[a-z]{1,2}$'::text)
)
SELECT company_id,
       location_context,
       competitor_name,
       count(*) AS mention_count
FROM mapped
WHERE is_active IS NOT FALSE
GROUP BY company_id, location_context, competitor_name;

CREATE UNIQUE INDEX IF NOT EXISTS company_competitors_by_location_mv_uniq
  ON public.company_competitors_by_location_mv
  USING btree (company_id, location_context, competitor_name);
CREATE INDEX IF NOT EXISTS company_competitors_by_location_mv_lookup
  ON public.company_competitors_by_location_mv
  USING btree (company_id, location_context, mention_count DESC);

-- ---------------------------------------------------------------------------
-- 5. company_llm_rankings_by_location_mv
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS public.company_llm_rankings_by_location_mv AS
SELECT pr.company_id,
       COALESCE(NULLIF(btrim(cp.location_context), ''::text), ''::text) AS location_context,
       pr.ai_model,
       count(*) AS total_responses,
       count(*) FILTER (WHERE pr.company_mentioned = true) AS mentions,
       round(count(*) FILTER (WHERE pr.company_mentioned = true)::numeric / NULLIF(count(*), 0)::numeric * 100::numeric, 1) AS mention_pct
FROM prompt_responses pr
  JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
WHERE pr.company_id IS NOT NULL
  AND pr.for_index IS NOT TRUE
  AND pr.ai_model IS NOT NULL
GROUP BY pr.company_id,
         COALESCE(NULLIF(btrim(cp.location_context), ''::text), ''::text),
         pr.ai_model;

CREATE UNIQUE INDEX IF NOT EXISTS company_llm_rankings_by_location_mv_uniq
  ON public.company_llm_rankings_by_location_mv
  USING btree (company_id, location_context, ai_model);
CREATE INDEX IF NOT EXISTS company_llm_rankings_by_location_mv_lookup
  ON public.company_llm_rankings_by_location_mv
  USING btree (company_id, location_context, mentions DESC);

-- ---------------------------------------------------------------------------
-- 6. Canonical refresh_company_metrics() body (version-controlled).
--    Unchanged behaviour from prod: refreshes all 13 rollup MVs CONCURRENTLY,
--    one at a time, recording per-view success/error. NOTE: this is no longer
--    on the hot path and is no longer the primary refresh mechanism -- the
--    staleness tick (next migration) is. Kept for full/manual rebuilds.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_company_metrics()
RETURNS TABLE(view_name text, refresh_started timestamptz, refresh_completed timestamptz, success boolean, error_message text)
LANGUAGE plpgsql
AS $function$
DECLARE
    v_start_time TIMESTAMPTZ;
    v_end_time TIMESTAMPTZ;
    v_error TEXT;
    v_mv TEXT;
BEGIN
    FOREACH v_mv IN ARRAY ARRAY[
        'company_sentiment_scores_mv',
        'company_relevance_scores_mv',
        'company_top_sources_mv',
        'company_competitors_mv',
        'company_llm_rankings_mv',
        'company_attribute_themes_mv',
        'company_response_sentiment_mv',
        'company_sentiment_scores_by_location_mv',
        'company_relevance_scores_by_location_mv',
        'company_attribute_themes_by_location_mv',
        'company_top_sources_by_location_mv',
        'company_competitors_by_location_mv',
        'company_llm_rankings_by_location_mv'
    ]
    LOOP
        v_start_time := NOW();
        BEGIN
            EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I', v_mv);
            v_end_time := NOW();
            RETURN QUERY SELECT v_mv, v_start_time, v_end_time, TRUE, NULL::TEXT;
        EXCEPTION WHEN OTHERS THEN
            v_end_time := NOW(); v_error := SQLERRM;
            RETURN QUERY SELECT v_mv, v_start_time, v_end_time, FALSE, v_error;
        END;
    END LOOP;
END;
$function$;
