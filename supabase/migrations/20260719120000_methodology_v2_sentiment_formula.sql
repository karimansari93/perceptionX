-- =============================================================================
-- Methodology v2 — sentiment formula + published-model filter
-- =============================================================================
--
-- Package spec (July 2026, ahead of the Netflix Q3 / July-collection report):
--
--   1. Headline sentiment = positive / (positive + negative), from the TEXT
--      labels in ai_themes.sentiment. Neutrals are excluded from the score
--      (they remain counted in the composition columns, which are unchanged).
--      This replaces positive / total everywhere.
--   2. ai_themes.sentiment_score (numeric) is never used in a published
--      metric. The avg_sentiment_score columns stay on the rollups for
--      internal prioritization only; no dashboard/report/index reads them.
--   3. Model exclusion by FILTER, not deletion:
--        ai_model NOT IN ('claude','gemini','deepseek')
--      on every client-facing rollup. The excluded rows stay in
--      prompt_responses/ai_themes as the audit trail for previously published
--      numbers. (prompt_responses.ai_model is NOT NULL, so NOT IN is total.)
--   4. One formula everywhere: these rollups, the report SQL, and the Index
--      move together. The public Index (rankings_overview/_historical) is
--      built exclusively from for_index=true responses, which contain none of
--      the excluded models (verified 2026-07-19), so it needs no definition
--      change; it is refreshed at the end per the standard order.
--
-- Effect: every company/market/month restates for ALL clients (accepted —
-- including Ford, whose interim went out on the old formula).
--
-- IMPORTANT — this file is based on the LIVE prod definitions as of
-- 2026-07-21 (pg_get_functiondef / pg_get_viewdef), NOT on this repo's older
-- migration files, because prod carries drift the repo does not:
--   * 20260719073224_sentiment_score_all_prompt_types removed the
--     prompt_type IN ('sentiment','competitive') filter from BOTH sentiment
--     rollups — sentiment now pools themes from ALL prompt types. Preserved.
--   * serialize_company_metric_rebuilds gave every _refresh_cm_* helper a
--     per-table advisory-lock prologue. Preserved.
--   * 20260720085728_lock_down_public_materialized_views revoked anon read
--     on the matviews — the re-grants below are authenticated/service_role
--     ONLY, matching the lockdown (anon intentionally gets nothing).
--
-- What changes here:
--   * the 7 per-company rollup TABLE helpers (_refresh_cm_*) — new ratio in
--     the sentiment ones, model filter in all of them — then a full rebuild
--     of the 7 tables;
--   * company_response_sentiment_mv gains a negative_themes column so
--     clients can pool positive/(positive+negative) across responses;
--   * the 7 by-location matviews — recreated with the same changes;
--   * competitor_benchmarks_mv — codified into the repo for the first time
--     (it previously existed only in prod); it already used
--     positive/(positive+negative) and only gains the model filter;
--   * get_report_data (monthly client report) — codified, gains the filter.
--
-- Deploy note: as ONE transaction this is only safe on a FRESH environment
-- (no readers). Against live prod, apply in chunks with separate
-- transactions — the 2026-07-21 incident was caused by running this whole
-- file as one transaction: the ALTER TABLE took an ACCESS EXCLUSIVE lock on
-- company_response_sentiment_mv that was then held for the full ~10-minute
-- run, wedging every dashboard read behind it (500s), and the queued readers
-- exhausted the pool (503s). Live-prod order (what was actually applied on
-- 2026-07-21): (1) ALTER + all function bodies in one fast transaction;
-- (2) each table rebuild as its own statement (row locks only);
-- (3) each matview replaced via build-alongside + rename swap;
-- (4) refreshes, grants, comments.
-- =============================================================================

BEGIN;

SET LOCAL statement_timeout = 0;
SET LOCAL lock_timeout = '120s';

-- Serialize against the staleness tick (it try-locks 913372 and returns
-- 'busy' rather than colliding with the DROPs/rebuilds below).
SELECT pg_advisory_xact_lock(913372);

-- -----------------------------------------------------------------------------
-- 0. company_response_sentiment_mv: add the negative count the new formula
--    needs. (Column lands last; helpers below insert by explicit column list.)
-- -----------------------------------------------------------------------------
ALTER TABLE public.company_response_sentiment_mv
  ADD COLUMN IF NOT EXISTS negative_themes bigint;

-- -----------------------------------------------------------------------------
-- 1. Per-company rollup helpers (tables). Bodies are the LIVE prod
--    definitions (2026-07-21, incl. the per-table advisory-lock prologue and
--    the all-prompt-types sentiment scope) plus:
--      * the model filter in every defining query, and
--      * positive/(positive+negative) in the sentiment ratios (NULL when a
--        scope has no polarized themes — "no signal", never 0).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._refresh_cm_sentiment_scores(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_sentiment_scores_mv', 0));
  DELETE FROM public.company_sentiment_scores_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_sentiment_scores_mv
    (company_id, response_month, prompt_type, prompt_category, prompt_theme, industry_context,
     job_function_context, total_themes, positive_themes, negative_themes, neutral_themes,
     sentiment_ratio, avg_sentiment_score, calculated_at)
  WITH sentiment_responses AS (
    SELECT pr.id, pr.company_id, pr.tested_at, cp.prompt_type, cp.prompt_category, cp.prompt_theme,
           COALESCE(cp.industry_context, c.industry) AS industry_context,
           COALESCE(cp.job_function_context, ''::text) AS job_function_context,
           COALESCE((pr.collection_cycle::timestamp without time zone AT TIME ZONE 'UTC'::text),
                    date_trunc('month'::text, pr.tested_at)) AS response_month
    FROM prompt_responses pr
      JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
      JOIN companies c ON pr.company_id = c.id
    WHERE pr.company_id IS NOT NULL
      AND pr.ai_model NOT IN ('claude','gemini','deepseek')
      AND (p_company_id IS NULL OR pr.company_id = p_company_id)
  ), ai_themes_aggregated AS (
    SELECT sr.company_id, sr.response_month, sr.prompt_type, sr.prompt_category, sr.prompt_theme,
           sr.industry_context, sr.job_function_context,
           count(DISTINCT at.id) AS total_themes,
           count(DISTINCT at.id) FILTER (WHERE at.sentiment = 'positive') AS positive_themes,
           count(DISTINCT at.id) FILTER (WHERE at.sentiment = 'negative') AS negative_themes,
           count(DISTINCT at.id) FILTER (WHERE at.sentiment = 'neutral')  AS neutral_themes,
           avg(at.sentiment_score) AS avg_sentiment_score
    FROM sentiment_responses sr
      LEFT JOIN ai_themes at ON sr.id = at.response_id
    GROUP BY sr.company_id, sr.response_month, sr.prompt_type, sr.prompt_category, sr.prompt_theme,
             sr.industry_context, sr.job_function_context
  )
  SELECT company_id, response_month, prompt_type, prompt_category, prompt_theme, industry_context,
         job_function_context, total_themes, positive_themes, negative_themes, neutral_themes,
         CASE WHEN (positive_themes + negative_themes) > 0
              THEN positive_themes::numeric / (positive_themes + negative_themes)::numeric
              ELSE NULL::numeric END AS sentiment_ratio,
         COALESCE(avg_sentiment_score, 0::double precision) AS avg_sentiment_score,  -- internal only
         now() AS calculated_at
  FROM ai_themes_aggregated
  WHERE total_themes > 0;
END $fn$;

CREATE OR REPLACE FUNCTION public._refresh_cm_relevance_scores(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_relevance_scores_mv', 0));
  DELETE FROM public.company_relevance_scores_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_relevance_scores_mv
    (company_id, response_month, prompt_type, prompt_category, prompt_theme, industry_context,
     job_function_context, total_citations, valid_citations, relevance_score,
     citation_coverage_percentage, calculated_at)
  WITH citation_urls AS (
    SELECT pr.id AS response_id, pr.company_id, pr.tested_at, cp.prompt_type, cp.prompt_category, cp.prompt_theme,
           COALESCE(cp.industry_context, c.industry) AS industry_context,
           COALESCE(cp.job_function_context, ''::text) AS job_function_context,
           jsonb_array_elements(pr.citations) ->> 'url'::text AS citation_url,
           COALESCE((pr.collection_cycle::timestamp without time zone AT TIME ZONE 'UTC'::text),
                    date_trunc('month'::text, pr.tested_at)) AS response_month
    FROM prompt_responses pr
      JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
      JOIN companies c ON pr.company_id = c.id
    WHERE pr.citations IS NOT NULL AND jsonb_array_length(pr.citations) > 0 AND pr.company_id IS NOT NULL
      AND pr.company_mentioned = true
      AND pr.ai_model NOT IN ('claude','gemini','deepseek')
      AND (p_company_id IS NULL OR pr.company_id = p_company_id)
  ), relevance_aggregated AS (
    SELECT cu.company_id, cu.response_month, cu.prompt_type, cu.prompt_category, cu.prompt_theme,
           cu.industry_context, cu.job_function_context,
           count(DISTINCT cu.citation_url) AS total_citations,
           count(DISTINCT urc.url) FILTER (WHERE urc.recency_score IS NOT NULL) AS valid_citations,
           avg(urc.recency_score) FILTER (WHERE urc.recency_score IS NOT NULL) AS avg_relevance_score
    FROM citation_urls cu
      LEFT JOIN url_recency_cache urc ON cu.citation_url = urc.url
    GROUP BY cu.company_id, cu.response_month, cu.prompt_type, cu.prompt_category, cu.prompt_theme,
             cu.industry_context, cu.job_function_context
  )
  SELECT company_id, response_month, prompt_type, prompt_category, prompt_theme, industry_context,
         job_function_context, total_citations, valid_citations,
         COALESCE(avg_relevance_score, 0::numeric) AS relevance_score,
         CASE WHEN total_citations > 0 THEN valid_citations::numeric / total_citations::numeric * 100::numeric
              ELSE 0::numeric END AS citation_coverage_percentage,
         now() AS calculated_at
  FROM relevance_aggregated
  WHERE total_citations > 0;
END $fn$;

CREATE OR REPLACE FUNCTION public._refresh_cm_top_sources(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_top_sources_mv', 0));
  DELETE FROM public.company_top_sources_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_top_sources_mv
    (company_id, domain, sample_url, citation_count, pct_of_total)
  WITH unnested AS (
    SELECT pr.company_id,
           lower(regexp_replace(c.value ->> 'domain'::text, '^www\.'::text, ''::text)) AS domain,
           c.value ->> 'url'::text AS url
    FROM prompt_responses pr,
         LATERAL jsonb_array_elements(pr.citations) c(value)
    WHERE pr.company_id IS NOT NULL AND pr.for_index IS NOT TRUE AND jsonb_typeof(pr.citations) = 'array'
      AND pr.ai_model NOT IN ('claude','gemini','deepseek')
      AND (c.value ->> 'domain'::text) IS NOT NULL AND (c.value ->> 'domain'::text) <> ''
      AND (p_company_id IS NULL OR pr.company_id = p_company_id)
  )
  SELECT company_id, domain, min(url) AS sample_url, count(*) AS citation_count,
         round(count(*)::numeric / sum(count(*)) OVER (PARTITION BY company_id) * 100::numeric, 1) AS pct_of_total
  FROM unnested
  WHERE domain <> ''
  GROUP BY company_id, domain;
END $fn$;

CREATE OR REPLACE FUNCTION public._refresh_cm_competitors(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_competitors_mv', 0));
  DELETE FROM public.company_competitors_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_competitors_mv
    (company_id, competitor_name, mention_count)
  WITH raw AS (
    SELECT pr.company_id,
           normalize_entity_name(TRIM(BOTH FROM unnest(string_to_array(pr.detected_competitors, ','::text)))) AS normalized_alias
    FROM prompt_responses pr
    WHERE pr.company_id IS NOT NULL AND pr.for_index IS NOT TRUE
      AND pr.detected_competitors IS NOT NULL AND pr.detected_competitors <> ''
      AND pr.ai_model NOT IN ('claude','gemini','deepseek')
      AND (p_company_id IS NULL OR pr.company_id = p_company_id)
  ), mapped AS (
    SELECT r.company_id, COALESCE(ce.canonical_name, initcap(r.normalized_alias)) AS competitor_name, ce.is_active
    FROM raw r
      LEFT JOIN entity_aliases ea ON ea.normalized_alias = r.normalized_alias
      LEFT JOIN canonical_entities ce ON ce.id = ea.canonical_id
    WHERE r.normalized_alias IS NOT NULL AND r.normalized_alias <> '' AND length(r.normalized_alias) > 1
      AND (r.normalized_alias <> ALL (ARRAY['glassdoor','indeed','ambitionbox','workday','linkedin','monster','careerbuilder','ziprecruiter','dice','angelist','wellfound','builtin','stackoverflow','github']))
      AND (r.normalized_alias <> ALL (ARRAY['none','n/a','na','null','undefined']))
      AND r.normalized_alias !~ '^[0-9]+$' AND r.normalized_alias ~ '[a-z0-9]'
      AND NOT (length(r.normalized_alias) <= 2 AND r.normalized_alias ~ '^[a-z]{1,2}$')
  )
  SELECT company_id, competitor_name, count(*) AS mention_count
  FROM mapped
  WHERE is_active IS NOT FALSE
  GROUP BY company_id, competitor_name;
END $fn$;

CREATE OR REPLACE FUNCTION public._refresh_cm_llm_rankings(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_llm_rankings_mv', 0));
  DELETE FROM public.company_llm_rankings_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_llm_rankings_mv
    (company_id, ai_model, total_responses, mentions, mention_pct)
  SELECT company_id, ai_model, count(*) AS total_responses,
         count(*) FILTER (WHERE company_mentioned = true) AS mentions,
         round(count(*) FILTER (WHERE company_mentioned = true)::numeric / NULLIF(count(*), 0)::numeric * 100::numeric, 1) AS mention_pct
  FROM prompt_responses
  WHERE company_id IS NOT NULL AND for_index IS NOT TRUE AND ai_model IS NOT NULL
    AND ai_model NOT IN ('claude','gemini','deepseek')
    AND (p_company_id IS NULL OR company_id = p_company_id)
  GROUP BY company_id, ai_model;
END $fn$;

CREATE OR REPLACE FUNCTION public._refresh_cm_attribute_themes(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_attribute_themes_mv', 0));
  DELETE FROM public.company_attribute_themes_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_attribute_themes_mv
    (company_id, response_month, job_function_context, attribute_id, total_themes, positive_themes,
     negative_themes, neutral_themes, avg_sentiment_score, response_count, calculated_at)
  SELECT t.company_id,
         date_trunc('month'::text, pr.tested_at)::date AS response_month,
         COALESCE(NULLIF(btrim(cp.job_function_context), ''::text), ''::text) AS job_function_context,
         CASE btrim(t.attribute_id)
           WHEN 'mission-purpose'         THEN 'mission-purpose-impact'
           WHEN 'social-impact'           THEN 'mission-purpose-impact'
           WHEN 'rewards-recognition'     THEN 'compensation'
           WHEN 'security-perks'          THEN 'job-security'
           WHEN 'application-process'     THEN 'application-communication'
           WHEN 'candidate-communication' THEN 'application-communication'
           ELSE btrim(t.attribute_id)
         END AS attribute_id,
         count(*) AS total_themes,
         count(*) FILTER (WHERE t.sentiment = 'positive') AS positive_themes,
         count(*) FILTER (WHERE t.sentiment = 'negative') AS negative_themes,
         count(*) FILTER (WHERE t.sentiment = 'neutral')  AS neutral_themes,
         avg(t.sentiment_score) AS avg_sentiment_score,  -- internal only
         count(DISTINCT t.response_id) AS response_count,
         now() AS calculated_at
  FROM ai_themes t
    JOIN prompt_responses pr ON pr.id = t.response_id
    JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
  WHERE pr.tested_at IS NOT NULL
    AND pr.ai_model NOT IN ('claude','gemini','deepseek')
    AND (btrim(t.attribute_id) = ANY (ARRAY['mission-purpose-impact','compensation','company-culture','leadership','job-security','career-opportunities','wellbeing-balance','inclusion','innovation','application-communication','candidate-feedback','interview-experience','onboarding-experience','mission-purpose','rewards-recognition','social-impact','security-perks','application-process','candidate-communication','overall-candidate-experience']))
    AND (p_company_id IS NULL OR t.company_id = p_company_id)
  GROUP BY t.company_id, (date_trunc('month'::text, pr.tested_at)),
           (COALESCE(NULLIF(btrim(cp.job_function_context), ''::text), ''::text)),
           4;
END $fn$;

-- Per-response ratio now needs the response's model, so this helper joins
-- prompt_responses (indexed pk join; still cheap).
CREATE OR REPLACE FUNCTION public._refresh_cm_response_sentiment(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_response_sentiment_mv', 0));
  DELETE FROM public.company_response_sentiment_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_response_sentiment_mv
    (company_id, response_id, total_themes, positive_themes, negative_themes, sentiment_ratio)
  SELECT t.company_id, t.response_id, count(*) AS total_themes,
         count(*) FILTER (WHERE t.sentiment = 'positive') AS positive_themes,
         count(*) FILTER (WHERE t.sentiment = 'negative') AS negative_themes,
         count(*) FILTER (WHERE t.sentiment = 'positive')::double precision
           / NULLIF(count(*) FILTER (WHERE t.sentiment IN ('positive','negative')), 0)::double precision AS sentiment_ratio
  FROM ai_themes t
    JOIN prompt_responses pr ON pr.id = t.response_id
  WHERE t.response_id IS NOT NULL
    AND pr.ai_model NOT IN ('claude','gemini','deepseek')
    AND (p_company_id IS NULL OR t.company_id = p_company_id)
  GROUP BY t.company_id, t.response_id;
END $fn$;

-- -----------------------------------------------------------------------------
-- 2. Restate the 7 tables under the new definitions (all companies).
-- -----------------------------------------------------------------------------
SELECT public._refresh_cm_sentiment_scores(NULL);
SELECT public._refresh_cm_relevance_scores(NULL);
SELECT public._refresh_cm_top_sources(NULL);
SELECT public._refresh_cm_competitors(NULL);
SELECT public._refresh_cm_llm_rankings(NULL);
SELECT public._refresh_cm_attribute_themes(NULL);
SELECT public._refresh_cm_response_sentiment(NULL);

ANALYZE public.company_sentiment_scores_mv;
ANALYZE public.company_relevance_scores_mv;
ANALYZE public.company_top_sources_mv;
ANALYZE public.company_competitors_mv;
ANALYZE public.company_llm_rankings_mv;
ANALYZE public.company_attribute_themes_mv;
ANALYZE public.company_response_sentiment_mv;

-- -----------------------------------------------------------------------------
-- 3. By-location matviews: recreate with the same changes. (DROP+CREATE
--    repopulates them inside this transaction; mv_refresh_state rows keep
--    their names, so the staleness tick carries on maintaining them.)
-- -----------------------------------------------------------------------------

-- 3a. sentiment (new ratio + model filter; all prompt types per
--     20260719073224 — no prompt_type filter) ---------------------------------
DROP MATERIALIZED VIEW IF EXISTS public.company_sentiment_scores_by_location_mv;
CREATE MATERIALIZED VIEW public.company_sentiment_scores_by_location_mv AS
 WITH sentiment_responses AS (
         SELECT pr.id, pr.company_id, pr.tested_at, cp.prompt_type, cp.prompt_category, cp.prompt_theme,
            COALESCE(cp.industry_context, c.industry) AS industry_context,
            COALESCE(cp.job_function_context, ''::text) AS job_function_context,
            COALESCE(NULLIF(btrim(cp.location_context), ''::text), ''::text) AS location_context,
            COALESCE((pr.collection_cycle::timestamp without time zone AT TIME ZONE 'UTC'::text), date_trunc('month'::text, pr.tested_at)) AS response_month
           FROM prompt_responses pr
             JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
             JOIN companies c ON pr.company_id = c.id
          WHERE pr.company_id IS NOT NULL
            AND pr.ai_model NOT IN ('claude','gemini','deepseek')
        ), ai_themes_aggregated AS (
         SELECT sr.company_id, sr.location_context, sr.response_month, sr.prompt_type, sr.prompt_category, sr.prompt_theme, sr.industry_context, sr.job_function_context,
            count(DISTINCT at.id) AS total_themes,
            count(DISTINCT at.id) FILTER (WHERE at.sentiment = 'positive'::text) AS positive_themes,
            count(DISTINCT at.id) FILTER (WHERE at.sentiment = 'negative'::text) AS negative_themes,
            count(DISTINCT at.id) FILTER (WHERE at.sentiment = 'neutral'::text) AS neutral_themes,
            avg(at.sentiment_score) AS avg_sentiment_score
           FROM sentiment_responses sr
             LEFT JOIN ai_themes at ON sr.id = at.response_id
          GROUP BY sr.company_id, sr.location_context, sr.response_month, sr.prompt_type, sr.prompt_category, sr.prompt_theme, sr.industry_context, sr.job_function_context
        )
 SELECT company_id, location_context, response_month, prompt_type, prompt_category, prompt_theme, industry_context, job_function_context,
    total_themes, positive_themes, negative_themes, neutral_themes,
    CASE WHEN (positive_themes + negative_themes) > 0
         THEN positive_themes::numeric / (positive_themes + negative_themes)::numeric
         ELSE NULL::numeric END AS sentiment_ratio,
    COALESCE(avg_sentiment_score, 0::double precision) AS avg_sentiment_score,  -- internal only
    now() AS calculated_at
   FROM ai_themes_aggregated
  WHERE total_themes > 0;

CREATE INDEX company_sentiment_by_location_mv_lookup ON public.company_sentiment_scores_by_location_mv USING btree (company_id, location_context, response_month DESC);
CREATE UNIQUE INDEX company_sentiment_by_location_mv_uniq ON public.company_sentiment_scores_by_location_mv USING btree (company_id, location_context, response_month, prompt_type, prompt_category, prompt_theme, industry_context, job_function_context);

-- 3b. attribute themes (model filter; keeps the v1->v2 remap) -----------------
DROP MATERIALIZED VIEW IF EXISTS public.company_attribute_themes_by_location_mv;
CREATE MATERIALIZED VIEW public.company_attribute_themes_by_location_mv AS
  SELECT t.company_id,
    COALESCE(NULLIF(btrim(cp.location_context), ''::text), ''::text) AS location_context,
    date_trunc('month'::text, pr.tested_at)::date AS response_month,
    COALESCE(NULLIF(btrim(cp.job_function_context), ''::text), ''::text) AS job_function_context,
    CASE btrim(t.attribute_id)
      WHEN 'mission-purpose'         THEN 'mission-purpose-impact'
      WHEN 'social-impact'           THEN 'mission-purpose-impact'
      WHEN 'rewards-recognition'     THEN 'compensation'
      WHEN 'security-perks'          THEN 'job-security'
      WHEN 'application-process'     THEN 'application-communication'
      WHEN 'candidate-communication' THEN 'application-communication'
      ELSE btrim(t.attribute_id)
    END AS attribute_id,
    count(*) AS total_themes,
    count(*) FILTER (WHERE t.sentiment = 'positive'::text) AS positive_themes,
    count(*) FILTER (WHERE t.sentiment = 'negative'::text) AS negative_themes,
    count(*) FILTER (WHERE t.sentiment = 'neutral'::text) AS neutral_themes,
    avg(t.sentiment_score) AS avg_sentiment_score,  -- internal only
    count(DISTINCT t.response_id) AS response_count,
    now() AS calculated_at
   FROM ai_themes t
     JOIN prompt_responses pr ON pr.id = t.response_id
     JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
  WHERE pr.tested_at IS NOT NULL
    AND pr.ai_model NOT IN ('claude','gemini','deepseek')
    AND (btrim(t.attribute_id) = ANY (ARRAY[
      -- v2
      'mission-purpose-impact'::text, 'compensation'::text, 'company-culture'::text,
      'leadership'::text, 'job-security'::text, 'career-opportunities'::text,
      'wellbeing-balance'::text, 'inclusion'::text, 'innovation'::text,
      'application-communication'::text, 'candidate-feedback'::text,
      'interview-experience'::text, 'onboarding-experience'::text,
      -- v1 legacy (folded into v2 ids by the CASE above; overall-candidate-experience stays)
      'mission-purpose'::text, 'rewards-recognition'::text, 'social-impact'::text,
      'security-perks'::text, 'application-process'::text, 'candidate-communication'::text,
      'overall-candidate-experience'::text]))
  GROUP BY t.company_id, (COALESCE(NULLIF(btrim(cp.location_context), ''::text), ''::text)),
    (date_trunc('month'::text, pr.tested_at)),
    (COALESCE(NULLIF(btrim(cp.job_function_context), ''::text), ''::text)), 5;

CREATE UNIQUE INDEX company_attribute_themes_by_location_mv_uniq
  ON public.company_attribute_themes_by_location_mv (company_id, location_context, response_month, job_function_context, attribute_id);
CREATE INDEX company_attribute_themes_by_location_mv_lookup
  ON public.company_attribute_themes_by_location_mv (company_id, location_context);

-- 3c. relevance (model filter) ------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS public.company_relevance_scores_by_location_mv;
CREATE MATERIALIZED VIEW public.company_relevance_scores_by_location_mv AS
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
    AND pr.ai_model NOT IN ('claude','gemini','deepseek')
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

CREATE UNIQUE INDEX company_relevance_by_location_mv_uniq
  ON public.company_relevance_scores_by_location_mv
  USING btree (company_id, location_context, response_month, prompt_type, prompt_category, prompt_theme, industry_context, job_function_context);
CREATE INDEX company_relevance_by_location_mv_lookup
  ON public.company_relevance_scores_by_location_mv
  USING btree (company_id, location_context, response_month DESC);

-- 3d. top sources (model filter) ---------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS public.company_top_sources_by_location_mv;
CREATE MATERIALIZED VIEW public.company_top_sources_by_location_mv AS
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
    AND pr.ai_model NOT IN ('claude','gemini','deepseek')
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

CREATE UNIQUE INDEX company_top_sources_by_location_mv_uniq
  ON public.company_top_sources_by_location_mv
  USING btree (company_id, location_context, domain);
CREATE INDEX company_top_sources_by_location_mv_lookup
  ON public.company_top_sources_by_location_mv
  USING btree (company_id, location_context, citation_count DESC);

-- 3e. competitors (model filter) ---------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS public.company_competitors_by_location_mv;
CREATE MATERIALIZED VIEW public.company_competitors_by_location_mv AS
WITH raw AS (
  SELECT pr.company_id,
         COALESCE(NULLIF(btrim(cp.location_context), ''::text), ''::text) AS location_context,
         normalize_entity_name(btrim(unnest(string_to_array(pr.detected_competitors, ','::text)))) AS normalized_alias
  FROM prompt_responses pr
    JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
  WHERE pr.company_id IS NOT NULL
    AND pr.for_index IS NOT TRUE
    AND pr.ai_model NOT IN ('claude','gemini','deepseek')
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

CREATE UNIQUE INDEX company_competitors_by_location_mv_uniq
  ON public.company_competitors_by_location_mv
  USING btree (company_id, location_context, competitor_name);
CREATE INDEX company_competitors_by_location_mv_lookup
  ON public.company_competitors_by_location_mv
  USING btree (company_id, location_context, mention_count DESC);

-- 3f. llm rankings (model filter: excluded models leave the per-model view) --
DROP MATERIALIZED VIEW IF EXISTS public.company_llm_rankings_by_location_mv;
CREATE MATERIALIZED VIEW public.company_llm_rankings_by_location_mv AS
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
  AND pr.ai_model NOT IN ('claude','gemini','deepseek')
GROUP BY pr.company_id,
         COALESCE(NULLIF(btrim(cp.location_context), ''::text), ''::text),
         pr.ai_model;

CREATE UNIQUE INDEX company_llm_rankings_by_location_mv_uniq
  ON public.company_llm_rankings_by_location_mv
  USING btree (company_id, location_context, ai_model);
CREATE INDEX company_llm_rankings_by_location_mv_lookup
  ON public.company_llm_rankings_by_location_mv
  USING btree (company_id, location_context, mentions DESC);

-- 3g. visibility (model filter) ----------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS public.company_visibility_by_location_mv;
CREATE MATERIALIZED VIEW public.company_visibility_by_location_mv AS
SELECT pr.company_id,
       COALESCE(NULLIF(btrim(cp.location_context), ''::text), ''::text) AS location_context,
       COALESCE(pr.response_month, date_trunc('month'::text, pr.tested_at)::date) AS response_month,
       COALESCE(NULLIF(btrim(cp.job_function_context), ''::text), ''::text) AS job_function_context,
       count(*) AS total_responses,
       count(*) FILTER (WHERE pr.company_mentioned = true) AS mentioned_responses,
       now() AS calculated_at
FROM prompt_responses pr
  JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
WHERE pr.company_id IS NOT NULL
  AND pr.tested_at IS NOT NULL
  AND pr.ai_model NOT IN ('claude','gemini','deepseek')
  AND lower(COALESCE(btrim(cp.attribute_id), ''::text)) <> 'overall-candidate-experience'
  AND lower(COALESCE(btrim(cp.prompt_theme), ''::text)) <> 'overall candidate experience'
GROUP BY pr.company_id,
         COALESCE(NULLIF(btrim(cp.location_context), ''::text), ''::text),
         COALESCE(pr.response_month, date_trunc('month'::text, pr.tested_at)::date),
         COALESCE(NULLIF(btrim(cp.job_function_context), ''::text), ''::text);

CREATE UNIQUE INDEX company_visibility_by_location_mv_uniq
  ON public.company_visibility_by_location_mv
  USING btree (company_id, location_context, response_month, job_function_context);
CREATE INDEX company_visibility_by_location_mv_lookup
  ON public.company_visibility_by_location_mv
  USING btree (company_id, response_month DESC);

-- DROP discards matview ACLs; restore read access. Deliberately NO anon grant
-- — 20260720085728_lock_down_public_materialized_views revoked anon read on
-- these, and this migration preserves that lockdown.
GRANT SELECT ON public.company_sentiment_scores_by_location_mv,
                public.company_attribute_themes_by_location_mv,
                public.company_relevance_scores_by_location_mv,
                public.company_top_sources_by_location_mv,
                public.company_competitors_by_location_mv,
                public.company_llm_rankings_by_location_mv,
                public.company_visibility_by_location_mv
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. competitor_benchmarks_mv (peer benchmarks / EPS drilldown). First time in
--    a migration — the definition below is the live prod one (pg_get_viewdef,
--    2026-07-21) with ONE change: the model filter in the responses CTE. Its
--    sentiment_pct already used 100 * pos / NULLIF(pos + neg, 0).
-- -----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS public.competitor_benchmarks_mv;
CREATE MATERIALIZED VIEW public.competitor_benchmarks_mv AS
 WITH panel AS (
         SELECT c.id AS company_id,
            c.name AS company_name
           FROM organizations o
             JOIN organization_companies oc ON oc.organization_id = o.id
             JOIN companies c ON c.id = oc.company_id
          WHERE o.name = 'Percentiles'::text
        UNION ALL
         SELECT companies.id,
            companies.name
           FROM companies
          WHERE companies.name = 'Netflix'::text
        ), responses AS (
         SELECT p.company_name,
            replace(replace(replace(cp.location_context, 'the United States'::text, 'United States'::text), 'the United Kingdom'::text, 'United Kingdom'::text), 'the Netherlands'::text, 'Netherlands'::text) AS market,
            pr.id AS response_id,
            pr.company_mentioned,
            pr.citations
           FROM panel p
             JOIN confirmed_prompts cp ON cp.company_id = p.company_id
             JOIN prompt_responses pr ON pr.confirmed_prompt_id = cp.id
          WHERE cp.location_context IS NOT NULL
            AND cp.location_context !~~* '%global%'::text
            AND cp.location_context !~~* '%all countries%'::text
            AND cp.location_context !~~* '%worldwide%'::text
            AND pr.ai_model NOT IN ('claude','gemini','deepseek')
        ), response_citations AS (
         SELECT r_1.company_name,
            r_1.market,
            r_1.response_id,
            r_1.company_mentioned,
                CASE
                    WHEN jsonb_typeof(r_1.citations) = 'array'::text THEN jsonb_array_length(r_1.citations)
                    ELSE 0
                END AS total_cits,
            ( SELECT count(*) AS count
                   FROM jsonb_array_elements(
                        CASE
                            WHEN jsonb_typeof(r_1.citations) = 'array'::text THEN r_1.citations
                            ELSE '[]'::jsonb
                        END) c(value)
                     JOIN url_recency_cache urc ON urc.url = (c.value ->> 'url'::text)) AS valid_cits
           FROM responses r_1
        ), response_themes AS (
         SELECT r_1.company_name,
            r_1.market,
            r_1.response_id,
            count(*) FILTER (WHERE t.sentiment = 'positive'::text) AS pos,
            count(*) FILTER (WHERE t.sentiment = 'negative'::text) AS neg
           FROM responses r_1
             LEFT JOIN ai_themes t ON t.response_id = r_1.response_id
          GROUP BY r_1.company_name, r_1.market, r_1.response_id
        ), metrics AS (
         SELECT rc.company_name,
            rc.market,
            count(*) AS responses,
            count(*) FILTER (WHERE rc.company_mentioned) AS mentions,
            COALESCE(sum(rc.total_cits) FILTER (WHERE rc.company_mentioned), 0::bigint) AS total_citations,
            COALESCE(sum(rc.valid_cits) FILTER (WHERE rc.company_mentioned), 0::numeric) AS valid_citations,
            COALESCE(sum(rt.pos) FILTER (WHERE rc.company_mentioned), 0::numeric) AS pos_themes,
            COALESCE(sum(rt.neg) FILTER (WHERE rc.company_mentioned), 0::numeric) AS neg_themes
           FROM response_citations rc
             LEFT JOIN response_themes rt ON rt.response_id = rc.response_id
          GROUP BY rc.company_name, rc.market
        ), metrics_pct AS (
         SELECT m.company_name,
            m.market,
            m.responses,
            m.mentions,
            m.total_citations,
            m.valid_citations,
            m.pos_themes,
            m.neg_themes,
            round(100.0 * m.mentions::numeric / NULLIF(m.responses, 0)::numeric, 1) AS visibility_pct,
            round(100.0 * m.pos_themes / NULLIF(m.pos_themes + m.neg_themes, 0::numeric), 1) AS sentiment_pct,
            round(100.0 * m.valid_citations / NULLIF(m.total_citations, 0)::numeric, 1) AS relevance_pct
           FROM metrics m
          WHERE m.responses >= 20
        ), ranked AS (
         SELECT m.company_name, m.market, m.responses, m.mentions, m.total_citations, m.valid_citations,
            m.pos_themes, m.neg_themes, m.visibility_pct, m.sentiment_pct, m.relevance_pct,
            rank() OVER (PARTITION BY m.market ORDER BY m.visibility_pct DESC NULLS LAST) AS visibility_rank,
            count(*) FILTER (WHERE m.visibility_pct IS NOT NULL) OVER (PARTITION BY m.market) AS vis_cohort_size,
            rank() OVER (PARTITION BY m.market ORDER BY m.sentiment_pct DESC NULLS LAST) AS sentiment_rank,
            count(*) FILTER (WHERE m.sentiment_pct IS NOT NULL) OVER (PARTITION BY m.market) AS sent_cohort_size,
            rank() OVER (PARTITION BY m.market ORDER BY m.relevance_pct DESC NULLS LAST) AS relevance_rank,
            count(*) FILTER (WHERE m.relevance_pct IS NOT NULL) OVER (PARTITION BY m.market) AS rel_cohort_size
           FROM metrics_pct m
        ), peer_stats AS (
         SELECT r1.company_name,
            r1.market,
            round(avg(r2.visibility_pct), 1) AS visibility_peer_avg,
            round(avg(r2.sentiment_pct), 1) AS sentiment_peer_avg,
            round(avg(r2.relevance_pct), 1) AS relevance_peer_avg,
            round(percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (r2.visibility_pct::double precision))::numeric, 1) AS visibility_peer_median,
            round(percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (r2.sentiment_pct::double precision))::numeric, 1) AS sentiment_peer_median,
            round(percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (r2.relevance_pct::double precision))::numeric, 1) AS relevance_peer_median,
            string_agg(DISTINCT r2.company_name, ', '::text ORDER BY r2.company_name) AS peer_companies
           FROM ranked r1
             LEFT JOIN ranked r2 ON r2.market = r1.market AND r2.company_name <> r1.company_name
          GROUP BY r1.company_name, r1.market
        )
 SELECT r.company_name, r.market, r.responses, r.mentions, r.pos_themes, r.neg_themes,
    r.total_citations, r.valid_citations, r.visibility_pct, r.visibility_rank, r.vis_cohort_size,
    ps.visibility_peer_avg, ps.visibility_peer_median,
    round(r.visibility_pct - ps.visibility_peer_avg, 1) AS visibility_gap,
    r.sentiment_pct, r.sentiment_rank, r.sent_cohort_size, ps.sentiment_peer_avg, ps.sentiment_peer_median,
    round(r.sentiment_pct - ps.sentiment_peer_avg, 1) AS sentiment_gap,
    r.relevance_pct, r.relevance_rank, r.rel_cohort_size, ps.relevance_peer_avg, ps.relevance_peer_median,
    round(r.relevance_pct - ps.relevance_peer_avg, 1) AS relevance_gap,
    ps.peer_companies,
    now() AS last_refreshed
   FROM ranked r
     LEFT JOIN peer_stats ps ON ps.company_name = r.company_name AND ps.market = r.market;

CREATE UNIQUE INDEX competitor_benchmarks_mv_pk ON public.competitor_benchmarks_mv USING btree (company_name, market);
CREATE INDEX competitor_benchmarks_mv_market ON public.competitor_benchmarks_mv USING btree (market);

-- Matches the post-lockdown grants: no anon read.
GRANT SELECT ON public.competitor_benchmarks_mv TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4b. get_report_data (monthly client report, server/server.js). Codified from
--     the live prod definition (it predates this repo's migrations) with ONE
--     change: the methodology-v2 model filter. The report's sentiment comes
--     from company_sentiment_scores_mv (already restated above); these raw
--     rows feed its visibility/competitor/source numbers.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_report_data(p_company_id uuid, p_p1_start date, p_p1_end date, p_p2_start date, p_p2_end date)
 RETURNS TABLE(period integer, company_mentioned boolean, prompt_type text, detected_competitors text, citations jsonb, ai_model text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    CASE WHEN DATE(pr.tested_at) BETWEEN p_p1_start AND p_p1_end THEN 1 ELSE 2 END AS period,
    pr.company_mentioned,
    cp.prompt_type,
    pr.detected_competitors,
    pr.citations::jsonb,
    pr.ai_model
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
  WHERE pr.company_id = p_company_id
    AND pr.ai_model NOT IN ('claude','gemini','deepseek')
    AND (
      DATE(pr.tested_at) BETWEEN p_p1_start AND p_p1_end
      OR
      DATE(pr.tested_at) BETWEEN p_p2_start AND p_p2_end
    );
$function$;

-- -----------------------------------------------------------------------------
-- 4c. ai_themes_keyset_page (dashboard theme drilldowns, 20260720095337 +
--     PR #65/#66): the RPC is the client-facing themes read path, so the
--     model exclusion lives inside it. Body is the live definition plus the
--     EXISTS filter on the parent response's ai_model.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_themes_keyset_page(p_company_id uuid, p_cutoff timestamp with time zone, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 1000, p_attribute_ids text[] DEFAULT NULL::text[])
 RETURNS TABLE(id uuid, response_id uuid, theme_name text, sentiment text, sentiment_score double precision, attribute_id text, attribute_name text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (is_admin() or user_can_access_company(p_company_id)) then
    return;
  end if;

  return query
  select t.id, t.response_id, t.theme_name, t.sentiment, t.sentiment_score,
         t.attribute_id, t.attribute_name, t.created_at
  from public.ai_themes t
  where t.company_id = p_company_id
    and t.created_at >= p_cutoff
    and (p_attribute_ids is null or t.attribute_id = any(p_attribute_ids))
    -- Methodology v2: excluded models never reach client-facing surfaces
    and exists (
      select 1 from public.prompt_responses pr
      where pr.id = t.response_id
        and pr.ai_model not in ('claude','gemini','deepseek')
    )
    and (t.created_at, t.id) < (
      coalesce(p_cursor_created_at, 'infinity'::timestamptz),
      coalesce(p_cursor_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
    )
  order by t.created_at desc, t.id desc
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
end;
$function$;

-- -----------------------------------------------------------------------------
-- 5. Standard post-migration refresh order for the shared-DB Index objects.
--    Their definitions are unchanged (for_index=true responses contain none of
--    the excluded models), so this is bookkeeping, not a restatement.
-- -----------------------------------------------------------------------------
REFRESH MATERIALIZED VIEW public.rankings_overview;
REFRESH MATERIALIZED VIEW public.rankings_historical;
REFRESH MATERIALIZED VIEW public.company_search_index;

-- -----------------------------------------------------------------------------
-- 6. Comments
-- -----------------------------------------------------------------------------
COMMENT ON TABLE public.company_sentiment_scores_mv IS
  'Per (company, month, prompt dims) sentiment aggregates over ALL prompt types (20260719073224). Methodology v2 (2026-07): sentiment_ratio = positive/(positive+negative) from ai_themes.sentiment labels (neutrals excluded from the score, still counted for composition; NULL when no polarized themes); rows exclude ai_model claude/gemini/deepseek. avg_sentiment_score is INTERNAL ONLY — never published. Maintained by refresh_company_metrics(company_id) + staleness tick.';
COMMENT ON TABLE public.company_response_sentiment_mv IS
  'Per (company, response) theme counts and sentiment_ratio = positive/(positive+negative) (NULL when no polarized themes). Methodology v2: responses from ai_model claude/gemini/deepseek are excluded. Maintained by refresh_company_metrics(company_id) + staleness tick.';
COMMENT ON TABLE public.company_attribute_themes_mv IS
  'Per (company, month, job_function, attribute) theme composition (v1 ids folded into v2). Methodology v2: excludes ai_model claude/gemini/deepseek; avg_sentiment_score is INTERNAL ONLY. Headline attribute sentiment = positive/(positive+negative). Maintained by refresh_company_metrics(company_id) + staleness tick.';
COMMENT ON MATERIALIZED VIEW public.competitor_benchmarks_mv IS
  'Peer benchmark panel (Percentiles org + Netflix) per market: visibility/sentiment/relevance pcts, ranks and peer stats. sentiment_pct = 100*positive/(positive+negative) from ai_themes labels; excludes ai_model claude/gemini/deepseek (methodology v2, 2026-07). Codified from the live definition on 2026-07-21.';

COMMIT;
