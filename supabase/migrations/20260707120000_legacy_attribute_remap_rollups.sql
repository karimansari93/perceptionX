-- =============================================================================
-- Read-time v1 -> v2 attribute remap in the attribute-theme rollups
-- =============================================================================
--
-- Methodology v2 (20260705140000) consolidated 16 v1 attributes into 13 v2
-- ones but only WIDENED the rollup filters to the v1 UNION v2 id set: v1
-- history and v2 data aggregate as SEPARATE attributes, so a client cut over
-- to v2 prompts would see its trend lines break at the cutover month (e.g.
-- "Rewards & Recognition" history ends, "Compensation" starts from zero).
--
-- Since 2026-07-05 the deployed theme classifier (ai-thematic-analysis /
-- _shared/theme-analysis.ts) only ever writes v2 ids -- it folds stray legacy
-- ids through the same map below. Raw ai_themes rows keep whatever id they
-- were collected under (they are the honest record of what was asked); the
-- fold happens here, at aggregation time, so it stays reversible.
--
-- This migration applies LEGACY_ATTRIBUTE_MAP (src/config/attributes.ts) at
-- aggregation time in the two attribute rollups:
--   * company_attribute_themes_mv            (table; rebuilt by
--     _refresh_cm_attribute_themes from 20260706120000)
--   * company_attribute_themes_by_location_mv (matview)
--
-- Mapping (merges sum counts; avg_sentiment_score stays a true average since
-- grouping happens over raw ai_themes rows):
--   mission-purpose, social-impact            -> mission-purpose-impact
--   rewards-recognition                       -> compensation
--   security-perks                            -> job-security
--   application-process, candidate-communication -> application-communication
--   overall-candidate-experience              -> kept as-is (retired, no
--     successor; remains visible as history, absent from the v2 registry's
--     current-state scoring)
--
-- NOTE for readers of trend lines: v2 re-voiced the prompts (candidate
-- language), so pre/post-cutover sentiment under one v2 id is a methodology
-- bridge, not a like-for-like series. confirmed_prompts.prompt_version
-- remains the ground truth for which methodology produced the underlying
-- responses.
-- =============================================================================

BEGIN;

-- 1. Table rollup: remap inside the incremental refresh helper --------------
CREATE OR REPLACE FUNCTION public._refresh_cm_attribute_themes(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.company_attribute_themes_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_attribute_themes_mv
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
           4;
END $$;

-- Rebuild the table contents under the new mapping (all companies; same cost
-- class as one staleness-tick full rebuild, ~20-40s).
SELECT public._refresh_cm_attribute_themes(NULL);

-- 2. By-location matview: recreate with the same remap -----------------------
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
    avg(t.sentiment_score) AS avg_sentiment_score,
    count(DISTINCT t.response_id) AS response_count,
    now() AS calculated_at
   FROM ai_themes t
     JOIN prompt_responses pr ON pr.id = t.response_id
     JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
  WHERE pr.tested_at IS NOT NULL AND (btrim(t.attribute_id) = ANY (ARRAY[
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

-- DROP discards the matview's ACLs; re-grant (matches 20260705140000).
GRANT SELECT ON public.company_attribute_themes_by_location_mv TO anon, authenticated, service_role;

COMMIT;
