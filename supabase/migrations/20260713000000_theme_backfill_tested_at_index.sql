-- Fix theme-backfill-tick 500s: find_responses_missing_themes() had no
-- usable index for its scan.
--
-- The RPC filters prompt_responses on tested_at >= now() - 90 days with no
-- company filter, and the only tested_at indexes were partial on
-- (company_id, tested_at). The planner fell back to a parallel seq scan of
-- the whole table (~800 MB incl. TOAST) plus an on-disk sort — ~14s as of
-- 2026-07-13, past the 8s statement_timeout on the authenticator role that
-- PostgREST connects through. Every RPC call was cancelled, so every cron
-- tick returned 500 and the backfill stopped draining.
--
-- With this index the planner walks tested_at DESC and anti-joins against
-- idx_ai_themes_response_id row by row, stopping at LIMIT: ~0.5s cold.
--
-- Applied to production with CREATE INDEX CONCURRENTLY on 2026-07-13; the
-- IF NOT EXISTS makes this file a no-op there and a plain create elsewhere.
CREATE INDEX IF NOT EXISTS idx_prompt_responses_tested_at_missing_themes
ON public.prompt_responses (tested_at DESC)
WHERE response_text IS NOT NULL AND COALESCE(for_index, false) = false;
