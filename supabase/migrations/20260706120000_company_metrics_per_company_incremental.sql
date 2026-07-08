-- =============================================================================
-- Company metrics: per-company incremental refresh
-- =============================================================================
--
-- Terminology: "organizations" (organizations table) are customer accounts;
-- each tracks one or more companies via organization_companies. Every metric
-- rollup keys on company_id, so the unit of refresh here is a COMPANY. A
-- convenience wrapper refreshes all companies an organization tracks.
--
-- Problem
-- -------
-- The 7 company-level rollups (sentiment, relevance, top sources, competitors,
-- llm rankings, attribute themes, response sentiment) are materialized views.
-- A materialized view can only be refreshed IN FULL -- every refresh rebuilds
-- all ~219 companies (~20-40s and a full scan of prompt_responses/ai_themes
-- each, per mv_refresh_state timings) even when a single company's data
-- changed.
--
-- The staleness tick (20260628000001) made those full refreshes reliable
-- (one MV per minute-tick, no statement timeout), but it cannot make them
-- cheap or immediate: after a collection run, a company's dashboard lags until
-- the tick drains the affected MVs (up to ~13 min queue + 15-min per-MV
-- cooldown during bursts), and each drain is a full all-companies rebuild.
--
-- Fix: convert the 7 company-level rollups into regular TABLES maintained by
-- per-company incremental refresh:
--
--     SELECT refresh_company_metrics('<company-uuid>');          -- one company
--     SELECT * FROM refresh_organization_metrics('<org-uuid>');  -- every company an organization tracks
--
-- For each table this does DELETE WHERE company_id = X; INSERT ... WHERE
-- company_id = X. prompt_responses / ai_themes are indexed on company_id, so
-- one company touches only its own rows -> sub-second-to-seconds, no timeout,
-- and a tiny fraction of the Disk IO of a full rebuild.
-- collect-company-responses calls this right after landing a company's
-- responses, so that company's dashboard is fresh immediately.
--
-- Integration with the staleness tick (20260628000001)
-- ----------------------------------------------------
-- The tick, mv_refresh_state bookkeeping, watermark triggers, and the admin
-- Data Health tab all stay. Changes:
--   * refresh_metrics_tick() now DISPATCHES per object: the 6 by-location
--     rollups are still matviews and get REFRESH MATERIALIZED VIEW
--     CONCURRENTLY as before; the 7 converted tables get a full incremental
--     rebuild via their helper (all-companies DELETE+INSERT -- same cost class
--     as the old REFRESH). The tick remains the safety net for cross-company
--     writers the per-company path can't see coming (recency rescore, theme
--     backfill, entity canonicalization) and the only refresher of the
--     by-location MVs.
--   * mv_refresh_state keeps one row per rollup (same 13 names), so the
--     Data Health staleness banner and force-flag flow work unchanged.
--   * The no-arg refresh_company_metrics() keeps its RETURNS TABLE(...)
--     status contract (callers: refresh-company-metrics edge fn, manual use)
--     but is now table-aware. It is still the heavy all-companies path; prefer
--     the tick (steady state) or the per-company call (after a collection).
--
-- What stays the same for readers
-- -------------------------------
-- Object names, columns, and indexes are unchanged (company_*_mv), so the
-- frontend -- which reads these objects directly and filters by company_id --
-- keeps working as-is. anon/authenticated keep read access; the write
-- privileges that were inert on a matview are revoked, since on a TABLE they
-- would let clients mutate metrics.
--
-- The defining queries below are byte-for-byte the live matview definitions
-- (pg_get_viewdef as of 2026-07-06, i.e. AFTER the talentx cleanup in
-- 20260615120100 renamed ai_themes.talentx_attribute_id -> attribute_id and
-- trimmed the sentiment prompt_type list) plus a company_id predicate.
--
-- Deploy note: the swap COPIES each matview's current contents into its
-- replacement table (CREATE TABLE ... AS SELECT * FROM mv), so there is no
-- recompute/backfill inside the migration -- it runs in seconds and can be
-- applied via supabase db push OR the SQL editor / management API. One
-- transaction: readers see the old MVs until COMMIT, then tables with
-- identical contents. mv_refresh_state is left untouched: its timestamps
-- still truthfully describe the data (it IS that refresh's output), and the
-- tick + per-company calls take over maintenance from there.
-- =============================================================================

BEGIN;

-- Hold the staleness tick's advisory lock for the whole swap: if a tick is
-- mid-refresh we wait for it, and any tick firing while we run returns 'busy'
-- instead of colliding with the DROPs. Released automatically at COMMIT.
SELECT pg_advisory_xact_lock(913372);

-- -----------------------------------------------------------------------------
-- 1. Convert each materialized view into a table.
--    Snapshot-copy the MV (exact column shape AND current contents), drop the
--    MV, rename into place. Atomic for readers, and no recompute needed: the
--    tables start as byte-identical copies of what the dashboards read today.
-- -----------------------------------------------------------------------------
CREATE TABLE public._mig_company_sentiment_scores   AS SELECT * FROM public.company_sentiment_scores_mv;
CREATE TABLE public._mig_company_relevance_scores   AS SELECT * FROM public.company_relevance_scores_mv;
CREATE TABLE public._mig_company_top_sources        AS SELECT * FROM public.company_top_sources_mv;
CREATE TABLE public._mig_company_competitors        AS SELECT * FROM public.company_competitors_mv;
CREATE TABLE public._mig_company_llm_rankings       AS SELECT * FROM public.company_llm_rankings_mv;
CREATE TABLE public._mig_company_attribute_themes   AS SELECT * FROM public.company_attribute_themes_mv;
CREATE TABLE public._mig_company_response_sentiment AS SELECT * FROM public.company_response_sentiment_mv;

DROP MATERIALIZED VIEW public.company_sentiment_scores_mv;
DROP MATERIALIZED VIEW public.company_relevance_scores_mv;
DROP MATERIALIZED VIEW public.company_top_sources_mv;
DROP MATERIALIZED VIEW public.company_competitors_mv;
DROP MATERIALIZED VIEW public.company_llm_rankings_mv;
DROP MATERIALIZED VIEW public.company_attribute_themes_mv;
DROP MATERIALIZED VIEW public.company_response_sentiment_mv;

ALTER TABLE public._mig_company_sentiment_scores   RENAME TO company_sentiment_scores_mv;
ALTER TABLE public._mig_company_relevance_scores   RENAME TO company_relevance_scores_mv;
ALTER TABLE public._mig_company_top_sources        RENAME TO company_top_sources_mv;
ALTER TABLE public._mig_company_competitors        RENAME TO company_competitors_mv;
ALTER TABLE public._mig_company_llm_rankings       RENAME TO company_llm_rankings_mv;
ALTER TABLE public._mig_company_attribute_themes   RENAME TO company_attribute_themes_mv;
ALTER TABLE public._mig_company_response_sentiment RENAME TO company_response_sentiment_mv;

-- -----------------------------------------------------------------------------
-- 2. Recreate the indexes (identical names/definitions to the former MVs).
--    The UNIQUE indexes match each query's GROUP BY key, guarding against
--    accidental duplicate inserts.
-- -----------------------------------------------------------------------------
-- sentiment
CREATE UNIQUE INDEX idx_company_sentiment_scores_mv_unique ON public.company_sentiment_scores_mv (company_id, response_month, prompt_type, prompt_category, prompt_theme, industry_context, job_function_context);
CREATE INDEX idx_sentiment_mv_company_function ON public.company_sentiment_scores_mv (company_id, job_function_context, response_month DESC);
CREATE INDEX idx_sentiment_mv_company_month    ON public.company_sentiment_scores_mv (company_id, response_month DESC);
CREATE INDEX idx_sentiment_mv_company_type     ON public.company_sentiment_scores_mv (company_id, prompt_type, response_month DESC);
CREATE INDEX idx_sentiment_mv_industry         ON public.company_sentiment_scores_mv (industry_context, response_month DESC);
-- relevance
CREATE UNIQUE INDEX idx_company_relevance_scores_mv_unique ON public.company_relevance_scores_mv (company_id, response_month, prompt_type, prompt_category, prompt_theme, industry_context, job_function_context);
CREATE INDEX idx_relevance_mv_company_function ON public.company_relevance_scores_mv (company_id, job_function_context, response_month DESC);
CREATE INDEX idx_relevance_mv_company_month    ON public.company_relevance_scores_mv (company_id, response_month DESC);
CREATE INDEX idx_relevance_mv_company_type     ON public.company_relevance_scores_mv (company_id, prompt_type, response_month DESC);
CREATE INDEX idx_relevance_mv_industry         ON public.company_relevance_scores_mv (industry_context, response_month DESC);
-- top sources
CREATE UNIQUE INDEX company_top_sources_mv_unique_idx ON public.company_top_sources_mv (company_id, domain);
CREATE INDEX company_top_sources_mv_count_idx         ON public.company_top_sources_mv (company_id, citation_count DESC);
-- competitors
CREATE UNIQUE INDEX company_competitors_mv_unique_idx ON public.company_competitors_mv (company_id, competitor_name);
CREATE INDEX company_competitors_mv_count_idx         ON public.company_competitors_mv (company_id, mention_count DESC);
-- llm rankings
CREATE UNIQUE INDEX company_llm_rankings_mv_unique_idx ON public.company_llm_rankings_mv (company_id, ai_model);
-- attribute themes
CREATE UNIQUE INDEX company_attribute_themes_mv_uniq ON public.company_attribute_themes_mv (company_id, response_month, job_function_context, attribute_id);
CREATE INDEX company_attribute_themes_mv_company_idx ON public.company_attribute_themes_mv (company_id);
-- response sentiment
CREATE UNIQUE INDEX company_response_sentiment_mv_uniq ON public.company_response_sentiment_mv (company_id, response_id);
CREATE INDEX company_response_sentiment_mv_company_idx ON public.company_response_sentiment_mv (company_id);

-- -----------------------------------------------------------------------------
-- 3. Access: read-only for anon/authenticated (write grants that were inert on
--    a matview must not carry to a table). service_role keeps full access.
-- -----------------------------------------------------------------------------
DO $grants$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'company_sentiment_scores_mv','company_relevance_scores_mv','company_top_sources_mv',
    'company_competitors_mv','company_llm_rankings_mv','company_attribute_themes_mv',
    'company_response_sentiment_mv'
  ] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $grants$;

-- -----------------------------------------------------------------------------
-- 4. Per-table refresh helpers. Each takes an optional company id:
--      NULL   -> rebuild the whole table (all companies)
--      <uuid> -> rebuild just that company's rows (DELETE + re-INSERT)
--    Defining queries are the live matview definitions plus the company
--    predicate. SECURITY DEFINER; EXECUTE revoked from PUBLIC (only the
--    entry-point functions below call them).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._refresh_cm_sentiment_scores(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  DELETE FROM public.company_sentiment_scores_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_sentiment_scores_mv
  WITH sentiment_responses AS (
    SELECT pr.id, pr.company_id, pr.tested_at, cp.prompt_type, cp.prompt_category, cp.prompt_theme,
           COALESCE(cp.industry_context, c.industry) AS industry_context,
           COALESCE(cp.job_function_context, ''::text) AS job_function_context,
           COALESCE((pr.collection_cycle::timestamp without time zone AT TIME ZONE 'UTC'::text),
                    date_trunc('month'::text, pr.tested_at)) AS response_month
    FROM prompt_responses pr
      JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
      JOIN companies c ON pr.company_id = c.id
    WHERE (cp.prompt_type = ANY (ARRAY['sentiment','competitive']))
      AND pr.company_id IS NOT NULL
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
         CASE WHEN total_themes > 0 THEN positive_themes::numeric / total_themes::numeric ELSE 0::numeric END AS sentiment_ratio,
         COALESCE(avg_sentiment_score, 0::double precision) AS avg_sentiment_score,
         now() AS calculated_at
  FROM ai_themes_aggregated
  WHERE total_themes > 0;
END $fn$;

CREATE OR REPLACE FUNCTION public._refresh_cm_relevance_scores(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  DELETE FROM public.company_relevance_scores_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_relevance_scores_mv
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
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  DELETE FROM public.company_top_sources_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_top_sources_mv
  WITH unnested AS (
    SELECT pr.company_id,
           lower(regexp_replace(c.value ->> 'domain'::text, '^www\.'::text, ''::text)) AS domain,
           c.value ->> 'url'::text AS url
    FROM prompt_responses pr,
         LATERAL jsonb_array_elements(pr.citations) c(value)
    WHERE pr.company_id IS NOT NULL AND pr.for_index IS NOT TRUE AND jsonb_typeof(pr.citations) = 'array'
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
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  DELETE FROM public.company_competitors_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_competitors_mv
  WITH raw AS (
    SELECT pr.company_id,
           normalize_entity_name(TRIM(BOTH FROM unnest(string_to_array(pr.detected_competitors, ','::text)))) AS normalized_alias
    FROM prompt_responses pr
    WHERE pr.company_id IS NOT NULL AND pr.for_index IS NOT TRUE
      AND pr.detected_competitors IS NOT NULL AND pr.detected_competitors <> ''
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
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  DELETE FROM public.company_llm_rankings_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_llm_rankings_mv
  SELECT company_id, ai_model, count(*) AS total_responses,
         count(*) FILTER (WHERE company_mentioned = true) AS mentions,
         round(count(*) FILTER (WHERE company_mentioned = true)::numeric / NULLIF(count(*), 0)::numeric * 100::numeric, 1) AS mention_pct
  FROM prompt_responses
  WHERE company_id IS NOT NULL AND for_index IS NOT TRUE AND ai_model IS NOT NULL
    AND (p_company_id IS NULL OR company_id = p_company_id)
  GROUP BY company_id, ai_model;
END $fn$;

CREATE OR REPLACE FUNCTION public._refresh_cm_attribute_themes(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  DELETE FROM public.company_attribute_themes_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_attribute_themes_mv
  SELECT t.company_id,
         date_trunc('month'::text, pr.tested_at)::date AS response_month,
         COALESCE(NULLIF(btrim(cp.job_function_context), ''::text), ''::text) AS job_function_context,
         btrim(t.attribute_id) AS attribute_id,
         count(*) AS total_themes,
         count(*) FILTER (WHERE t.sentiment = 'positive') AS positive_themes,
         count(*) FILTER (WHERE t.sentiment = 'negative') AS negative_themes,
         count(*) FILTER (WHERE t.sentiment = 'neutral')  AS neutral_themes,
         avg(t.sentiment_score) AS avg_sentiment_score,
         count(DISTINCT t.response_id) AS response_count,
         now() AS calculated_at
  FROM ai_themes t
    JOIN prompt_responses pr ON pr.id = t.response_id
    JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
  WHERE pr.tested_at IS NOT NULL
    AND (btrim(t.attribute_id) = ANY (ARRAY['mission-purpose-impact','compensation','company-culture','leadership','job-security','career-opportunities','wellbeing-balance','inclusion','innovation','application-communication','candidate-feedback','interview-experience','onboarding-experience','mission-purpose','rewards-recognition','social-impact','security-perks','application-process','candidate-communication','overall-candidate-experience']))
    AND (p_company_id IS NULL OR t.company_id = p_company_id)
  GROUP BY t.company_id, (date_trunc('month'::text, pr.tested_at)),
           (COALESCE(NULLIF(btrim(cp.job_function_context), ''::text), ''::text)),
           (btrim(t.attribute_id));
END $fn$;

CREATE OR REPLACE FUNCTION public._refresh_cm_response_sentiment(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  DELETE FROM public.company_response_sentiment_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_response_sentiment_mv
  SELECT company_id, response_id, count(*) AS total_themes,
         count(*) FILTER (WHERE sentiment = 'positive') AS positive_themes,
         count(*) FILTER (WHERE sentiment = 'positive')::double precision / NULLIF(count(*), 0)::double precision AS sentiment_ratio
  FROM ai_themes t
  WHERE response_id IS NOT NULL
    AND (p_company_id IS NULL OR company_id = p_company_id)
  GROUP BY company_id, response_id;
END $fn$;

REVOKE ALL ON FUNCTION
  public._refresh_cm_sentiment_scores(uuid), public._refresh_cm_relevance_scores(uuid),
  public._refresh_cm_top_sources(uuid), public._refresh_cm_competitors(uuid),
  public._refresh_cm_llm_rankings(uuid), public._refresh_cm_attribute_themes(uuid),
  public._refresh_cm_response_sentiment(uuid)
FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 5. Entry points.
-- -----------------------------------------------------------------------------

-- Shared dispatch: the 7 converted tables rebuild via their helper (all
-- companies); anything else (the 6 by-location matviews) via REFRESH ...
-- CONCURRENTLY.
CREATE OR REPLACE FUNCTION public._refresh_cm_dispatch(p_mv_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  CASE p_mv_name
    WHEN 'company_sentiment_scores_mv'   THEN PERFORM public._refresh_cm_sentiment_scores(NULL);
    WHEN 'company_relevance_scores_mv'   THEN PERFORM public._refresh_cm_relevance_scores(NULL);
    WHEN 'company_top_sources_mv'        THEN PERFORM public._refresh_cm_top_sources(NULL);
    WHEN 'company_competitors_mv'        THEN PERFORM public._refresh_cm_competitors(NULL);
    WHEN 'company_llm_rankings_mv'       THEN PERFORM public._refresh_cm_llm_rankings(NULL);
    WHEN 'company_attribute_themes_mv'   THEN PERFORM public._refresh_cm_attribute_themes(NULL);
    WHEN 'company_response_sentiment_mv' THEN PERFORM public._refresh_cm_response_sentiment(NULL);
    ELSE EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I', p_mv_name);
  END CASE;
END $fn$;

REVOKE ALL ON FUNCTION public._refresh_cm_dispatch(text) FROM PUBLIC;

-- Per-company incremental refresh: the hot path. Rebuilds ONE company's rows
-- in all 7 tables. Advisory-locked per company so two concurrent refreshes of
-- the same company (e.g. overlapping collection runs) serialize instead of
-- racing the unique indexes. By-location rollups stay matviews and are NOT
-- covered here; the watermark trigger + staleness tick handle those within
-- minutes.
CREATE OR REPLACE FUNCTION public.refresh_company_metrics(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
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
END $fn$;

-- Convenience wrapper at the ORGANIZATION (customer account) level: refreshes
-- every company the organization tracks (via organization_companies), one
-- per-company refresh at a time, and returns the list of companies rebuilt.
CREATE OR REPLACE FUNCTION public.refresh_organization_metrics(p_organization_id uuid)
RETURNS TABLE(company_id uuid, company_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  r record;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'p_organization_id is required';
  END IF;
  FOR r IN
    SELECT c.id, c.name
    FROM public.organization_companies oc
    JOIN public.companies c ON c.id = oc.company_id
    WHERE oc.organization_id = p_organization_id
    ORDER BY c.name
  LOOP
    PERFORM public.refresh_company_metrics(r.id);
    company_id := r.id;
    company_name := r.name;
    RETURN NEXT;
  END LOOP;
END $fn$;

-- Full rebuild, all companies, all 13 rollups -- keeps the exact status-table
-- contract of the previous monolith (codified in 20260628000000) so existing
-- callers keep working, but is now table-aware via the dispatch. Still the
-- heavy path: run over a direct connection for backfills; steady-state
-- freshness belongs to the tick + the per-company overload above.
CREATE OR REPLACE FUNCTION public.refresh_company_metrics()
RETURNS TABLE(view_name text, refresh_started timestamptz, refresh_completed timestamptz, success boolean, error_message text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_mv    text;
  v_start timestamptz;
BEGIN
  FOREACH v_mv IN ARRAY ARRAY[
    'company_sentiment_scores_mv','company_relevance_scores_mv','company_top_sources_mv',
    'company_competitors_mv','company_llm_rankings_mv','company_attribute_themes_mv',
    'company_response_sentiment_mv',
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
END $fn$;

-- Admin "refresh competitors" RPC (EntityCanonicalizationTab, after approving
-- or merging canonical entities). Rebuilds the competitors table for all
-- companies synchronously, and force-flags the by-location variant (canonical
-- merges affect it too) so the tick refreshes it promptly.
CREATE OR REPLACE FUNCTION public.refresh_company_competitors_mv()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public._refresh_cm_competitors(NULL);
  UPDATE public.mv_refresh_state SET force_refresh = true
   WHERE mv_name = 'company_competitors_by_location_mv';
END $fn$;

REVOKE ALL ON FUNCTION public.refresh_company_metrics(uuid)         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_organization_metrics(uuid)    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_company_metrics()             FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_company_competitors_mv()      FROM PUBLIC;

-- Per-company (and per-organization) refresh is cheap and safe for the app
-- (admin recalc) and services. The full rebuild stays service_role-only so a
-- logged-in user can't trigger the heavy all-companies path.
GRANT EXECUTE ON FUNCTION public.refresh_company_metrics(uuid)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_organization_metrics(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_company_metrics()          TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_company_competitors_mv()   TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Make the staleness tick (20260628000001) table-aware. Identical logic
--    and bookkeeping; only the refresh step changes to the shared dispatch,
--    so the 7 tables full-rebuild via helpers and the 6 by-location matviews
--    keep REFRESH ... CONCURRENTLY. mv_refresh_state rows are unchanged.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_metrics_tick()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_mv         text;
  v_watermark  timestamptz;
  v_start      timestamptz;
  v_rows       bigint;
  v_cooldown   interval := interval '15 minutes';
BEGIN
  SET LOCAL statement_timeout = 0;
  SET LOCAL lock_timeout = '30s';

  IF NOT pg_try_advisory_xact_lock(913372) THEN
    RETURN 'busy';
  END IF;

  SELECT data_changed_at INTO v_watermark FROM public.mv_refresh_watermark WHERE id;

  SELECT mv_name INTO v_mv
  FROM public.mv_refresh_state
  WHERE force_refresh
     OR last_refresh_finished IS NULL
     OR ( (v_watermark IS NOT NULL AND last_refresh_finished < v_watermark)
          AND last_refresh_finished < now() - v_cooldown )
  ORDER BY force_refresh DESC, last_refresh_finished ASC NULLS FIRST
  LIMIT 1;

  IF v_mv IS NULL THEN
    RETURN 'idle';
  END IF;

  v_start := clock_timestamp();
  UPDATE public.mv_refresh_state
     SET last_refresh_started = v_start, last_status = 'running'
   WHERE mv_name = v_mv;

  BEGIN
    -- Tables (the 7 company-level rollups) rebuild via their incremental
    -- helper; matviews (the 6 by-location rollups) via REFRESH CONCURRENTLY.
    PERFORM public._refresh_cm_dispatch(v_mv);
    EXECUTE format('SELECT count(*) FROM %I', v_mv) INTO v_rows;
    UPDATE public.mv_refresh_state
       SET last_refresh_finished = clock_timestamp(),
           last_status = 'success',
           last_error = NULL,
           last_duration_ms = round(extract(epoch FROM (clock_timestamp() - v_start)) * 1000)::int,
           row_count = v_rows,
           force_refresh = false
     WHERE mv_name = v_mv;
    RETURN 'refreshed:' || v_mv;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.mv_refresh_state
       SET last_refresh_finished = clock_timestamp(),
           last_status = 'error',
           last_error = SQLERRM,
           last_duration_ms = round(extract(epoch FROM (clock_timestamp() - v_start)) * 1000)::int,
           force_refresh = false
     WHERE mv_name = v_mv;
    RETURN 'error:' || v_mv || ':' || SQLERRM;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_metrics_tick() TO postgres, service_role;

-- -----------------------------------------------------------------------------
-- 7. Planner stats. The tables were created as snapshot copies of the MV
--    contents (step 1), so no backfill is needed and mv_refresh_state is left
--    untouched -- its timestamps still truthfully describe this data. The
--    tick and per-company refreshes take over maintenance from here.
-- -----------------------------------------------------------------------------
ANALYZE public.company_sentiment_scores_mv;
ANALYZE public.company_relevance_scores_mv;
ANALYZE public.company_top_sources_mv;
ANALYZE public.company_competitors_mv;
ANALYZE public.company_llm_rankings_mv;
ANALYZE public.company_attribute_themes_mv;
ANALYZE public.company_response_sentiment_mv;

-- -----------------------------------------------------------------------------
-- 8. Comments
-- -----------------------------------------------------------------------------
COMMENT ON TABLE public.company_sentiment_scores_mv   IS 'Per (company, month, prompt dims) sentiment aggregates. Incrementally maintained per-company by refresh_company_metrics(company_id); full rebuilds via the staleness tick. (Was a materialized view; converted 2026-07-06.)';
COMMENT ON TABLE public.company_relevance_scores_mv   IS 'Per (company, month, prompt dims) citation-recency relevance. Maintained by refresh_company_metrics(company_id) + staleness tick.';
COMMENT ON TABLE public.company_top_sources_mv        IS 'Per (company, normalized domain) citation counts. Maintained by refresh_company_metrics(company_id) + staleness tick.';
COMMENT ON TABLE public.company_competitors_mv        IS 'Per (company, canonical competitor) mention counts. Maintained by refresh_company_metrics(company_id), refresh_company_competitors_mv(), and the staleness tick.';
COMMENT ON TABLE public.company_llm_rankings_mv       IS 'Per (company, ai_model) mention rates. Maintained by refresh_company_metrics(company_id) + staleness tick.';
COMMENT ON TABLE public.company_attribute_themes_mv   IS 'Per (company, month, job_function, attribute) theme aggregates. Maintained by refresh_company_metrics(company_id) + staleness tick.';
COMMENT ON TABLE public.company_response_sentiment_mv IS 'Per (company, response) positive/total theme ratio. Maintained by refresh_company_metrics(company_id) + staleness tick.';

COMMENT ON FUNCTION public.refresh_company_metrics(uuid)      IS 'Incrementally rebuilds the 7 company-level rollup tables for ONE company (DELETE+INSERT scoped by company_id). Fast, indexed, timeout-proof. Called by collect-company-responses after data lands. By-location rollups are matviews handled by refresh_metrics_tick.';
COMMENT ON FUNCTION public.refresh_organization_metrics(uuid) IS 'Refreshes the 7 rollup tables for EVERY company an organization (customer account) tracks via organization_companies; returns the companies rebuilt. Convenience wrapper over refresh_company_metrics(company_id).';
COMMENT ON FUNCTION public.refresh_company_metrics()          IS 'Full rebuild of all 13 rollups (7 tables via helpers, 6 by-location matviews via REFRESH CONCURRENTLY), returning a per-rollup status row. Heavy: run over a direct connection for backfills; steady-state freshness belongs to refresh_metrics_tick + the per-company overload.';
COMMENT ON FUNCTION public._refresh_cm_dispatch(text)         IS 'Refreshes one rollup by name: the 7 converted tables rebuild via their incremental helper (all companies); anything else is REFRESH MATERIALIZED VIEW CONCURRENTLY. Shared by refresh_metrics_tick and refresh_company_metrics().';

COMMIT;
