-- ============================================================================
-- Materialized View: Company Attribute Themes (pre-aggregated attribute scores)
-- ============================================================================
-- Moves the dashboard's per-attribute theme aggregation off the client. The
-- frontend used to eagerly pull every ai_themes row for a company (tens of
-- thousands of rows, ~24 paginated requests) and aggregate in JS on every
-- load -- the slowest part of the dashboard. This MV pre-aggregates the same
-- numbers per company / month / job function / canonical TalentX attribute so
-- the client reads a few hundred rows instead.
--
-- STRICT canonical filter: only the 16 TalentX attribute ids from
-- src/config/talentXAttributes.ts are kept. ai_themes.talentx_attribute_id
-- also contains a long tail of LLM-hallucinated subtheme ids (each with a
-- handful of rows) plus whitespace variants (e.g. ' wellbeing-balance'); those
-- are dropped here, matching what ThematicAnalysisTab already shows via its
-- validAttributeIds filter. btrim() folds the whitespace variants in.
--
-- Refreshed on demand by refresh_company_metrics() after new data lands
-- (collection-driven), not on a cron.

CREATE MATERIALIZED VIEW IF NOT EXISTS public.company_attribute_themes_mv AS
SELECT
  t.company_id,
  DATE_TRUNC('month', pr.tested_at)::date              AS response_month,
  COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') AS job_function_context,
  btrim(t.talentx_attribute_id)                         AS attribute_id,
  COUNT(*)                                              AS total_themes,
  COUNT(*) FILTER (WHERE t.sentiment = 'positive')      AS positive_themes,
  COUNT(*) FILTER (WHERE t.sentiment = 'negative')      AS negative_themes,
  COUNT(*) FILTER (WHERE t.sentiment = 'neutral')       AS neutral_themes,
  AVG(t.sentiment_score)                                AS avg_sentiment_score,
  COUNT(DISTINCT t.response_id)                         AS response_count,
  NOW()                                                 AS calculated_at
FROM public.ai_themes t
JOIN public.prompt_responses pr  ON pr.id = t.response_id
JOIN public.confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
WHERE pr.tested_at IS NOT NULL
  AND btrim(t.talentx_attribute_id) IN (
    'mission-purpose','rewards-recognition','company-culture','social-impact','inclusion',
    'innovation','wellbeing-balance','leadership','security-perks','career-opportunities',
    'application-process','candidate-communication','interview-experience','candidate-feedback',
    'onboarding-experience','overall-candidate-experience'
  )
GROUP BY
  t.company_id,
  DATE_TRUNC('month', pr.tested_at),
  COALESCE(NULLIF(btrim(cp.job_function_context), ''), ''),
  btrim(t.talentx_attribute_id);

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS company_attribute_themes_mv_uniq
  ON public.company_attribute_themes_mv (company_id, response_month, job_function_context, attribute_id);

-- Lookup index for the dashboard's per-company reads.
CREATE INDEX IF NOT EXISTS company_attribute_themes_mv_company_idx
  ON public.company_attribute_themes_mv (company_id);

-- Match the access pattern of the other company_*_mv views: readable by the
-- client roles, scoped at query time by an explicit company_id filter.
GRANT SELECT ON public.company_attribute_themes_mv TO anon, authenticated, service_role;
