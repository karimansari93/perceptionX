-- Restore the competitor and page cube steps in the per-company refresh.
--
-- The career_site migration (applied 2026-09-17, version 20260917160709)
-- redefined refresh_company_metrics(uuid) from a copy that predated
-- 20260825200000 / 20260903180000, so it dropped
-- _refresh_cm_competitor_stats and _refresh_cm_page_stats. Since then no
-- company collected after 2026-09-11 has had company_competitor_stats_mv or
-- company_page_stats_mv rebuilt, and the Overview Competitors card shows
-- "No competitor mentions found yet" for newly onboarded companies.
--
-- This keeps the career_site step and puts the two missing steps back.

CREATE OR REPLACE FUNCTION public.refresh_company_metrics(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
  PERFORM public._refresh_cm_scope_stats(p_company_id);
  PERFORM public._refresh_cm_scope_daily_stats(p_company_id);
  PERFORM public._refresh_cm_scope_prompt_type_stats(p_company_id);
  PERFORM public._refresh_cm_llm_stats(p_company_id);
  PERFORM public._refresh_cm_domain_stats(p_company_id);
  PERFORM public._refresh_cm_competitor_stats(p_company_id);
  PERFORM public._refresh_cm_page_stats(p_company_id);
  PERFORM public._refresh_cm_career_site(p_company_id);
  DELETE FROM public.company_metrics_dirty WHERE company_id = p_company_id;
END $$;

-- Backfill: re-queue every company whose responses arrived after the last
-- competitor cube write (2026-09-11), so the next refresh_metrics_tick
-- rebuilds them with the restored steps.
INSERT INTO public.company_metrics_dirty (company_id)
SELECT DISTINCT pr.company_id
FROM public.prompt_responses pr
WHERE pr.company_id IS NOT NULL
  AND pr.created_at > '2026-09-11'
ON CONFLICT (company_id) DO NOTHING;
