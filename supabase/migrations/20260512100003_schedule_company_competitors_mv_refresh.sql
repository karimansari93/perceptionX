-- =============================================================================
-- Schedule a nightly refresh of company_competitors_mv so the dashboard
-- competitor lists pick up:
--   * any aliases approved through the admin UI during the day
--   * any new prompt_responses that landed since the last refresh
--
-- Runs 30 minutes after the suggestion job (03:30 UTC) so the LLM suggestions
-- have settled before the refresh. The MV refresh itself is fast (seconds)
-- because the unique index on (company_id, competitor_name) enables
-- REFRESH MATERIALIZED VIEW CONCURRENTLY.
-- =============================================================================

DO $$
BEGIN
    PERFORM cron.unschedule('refresh-company-competitors-mv');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
    'refresh-company-competitors-mv',
    '30 3 * * *',  -- 03:30 UTC every day
    $cron$ SELECT public.refresh_company_competitors_mv(); $cron$
);
