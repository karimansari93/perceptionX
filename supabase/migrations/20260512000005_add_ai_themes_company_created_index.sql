-- Composite index to serve the Overview "Themes" fetch:
--   WHERE company_id = $1 AND created_at >= $cutoff
--   ORDER BY created_at DESC  (paginated)
--
-- Before this index the query used idx_ai_themes_company_id for the
-- equality, then sorted the entire per-company set (~17k rows for large
-- accounts) by created_at via an EXTERNAL MERGE SORT ON DISK on every
-- page (~1.3s/page, ~20s total across sequential pages). With this
-- composite index the planner does a plain index range scan in the
-- desired order — measured 1276ms -> ~1ms per page on prod.
--
-- NOTE: In production this index was created with CREATE INDEX
-- CONCURRENTLY to avoid locking writes on the 263k-row table. This
-- migration file uses a plain IF NOT EXISTS create so it is
-- transaction-safe for fresh environments (where the table is empty
-- and the build is instant) and a no-op where the index already exists.

CREATE INDEX IF NOT EXISTS idx_ai_themes_company_created
  ON public.ai_themes (company_id, created_at DESC);

COMMENT ON INDEX idx_ai_themes_company_created IS
  'Serves the Overview themes fetch: company_id equality + created_at DESC ordered pagination. Replaces an on-disk sort with an index range scan.';
