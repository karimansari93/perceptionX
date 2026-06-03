-- Make the sentiment & relevance company MVs cycle-aware.
--
-- These MVs computed their own bucket as date_trunc('month', tested_at), which
-- splits a collection that crosses a calendar-month boundary (and ignores the
-- collection_cycle label). They now honor collection_cycle when set and
-- otherwise fall back to that exact tested_at month -- byte-identical for every
-- untagged row, so no other client's history changes.
--
-- Atomic drop+recreate (nothing depends on these MVs); all indexes and grants
-- are restored in the same transaction so PostgREST access is unchanged.

DROP MATERIALIZED VIEW IF EXISTS public.company_sentiment_scores_mv;
CREATE MATERIALIZED VIEW public.company_sentiment_scores_mv AS
 WITH sentiment_responses AS (
         SELECT pr.id,
            pr.company_id,
            pr.tested_at,
            cp.prompt_type,
            cp.prompt_category,
            cp.prompt_theme,
            COALESCE(cp.industry_context, c.industry) AS industry_context,
            COALESCE(cp.job_function_context, ''::text) AS job_function_context,
            COALESCE((pr.collection_cycle::timestamp AT TIME ZONE 'UTC'), date_trunc('month'::text, pr.tested_at)) AS response_month
           FROM prompt_responses pr
             JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
             JOIN companies c ON pr.company_id = c.id
          WHERE (cp.prompt_type = ANY (ARRAY['sentiment'::text, 'competitive'::text, 'talentx_sentiment'::text, 'talentx_competitive'::text])) AND pr.company_id IS NOT NULL
        ), ai_themes_aggregated AS (
         SELECT sr.company_id,
            sr.response_month,
            sr.prompt_type,
            sr.prompt_category,
            sr.prompt_theme,
            sr.industry_context,
            sr.job_function_context,
            count(DISTINCT at.id) AS total_themes,
            count(DISTINCT at.id) FILTER (WHERE at.sentiment = 'positive'::text) AS positive_themes,
            count(DISTINCT at.id) FILTER (WHERE at.sentiment = 'negative'::text) AS negative_themes,
            count(DISTINCT at.id) FILTER (WHERE at.sentiment = 'neutral'::text) AS neutral_themes,
            avg(at.sentiment_score) AS avg_sentiment_score
           FROM sentiment_responses sr
             LEFT JOIN ai_themes at ON sr.id = at.response_id
          GROUP BY sr.company_id, sr.response_month, sr.prompt_type, sr.prompt_category, sr.prompt_theme, sr.industry_context, sr.job_function_context
        )
 SELECT company_id, response_month, prompt_type, prompt_category, prompt_theme,
    industry_context, job_function_context, total_themes, positive_themes,
    negative_themes, neutral_themes,
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
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.company_sentiment_scores_mv TO anon, authenticated, service_role;

DROP MATERIALIZED VIEW IF EXISTS public.company_relevance_scores_mv;
CREATE MATERIALIZED VIEW public.company_relevance_scores_mv AS
 WITH citation_urls AS (
         SELECT pr.id AS response_id,
            pr.company_id,
            pr.tested_at,
            cp.prompt_type,
            cp.prompt_category,
            cp.prompt_theme,
            COALESCE(cp.industry_context, c.industry) AS industry_context,
            COALESCE(cp.job_function_context, ''::text) AS job_function_context,
            jsonb_array_elements(pr.citations) ->> 'url'::text AS citation_url,
            COALESCE((pr.collection_cycle::timestamp AT TIME ZONE 'UTC'), date_trunc('month'::text, pr.tested_at)) AS response_month
           FROM prompt_responses pr
             JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
             JOIN companies c ON pr.company_id = c.id
          WHERE pr.citations IS NOT NULL AND jsonb_array_length(pr.citations) > 0 AND pr.company_id IS NOT NULL AND pr.company_mentioned = true
        ), relevance_aggregated AS (
         SELECT cu.company_id,
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
          GROUP BY cu.company_id, cu.response_month, cu.prompt_type, cu.prompt_category, cu.prompt_theme, cu.industry_context, cu.job_function_context
        )
 SELECT company_id, response_month, prompt_type, prompt_category, prompt_theme,
    industry_context, job_function_context, total_citations, valid_citations,
    COALESCE(avg_relevance_score, 0::numeric) AS relevance_score,
        CASE WHEN total_citations > 0 THEN valid_citations::numeric / total_citations::numeric * 100::numeric ELSE 0::numeric END AS citation_coverage_percentage,
    now() AS calculated_at
   FROM relevance_aggregated
  WHERE total_citations > 0;

CREATE UNIQUE INDEX idx_company_relevance_scores_mv_unique ON public.company_relevance_scores_mv USING btree (company_id, response_month, prompt_type, prompt_category, prompt_theme, industry_context, job_function_context);
CREATE INDEX idx_relevance_mv_company_function ON public.company_relevance_scores_mv USING btree (company_id, job_function_context, response_month DESC);
CREATE INDEX idx_relevance_mv_company_month ON public.company_relevance_scores_mv USING btree (company_id, response_month DESC);
CREATE INDEX idx_relevance_mv_company_type ON public.company_relevance_scores_mv USING btree (company_id, prompt_type, response_month DESC);
CREATE INDEX idx_relevance_mv_industry ON public.company_relevance_scores_mv USING btree (industry_context, response_month DESC);
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.company_relevance_scores_mv TO anon, authenticated, service_role;
