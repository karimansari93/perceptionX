-- Fix: the theme-analysis worker's poll, find_responses_missing_themes(),
-- saturated disk IO whenever its backlog was EMPTY (verified 2026-08-17):
-- the LIMIT never short-circuited, so each of its ~315 calls/day walked the
-- partial index across ~90 days of prompt_responses (215k rows) and
-- anti-join-probed ai_themes (535k rows) per row, reading GBs to return 0
-- candidates (mean 34s, 72.9 GB cumulative reads in pg_stat_statements).
-- Those reads exhausted the disk budget and everything else — the dashboard
-- RPCs under the authenticated role's 8s statement_timeout — timed out in
-- waves ("canceling statement due to statement timeout" storms).
--
-- The fix is a "processed" marker: prompt_responses.themes_found_at is
-- stamped as soon as a response has ai_themes rows, and both the candidate
-- predicate and its partial indexes exclude processed rows structurally.
-- An empty poll now touches a ~100 kB index and returns in ~20ms (was
-- ~3.9s warm / ~34s cold). The NOT EXISTS anti-join stays as belt-and-braces
-- against a missed stamp; with the marker predicate in front it is only
-- evaluated for genuinely-unprocessed rows, so it costs almost nothing.
--
-- Applied to production via MCP on 2026-08-17 (this file is the repo-parity
-- record; every statement is idempotent, so re-running it is safe).

-- 1) Processed marker --------------------------------------------------------

ALTER TABLE public.prompt_responses
  ADD COLUMN IF NOT EXISTS themes_found_at timestamptz;

-- 2) Stamp on theme insert ---------------------------------------------------
-- Statement-level trigger with a transition table: one UPDATE per insert
-- statement, not per row, and zero-row inserts stamp nothing.

CREATE OR REPLACE FUNCTION public.stamp_themes_found()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
begin
  update public.prompt_responses p
     set themes_found_at = now()
   where p.themes_found_at is null
     and p.id in (select distinct response_id from new_rows where response_id is not null);
  return null;
end $function$;

DROP TRIGGER IF EXISTS ai_themes_stamp_found ON public.ai_themes;
CREATE TRIGGER ai_themes_stamp_found
  AFTER INSERT ON public.ai_themes
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.stamp_themes_found();

-- 3) Backfill existing themed responses --------------------------------------
-- On production this ran as 8k-row keyset batches over the PK via MCP
-- (134,245 rows stamped; house 2-minute-statement protocol). The single
-- statement below is the parity/fresh-database form; on a database that is
-- already backfilled it updates 0 rows.

UPDATE public.prompt_responses p
   SET themes_found_at = now()
 WHERE p.themes_found_at IS NULL
   AND EXISTS (SELECT 1 FROM public.ai_themes t WHERE t.response_id = p.id);

-- 4) Candidate function excludes processed rows ------------------------------

CREATE OR REPLACE FUNCTION public.find_responses_missing_themes(p_limit integer DEFAULT 100, p_days integer DEFAULT 90)
 RETURNS TABLE(id uuid, company_id uuid, response_text text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
    WITH candidates AS (
        SELECT p.id, p.company_id, p.tested_at
        FROM public.prompt_responses p
        WHERE p.tested_at >= now() - (p_days || ' days')::interval
          AND p.response_text IS NOT NULL
          AND length(p.response_text) > 100
          AND COALESCE(p.for_index, false) = false
          AND COALESCE(p.company_mentioned, false) = true
          AND p.themes_none_found_at IS NULL
          AND p.themes_found_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.ai_themes t WHERE t.response_id = p.id
          )
        ORDER BY p.tested_at DESC
        LIMIT p_limit
    )
    SELECT c.id, c.company_id, pr.response_text
    FROM candidates c
    JOIN public.prompt_responses pr ON pr.id = c.id
    ORDER BY c.tested_at DESC;
$function$;

-- 5) Shrink the candidate partial indexes to unprocessed rows ----------------
-- Same shapes as before plus AND themes_found_at IS NULL, created as _v2 and
-- swapped. Plain (non-concurrent) builds are seconds on this table but take a
-- SHARE lock: on production this ran while collection_active() was false
-- (collection is quarterly).

CREATE INDEX IF NOT EXISTS idx_prompt_responses_tested_at_missing_themes_v2
ON public.prompt_responses USING btree (tested_at DESC) INCLUDE (id, company_id)
WHERE response_text IS NOT NULL
  AND length(response_text) > 100
  AND COALESCE(for_index, false) = false
  AND COALESCE(company_mentioned, false) = true
  AND themes_none_found_at IS NULL
  AND themes_found_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pr_cycle_theme_candidates_v2
ON public.prompt_responses USING btree (collection_cycle) INCLUDE (id, company_id)
WHERE response_text IS NOT NULL
  AND length(response_text) > 100
  AND COALESCE(for_index, false) = false
  AND COALESCE(company_mentioned, false) = true
  AND themes_none_found_at IS NULL
  AND themes_found_at IS NULL;

DROP INDEX IF EXISTS public.idx_prompt_responses_tested_at_missing_themes;
DROP INDEX IF EXISTS public.idx_pr_cycle_theme_candidates;
