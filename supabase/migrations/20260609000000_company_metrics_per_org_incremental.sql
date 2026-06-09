-- =============================================================================
-- Company metrics: per-organization incremental refresh
-- =============================================================================
--
-- Problem
-- -------
-- refresh_company_metrics() rebuilt SEVEN materialized views for EVERY company
-- in a single transaction (REFRESH MATERIALIZED VIEW CONCURRENTLY x7), scanning
-- the full ~490 MB / 146k-row prompt_responses table each run. Measured cost:
-- mean ~43s, now hitting 120s+. Every execution path has a ceiling it now
-- exceeds: the SQL editor / REST gateway (~60s) and the pg_cron / server-side
-- path (a hard ~120s). Worse, because all seven refreshes share one transaction,
-- hitting the cap on the last view ROLLS BACK ALL SEVEN -- so a slow run updated
-- nothing. As data grew this went from "occasionally slow" to "always fails".
--
-- The operation we actually want is "recompute one organization", but a
-- materialized view can only be refreshed in full -- there is no per-company
-- REFRESH. So this migration converts the seven MVs into regular TABLES and
-- replaces the monolithic refresh with an incremental, per-organization one:
--
--     refresh_company_metrics(p_company_id uuid)
--
-- which, for each table, does DELETE WHERE company_id = X; INSERT ... WHERE
-- company_id = X. prompt_responses / ai_themes are already indexed on
-- company_id, so one org touches only its own rows -> sub-second to a few
-- seconds, no timeout, and a fraction of the Disk IO that forced the hourly
-- refresh crons to be disabled (see 20260602000001).
--
-- What stays the same
-- -------------------
--   * Object names are unchanged (company_*_mv), so the frontend -- which reads
--     these objects directly and filters by company_id -- keeps working as-is.
--   * Column shapes, indexes, and the (read-only) access for anon/authenticated
--     are preserved. Write privileges that were inert on a matview are revoked,
--     since on a TABLE they would let clients mutate the metrics.
--
-- What changes
-- ------------
--   * company_*_mv are now tables, populated by the functions below instead of
--     REFRESH MATERIALIZED VIEW.
--   * refresh_company_metrics() is overloaded: (uuid) = one org (the hot path,
--     called by collect-company-responses); () = full rebuild (kept for
--     backwards compatibility, delegates to refresh_all_company_metrics()).
--   * refresh_all_company_metrics() rebuilds every org, table by table. It is
--     heavy (~the old full cost) and is intended for backfills / rare full
--     rebuilds run over a DIRECT connection (psql / supabase db push), where no
--     statement-timeout cap applies.
--
-- Nothing else depends on these MVs (verified via pg_depend: only the two
-- functions refresh_company_metrics and refresh_company_competitors_mv
-- referenced them, and both are redefined here). The parallel company_*_by_
-- location_mv / company_overview_* MVs are independent and out of scope.
--
-- Deploy note: apply over a direct connection (supabase db push / psql). The
-- whole migration is one transaction -- readers keep seeing the old MVs until
-- COMMIT, then atomically see the new, fully-populated tables.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Convert each materialized view into a table.
--    Clone the exact column shape from the existing MV (SELECT * ... WITH NO
--    DATA -- no need to restate column types), drop the MV, rename into place.
--    All within this transaction, so the swap is atomic for readers.
-- -----------------------------------------------------------------------------
CREATE TABLE public._mig_company_sentiment_scores  AS SELECT * FROM public.company_sentiment_scores_mv  WITH NO DATA;
CREATE TABLE public._mig_company_relevance_scores  AS SELECT * FROM public.company_relevance_scores_mv  WITH NO DATA;
CREATE TABLE public._mig_company_top_sources       AS SELECT * FROM public.company_top_sources_mv       WITH NO DATA;
CREATE TABLE public._mig_company_competitors       AS SELECT * FROM public.company_competitors_mv       WITH NO DATA;
CREATE TABLE public._mig_company_llm_rankings      AS SELECT * FROM public.company_llm_rankings_mv      WITH NO DATA;
CREATE TABLE public._mig_company_attribute_themes  AS SELECT * FROM public.company_attribute_themes_mv  WITH NO DATA;
CREATE TABLE public._mig_company_response_sentiment AS SELECT * FROM public.company_response_sentiment_mv WITH NO DATA;

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
--    The UNIQUE indexes match each query's GROUP BY key, so they also guard
--    against accidental duplicate inserts.
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
CREATE UNIQUE INDEX company_attribute_themes_mv_uniq      ON public.company_attribute_themes_mv (company_id, response_month, job_function_context, attribute_id);
CREATE INDEX company_attribute_themes_mv_company_idx      ON public.company_attribute_themes_mv (company_id);
-- response sentiment
CREATE UNIQUE INDEX company_response_sentiment_mv_uniq    ON public.company_response_sentiment_mv (company_id, response_id);
CREATE INDEX company_response_sentiment_mv_company_idx    ON public.company_response_sentiment_mv (company_id);

-- -----------------------------------------------------------------------------
-- 3. Access: preserve read-only access for anon/authenticated; never let them
--    write (these were matviews -- the inherited INSERT/UPDATE/DELETE grants
--    were inert, but on a table they are not). service_role keeps full access.
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
--      NULL      -> rebuild the whole table (all orgs)
--      <uuid>    -> rebuild just that org's rows (DELETE + re-INSERT)
--    The defining query is identical to the former MV, plus the company
--    predicate. SECURITY DEFINER so a future authenticated "recalculate"
--    action can run them; EXECUTE is revoked from PUBLIC (orchestrators call
--    them as the definer).
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
    WHERE (cp.prompt_type = ANY (ARRAY['sentiment','competitive','talentx_sentiment','talentx_competitive']))
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
         btrim(t.talentx_attribute_id) AS attribute_id,
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
    AND (btrim(t.talentx_attribute_id) = ANY (ARRAY['mission-purpose','rewards-recognition','company-culture','social-impact','inclusion','innovation','wellbeing-balance','leadership','security-perks','career-opportunities','application-process','candidate-communication','interview-experience','candidate-feedback','onboarding-experience','overall-candidate-experience']))
    AND (p_company_id IS NULL OR t.company_id = p_company_id)
  GROUP BY t.company_id, (date_trunc('month'::text, pr.tested_at)),
           (COALESCE(NULLIF(btrim(cp.job_function_context), ''::text), ''::text)),
           (btrim(t.talentx_attribute_id));
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
-- 5. Public entry points.
-- -----------------------------------------------------------------------------

-- Per-organization incremental refresh. The hot path: fast, indexed, no
-- timeout. Call this after an org's data lands (collect-company-responses).
CREATE OR REPLACE FUNCTION public.refresh_company_metrics(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public._refresh_cm_sentiment_scores(p_company_id);
  PERFORM public._refresh_cm_relevance_scores(p_company_id);
  PERFORM public._refresh_cm_top_sources(p_company_id);
  PERFORM public._refresh_cm_competitors(p_company_id);
  PERFORM public._refresh_cm_llm_rankings(p_company_id);
  PERFORM public._refresh_cm_attribute_themes(p_company_id);
  PERFORM public._refresh_cm_response_sentiment(p_company_id);
END $fn$;

-- Full rebuild (all orgs), table by table. Heavy -- intended for backfills and
-- rare full rebuilds run over a DIRECT connection (psql / supabase db push),
-- where the ~120s server-side statement-timeout does not apply.
CREATE OR REPLACE FUNCTION public.refresh_all_company_metrics()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.refresh_company_metrics(NULL::uuid);
END $fn$;

-- The previous monolithic refresh_company_metrics() returned a status table;
-- replace it with a void no-arg shim that delegates to the full rebuild so
-- existing callers (and the disabled hourly cron) keep resolving.
DROP FUNCTION IF EXISTS public.refresh_company_metrics();
CREATE OR REPLACE FUNCTION public.refresh_company_metrics()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.refresh_all_company_metrics();
END $fn$;

-- Admin "refresh competitors" RPC (called from EntityCanonicalizationTab after
-- approving/merging canonical entities). Now repopulates the competitors table
-- for all orgs instead of REFRESH MATERIALIZED VIEW.
CREATE OR REPLACE FUNCTION public.refresh_company_competitors_mv()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public._refresh_cm_competitors(NULL::uuid);
END $fn$;

REVOKE ALL ON FUNCTION public.refresh_company_metrics(uuid)   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_company_metrics()       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_all_company_metrics()   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_company_competitors_mv() FROM PUBLIC;

-- Per-org refresh is cheap and safe to expose to the app (admin "recalculate"
-- buttons) as well as service_role. Full rebuilds stay service_role-only so a
-- logged-in user can't trigger the heavy all-orgs path.
GRANT EXECUTE ON FUNCTION public.refresh_company_metrics(uuid)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_company_metrics()        TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_all_company_metrics()    TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_company_competitors_mv() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Initial backfill (all orgs) + planner stats. One transaction with the
--    swap above, so the new tables are fully populated the moment this commits.
-- -----------------------------------------------------------------------------
SELECT public.refresh_all_company_metrics();

ANALYZE public.company_sentiment_scores_mv;
ANALYZE public.company_relevance_scores_mv;
ANALYZE public.company_top_sources_mv;
ANALYZE public.company_competitors_mv;
ANALYZE public.company_llm_rankings_mv;
ANALYZE public.company_attribute_themes_mv;
ANALYZE public.company_response_sentiment_mv;

-- -----------------------------------------------------------------------------
-- 7. Comments
-- -----------------------------------------------------------------------------
COMMENT ON TABLE public.company_sentiment_scores_mv   IS 'Per (company, month, prompt dims) sentiment aggregates. Incrementally maintained per-org by refresh_company_metrics(company_id). (Was a materialized view; converted 2026-06-09.)';
COMMENT ON TABLE public.company_relevance_scores_mv   IS 'Per (company, month, prompt dims) citation-recency relevance. Maintained by refresh_company_metrics(company_id).';
COMMENT ON TABLE public.company_top_sources_mv        IS 'Per (company, normalized domain) citation counts. Maintained by refresh_company_metrics(company_id).';
COMMENT ON TABLE public.company_competitors_mv        IS 'Per (company, canonical competitor) mention counts. Maintained by refresh_company_metrics(company_id) and refresh_company_competitors_mv().';
COMMENT ON TABLE public.company_llm_rankings_mv       IS 'Per (company, ai_model) mention rates. Maintained by refresh_company_metrics(company_id).';
COMMENT ON TABLE public.company_attribute_themes_mv   IS 'Per (company, month, job_function, attribute) theme aggregates. Maintained by refresh_company_metrics(company_id).';
COMMENT ON TABLE public.company_response_sentiment_mv IS 'Per (company, response) positive/total theme ratio. Maintained by refresh_company_metrics(company_id).';

COMMENT ON FUNCTION public.refresh_company_metrics(uuid) IS 'Incrementally rebuilds all company metric tables for ONE organization (DELETE+INSERT scoped by company_id). Fast, indexed, timeout-proof. Call after an org''s data lands.';
COMMENT ON FUNCTION public.refresh_all_company_metrics() IS 'Full rebuild of every company metric table for ALL orgs. Heavy; run over a direct connection (psql / supabase db push) to avoid the ~120s server-side statement timeout.';
COMMENT ON FUNCTION public.refresh_company_metrics()     IS 'Backwards-compatible no-arg shim; delegates to refresh_all_company_metrics().';

COMMIT;
