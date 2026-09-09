-- Attribute-theme rollups must bucket by the SNAPSHOT month, not the write month.
--
-- prompt_responses.response_month is COALESCE(collection_cycle, month(created_at)):
-- collection_cycle is the "snapshot month" tag that lets a wave be filed under a
-- period other than the one it was physically collected in (see the
-- responsePeriodKey comment in useDashboardData.ts — "a run collected on May 30
-- but tagged collection_cycle = June must show under June's quarter EVERYWHERE").
--
-- Every scope/sentiment/relevance/domain/competitor rollup already honours that
-- via COALESCE(pr.response_month, ...). The two attribute-theme rollups did not —
-- they still grouped on date_trunc('month', pr.tested_at) — so retagging a wave
-- moved it on every dashboard card EXCEPT the attribute/themes ones, which kept
-- reporting it under the write month. Align both to the shared rule.

-- 1) Per-company rollup (company_attribute_themes_mv, drained by refresh_metrics_tick)
CREATE OR REPLACE FUNCTION public._refresh_cm_attribute_themes(p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_attribute_themes_mv', 0));
  DELETE FROM public.company_attribute_themes_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_attribute_themes_mv
    (company_id, response_month, job_function_context, attribute_id, total_themes, positive_themes,
     negative_themes, neutral_themes, avg_sentiment_score, response_count, calculated_at)
  SELECT t.company_id,
         COALESCE(pr.response_month, date_trunc('month'::text, pr.tested_at)::date) AS response_month,
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
    AND pr.ai_model NOT IN ('claude','gemini','deepseek')
    AND (btrim(t.attribute_id) = ANY (ARRAY['mission-purpose-impact','compensation','company-culture','leadership','job-security','career-opportunities','wellbeing-balance','inclusion','innovation','application-communication','candidate-feedback','interview-experience','onboarding-experience','mission-purpose','rewards-recognition','social-impact','security-perks','application-process','candidate-communication','overall-candidate-experience']))
    AND (p_company_id IS NULL OR t.company_id = p_company_id)
  GROUP BY t.company_id,
           (COALESCE(pr.response_month, date_trunc('month'::text, pr.tested_at)::date)),
           (COALESCE(NULLIF(btrim(cp.job_function_context), ''::text), ''::text)),
           4;
END $function$;

-- 2) By-location materialized view (refreshed by the staleness tick)
DROP MATERIALIZED VIEW IF EXISTS public.company_attribute_themes_by_location_mv;
CREATE MATERIALIZED VIEW public.company_attribute_themes_by_location_mv AS
  SELECT t.company_id,
    COALESCE(NULLIF(btrim(cp.location_context), ''::text), ''::text) AS location_context,
    COALESCE(pr.response_month, date_trunc('month'::text, pr.tested_at)::date) AS response_month,
    COALESCE(NULLIF(btrim(cp.job_function_context), ''::text), ''::text) AS job_function_context,
    CASE btrim(t.attribute_id)
      WHEN 'mission-purpose'::text         THEN 'mission-purpose-impact'::text
      WHEN 'social-impact'::text           THEN 'mission-purpose-impact'::text
      WHEN 'rewards-recognition'::text     THEN 'compensation'::text
      WHEN 'security-perks'::text          THEN 'job-security'::text
      WHEN 'application-process'::text     THEN 'application-communication'::text
      WHEN 'candidate-communication'::text THEN 'application-communication'::text
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
  WHERE pr.tested_at IS NOT NULL
    AND (pr.ai_model <> ALL (ARRAY['claude'::text, 'gemini'::text, 'deepseek'::text]))
    AND (btrim(t.attribute_id) = ANY (ARRAY[
      'mission-purpose-impact'::text, 'compensation'::text, 'company-culture'::text, 'leadership'::text,
      'job-security'::text, 'career-opportunities'::text, 'wellbeing-balance'::text, 'inclusion'::text,
      'innovation'::text, 'application-communication'::text, 'candidate-feedback'::text,
      'interview-experience'::text, 'onboarding-experience'::text,
      -- v1 legacy (folded into v2 ids by the CASE above; overall-candidate-experience stays)
      'mission-purpose'::text, 'rewards-recognition'::text, 'social-impact'::text,
      'security-perks'::text, 'application-process'::text, 'candidate-communication'::text,
      'overall-candidate-experience'::text]))
  GROUP BY t.company_id, (COALESCE(NULLIF(btrim(cp.location_context), ''::text), ''::text)),
    (COALESCE(pr.response_month, date_trunc('month'::text, pr.tested_at)::date)),
    (COALESCE(NULLIF(btrim(cp.job_function_context), ''::text), ''::text)), 5;

CREATE UNIQUE INDEX company_attribute_themes_by_location_mv_uniq
  ON public.company_attribute_themes_by_location_mv (company_id, location_context, response_month, job_function_context, attribute_id);
CREATE INDEX company_attribute_themes_by_location_mv_lookup
  ON public.company_attribute_themes_by_location_mv (company_id, location_context);
GRANT SELECT ON public.company_attribute_themes_by_location_mv TO anon, authenticated, service_role;

-- 3) Rebuild the per-company rows for everyone under the corrected rule. The
-- tick drains this queue at its normal pace; only companies whose
-- collection_cycle differs from their write month actually change.
SELECT public.queue_all_companies_metrics_dirty();
