-- Scheduled maintenance off; everything runs by hand after a collection
-- (Karim, 2026-10-21: "both client reports and the index run quarterly, so we
-- can trigger these after new collection only or if we need to recollect.
-- none of it needs to be automatic").
--
-- Why: on 2026-10-21 the database exhausted its Disk IO budget after the
-- 8-country Index collection and crashed and restarted repeatedly from 03:45
-- to 05:53 UTC. The trigger was entity-canonicalization-tick re-reading every
-- answer in the database 30 minutes after the collection ended, retrying
-- every 5 minutes after each crash; the nightly Index jobs at 03:50 and 04:00
-- hit the stalled database too.
--
-- Paused, not removed: cron.alter_job(<id>, active := true) brings one back.
-- The steps to run by hand are in docs/RUNBOOK_AFTER_COLLECTION.md.
--
-- Still scheduled: the jobs that carry out a run someone started (collection
-- queues, Claude batches, theme batches, theme-gap and recency rescoring).
-- Each checks for queued work first and does nothing when there is none.

SELECT cron.alter_job(jobid, active := false)
FROM cron.job
WHERE jobname IN (
  'entity-canonicalization-tick',   -- client name-matching (full scan)
  'index-obvious-variant-sync',     -- Index name clean-up, 03:50
  'rankings-maintenance-daily',     -- Index rankings refresh + profiles, 04:00
  'slug-aliases-rebuild-daily',     -- Index profile links, 04:20
  'refresh-metrics-tick',           -- client dashboard scores, every minute
  'recency-coverage-refresh-tick',  -- client recency coverage, hourly
  'classify-company-sizes-daily',   -- company size labels (AI), 03:40
  'refresh-firecrawl-dead-domains'  -- scraper dead-domain list, 04:45
);

-- If the client name-matching job is ever switched back on, it may not run
-- without a time limit again.
SELECT cron.alter_job(jobid, command := $c$ SET statement_timeout = '120s'; SELECT public.entity_canonicalization_tick(); $c$)
FROM cron.job
WHERE jobname = 'entity-canonicalization-tick';
