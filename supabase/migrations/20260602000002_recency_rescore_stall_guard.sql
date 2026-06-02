-- Add a stall counter to recency_rescore_jobs so the tick worker can terminate
-- jobs that stop making progress, instead of re-pulling the same URLs forever.
--
-- Background: process-recency-rescore-tick pulls URLs with extraction_method IS
-- NULL, sends them to extract-recency-scores, and only stops once that set hits
-- zero. URLs that can't be resolved (Firecrawl rate-limit, fetch timeout) are
-- deliberately left uncached so they can be retried later -- but that meant a
-- residual set of unresolvable URLs got re-pulled every minute indefinitely,
-- each pull running an expensive hash-join over url_recency_cache. One such job
-- ran ~11.5h and became the dominant Disk IO consumer.
--
-- stall_ticks counts consecutive ticks that cached zero new rows; the worker
-- finalizes the job once it crosses a threshold (see process-recency-rescore-tick).
ALTER TABLE public.recency_rescore_jobs
  ADD COLUMN IF NOT EXISTS stall_ticks integer NOT NULL DEFAULT 0;
