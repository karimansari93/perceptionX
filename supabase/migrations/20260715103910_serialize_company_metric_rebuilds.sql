-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260715103910; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Serialize company-metric table rebuilds (fix 23505 race with the tick).
-- Same content as repo migration 20260715000000_serialize_company_metric_rebuilds.sql
-- (PR #55): every per-table helper takes a per-TABLE advisory xact lock before
-- its DELETE, so the tick's full rebuild and per-company/org refreshes of the
-- same table queue instead of colliding; lock_timeout is cleared so queued
-- rebuilds wait rather than error.

CREATE OR REPLACE FUNCTION public._refresh_cm_sentiment_scores(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_sentiment_scores_mv', 0));
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
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_relevance_scores_mv', 0));
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
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_top_sources_mv', 0));
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
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_competitors_mv', 0));
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
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_llm_rankings_mv', 0));
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
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_attribute_themes_mv', 0));
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
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_response_sentiment_mv', 0));
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

COMMENT ON FUNCTION public._refresh_cm_sentiment_scores(uuid)   IS 'Rebuilds company_sentiment_scores_mv (one company or all). Serialized per table via advisory lock cm_refresh:company_sentiment_scores_mv.';
COMMENT ON FUNCTION public._refresh_cm_relevance_scores(uuid)   IS 'Rebuilds company_relevance_scores_mv (one company or all). Serialized per table via advisory lock cm_refresh:company_relevance_scores_mv.';
COMMENT ON FUNCTION public._refresh_cm_top_sources(uuid)        IS 'Rebuilds company_top_sources_mv (one company or all). Serialized per table via advisory lock cm_refresh:company_top_sources_mv.';
COMMENT ON FUNCTION public._refresh_cm_competitors(uuid)        IS 'Rebuilds company_competitors_mv (one company or all). Serialized per table via advisory lock cm_refresh:company_competitors_mv.';
COMMENT ON FUNCTION public._refresh_cm_llm_rankings(uuid)       IS 'Rebuilds company_llm_rankings_mv (one company or all). Serialized per table via advisory lock cm_refresh:company_llm_rankings_mv.';
COMMENT ON FUNCTION public._refresh_cm_attribute_themes(uuid)   IS 'Rebuilds company_attribute_themes_mv (one company or all). Serialized per table via advisory lock cm_refresh:company_attribute_themes_mv.';
COMMENT ON FUNCTION public._refresh_cm_response_sentiment(uuid) IS 'Rebuilds company_response_sentiment_mv (one company or all). Serialized per table via advisory lock cm_refresh:company_response_sentiment_mv.';
