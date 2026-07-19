-- Methodology fix (2026-07-18, applied to production the same day): the
-- dashboard sentiment score previously counted only themes from prompts of
-- type 'sentiment'/'competitive'. The prompt library uses
-- informational/experience/discovery/competitive (no 'sentiment' type), so
-- ~70% of themes — including the heavily-negative 'experience' prompts — were
-- excluded from the headline score while the attribute-themes exhibits counted
-- everything. From this migration on, the sentiment score counts ALL themes,
-- matching the attribute table. Applied at the July-2026 fresh-baseline cycle
-- so no quarter-over-quarter restatement is needed.
--
-- NOTE: the by-location MV is created WITH NO DATA; production population was
-- run server-side via a one-shot pg_cron job (plain REFRESH + a full
-- _refresh_cm_sentiment_scores(NULL) rebuild) because the build exceeds
-- interactive statement budgets.

-- 1. Per-company sentiment table refresh: drop the prompt_type filter.
CREATE OR REPLACE FUNCTION public._refresh_cm_sentiment_scores(p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    WHERE pr.company_id IS NOT NULL
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
END $function$;

-- 2. Location-level sentiment MV: recreate without the prompt_type filter.
DROP MATERIALIZED VIEW public.company_sentiment_scores_by_location_mv;

CREATE MATERIALIZED VIEW public.company_sentiment_scores_by_location_mv AS
 WITH sentiment_responses AS (
         SELECT pr.id,
            pr.company_id,
            pr.tested_at,
            cp.prompt_type,
            cp.prompt_category,
            cp.prompt_theme,
            COALESCE(cp.industry_context, c.industry) AS industry_context,
            COALESCE(cp.job_function_context, ''::text) AS job_function_context,
            COALESCE(NULLIF(btrim(cp.location_context), ''::text), ''::text) AS location_context,
            COALESCE(((pr.collection_cycle)::timestamp without time zone AT TIME ZONE 'UTC'::text), date_trunc('month'::text, pr.tested_at)) AS response_month
           FROM ((prompt_responses pr
             JOIN confirmed_prompts cp ON ((pr.confirmed_prompt_id = cp.id)))
             JOIN companies c ON ((pr.company_id = c.id)))
          WHERE (pr.company_id IS NOT NULL)
        ), ai_themes_aggregated AS (
         SELECT sr.company_id,
            sr.location_context,
            sr.response_month,
            sr.prompt_type,
            sr.prompt_category,
            sr.prompt_theme,
            sr.industry_context,
            sr.job_function_context,
            count(DISTINCT at.id) AS total_themes,
            count(DISTINCT at.id) FILTER (WHERE (at.sentiment = 'positive'::text)) AS positive_themes,
            count(DISTINCT at.id) FILTER (WHERE (at.sentiment = 'negative'::text)) AS negative_themes,
            count(DISTINCT at.id) FILTER (WHERE (at.sentiment = 'neutral'::text)) AS neutral_themes,
            avg(at.sentiment_score) AS avg_sentiment_score
           FROM (sentiment_responses sr
             LEFT JOIN ai_themes at ON ((sr.id = at.response_id)))
          GROUP BY sr.company_id, sr.location_context, sr.response_month, sr.prompt_type, sr.prompt_category, sr.prompt_theme, sr.industry_context, sr.job_function_context
        )
 SELECT company_id,
    location_context,
    response_month,
    prompt_type,
    prompt_category,
    prompt_theme,
    industry_context,
    job_function_context,
    total_themes,
    positive_themes,
    negative_themes,
    neutral_themes,
        CASE
            WHEN (total_themes > 0) THEN ((positive_themes)::numeric / (total_themes)::numeric)
            ELSE (0)::numeric
        END AS sentiment_ratio,
    COALESCE(avg_sentiment_score, (0)::double precision) AS avg_sentiment_score,
    now() AS calculated_at
   FROM ai_themes_aggregated
  WHERE (total_themes > 0)
 WITH NO DATA;

CREATE UNIQUE INDEX company_sentiment_by_location_mv_uniq
  ON public.company_sentiment_scores_by_location_mv
  USING btree (company_id, location_context, response_month, prompt_type, prompt_category, prompt_theme, industry_context, job_function_context);

CREATE INDEX company_sentiment_by_location_mv_lookup
  ON public.company_sentiment_scores_by_location_mv
  USING btree (company_id, location_context, response_month DESC);
