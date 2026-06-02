-- Disable the scheduled materialized-view refresh cron jobs.
--
-- Context: Supabase flagged Disk IO budget exhaustion. These three jobs only
-- *refresh* materialized views (precomputed snapshots) -- they do not ingest or
-- process new data. The underlying perception data is collection-driven, not a
-- daily/hourly feed, so refreshing on a fixed schedule rebuilt identical numbers
-- every run and was the dominant Disk IO consumer.
--
-- The MVs are now refreshed on demand after new data lands, e.g.:
--   SELECT refresh_company_metrics();          -- 5 company MVs
--   SELECT public.refresh_company_competitors_mv();
--   SELECT public.refresh_rankings_pipeline();  -- industry / mentions / overview / search index
--
-- Re-enable any job later with:
--   SELECT cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = '<name>'), active := true);
--
-- Note: ingestion/queue jobs (batch + visibility queue ticks, recency rescore,
-- theme backfill, canonicalization, rankings maintenance, slug aliases) are left
-- running -- only pure MV-refresh jobs are disabled here.
--
-- Idempotent: matches by stable job name, no-ops if a job is absent or already
-- inactive, so it is safe to re-run and safe on fresh environments.

DO $$
DECLARE
  v_jobname text;
BEGIN
  FOREACH v_jobname IN ARRAY ARRAY[
    'refresh-company-metrics-every-hour',  -- refresh_company_metrics()
    'refresh-company-competitors-mv',      -- refresh_company_competitors_mv()
    'rankings-refresh-hourly'              -- refresh_rankings_pipeline()
  ]
  LOOP
    PERFORM cron.alter_job(job_id := jobid, active := false)
    FROM cron.job
    WHERE jobname = v_jobname AND active;
  END LOOP;
END $$;
