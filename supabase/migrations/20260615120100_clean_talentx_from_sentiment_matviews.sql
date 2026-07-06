-- Remove dead 'talentx_*' prompt_type literals from sentiment matview filters.
-- (After the core migration no rows carry those values; this just cleans the defs.)

DROP MATERIALIZED VIEW IF EXISTS public.company_sentiment_scores_mv;
CREATE MATERIALIZED VIEW public.company_sentiment_scores_mv AS
 WITH sentiment_responses AS (
         SELECT pr.id, pr.company_id, pr.tested_at, cp.prompt_type, cp.prompt_category, cp.prompt_theme,
            COALESCE(cp.industry_context, c.industry) AS industry_context,
            COALESCE(cp.job_function_context, ''::text) AS job_function_context,
            COALESCE((pr.collection_cycle::timestamp without time zone AT TIME ZONE 'UTC'::text), date_trunc('month'::text, pr.tested_at)) AS response_month
           FROM prompt_responses pr
             JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
             JOIN companies c ON pr.company_id = c.id
          WHERE (cp.prompt_type = ANY (ARRAY['sentiment'::text, 'competitive'::text])) AND pr.company_id IS NOT NULL
        ), ai_themes_aggregated AS (
         SELECT sr.company_id, sr.response_month, sr.prompt_type, sr.prompt_category, sr.prompt_theme, sr.industry_context, sr.job_function_context,
            count(DISTINCT at.id) AS total_themes,
            count(DISTINCT at.id) FILTER (WHERE at.sentiment = 'positive'::text) AS positive_themes,
            count(DISTINCT at.id) FILTER (WHERE at.sentiment = 'negative'::text) AS negative_themes,
            count(DISTINCT at.id) FILTER (WHERE at.sentiment = 'neutral'::text) AS neutral_themes,
            avg(at.sentiment_score) AS avg_sentiment_score
           FROM sentiment_responses sr
             LEFT JOIN ai_themes at ON sr.id = at.response_id
          GROUP BY sr.company_id, sr.response_month, sr.prompt_type, sr.prompt_category, sr.prompt_theme, sr.industry_context, sr.job_function_context
        )
 SELECT company_id, response_month, prompt_type, prompt_category, prompt_theme, industry_context, job_function_context,
    total_themes, positive_themes, negative_themes, neutral_themes,
    CASE WHEN total_themes > 0 THEN positive_themes::numeric / total_themes::numeric ELSE 0::numeric END AS sentiment_ratio,
    COALESCE(avg_sentiment_score, 0::double precision) AS avg_sentiment_score,
    now() AS calculated_at
   FROM ai_themes_aggregated
  WHERE total_themes > 0;

CREATE UNIQUE INDEX idx_company_sentiment_scores_mv_unique ON public.company_sentiment_scores_mv USING btree (company_id, response_month, prompt_type, prompt_category, prompt_theme, industry_context, job_function_context);
CREATE INDEX idx_sentiment_mv_company_function ON public.company_sentiment_scores_mv USING btree (company_id, job_function_context, response_month DESC);
CREATE INDEX idx_sentiment_mv_company_month ON public.company_sentiment_scores_mv USING btree (company_id, response_month DESC);
CREATE INDEX idx_sentiment_mv_company_type ON public.company_sentiment_scores_mv USING btree (company_id, prompt_type, response_month DESC);
CREATE INDEX idx_sentiment_mv_industry ON public.company_sentiment_scores_mv USING btree (industry_context, response_month DESC);

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
          WHERE (cp.prompt_type = ANY (ARRAY['sentiment'::text, 'competitive'::text])) AND pr.company_id IS NOT NULL
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
    CASE WHEN total_themes > 0 THEN positive_themes::numeric / total_themes::numeric ELSE 0::numeric END AS sentiment_ratio,
    COALESCE(avg_sentiment_score, 0::double precision) AS avg_sentiment_score,
    now() AS calculated_at
   FROM ai_themes_aggregated
  WHERE total_themes > 0;

CREATE INDEX company_sentiment_by_location_mv_lookup ON public.company_sentiment_scores_by_location_mv USING btree (company_id, location_context, response_month DESC);
CREATE UNIQUE INDEX company_sentiment_by_location_mv_uniq ON public.company_sentiment_scores_by_location_mv USING btree (company_id, location_context, response_month, prompt_type, prompt_category, prompt_theme, industry_context, job_function_context);
