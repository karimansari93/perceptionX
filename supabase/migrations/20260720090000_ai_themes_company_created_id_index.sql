-- Composite keyset index for the raw ai_themes pagination (Thematic tab).
--
-- The dashboard pages ai_themes per company on (created_at DESC, id DESC).
-- With the old 2-column index (company_id, created_at DESC) the id tiebreak
-- forced an incremental sort, and a keyset cursor could only bound the scan
-- on created_at. The 3-column index makes the row-value cursor
-- (created_at, id) < (X, Y) used by ai_themes_keyset_page an exact btree
-- boundary and the ORDER BY a pure index walk — every page is O(page size)
-- no matter how deep the pagination is.
--
-- NOTE: in production this index was created with CREATE INDEX CONCURRENTLY
-- (and the superseded index dropped with DROP INDEX CONCURRENTLY) to avoid
-- locking writes on the ~477k-row table; both statements here are the
-- transaction-safe equivalents for fresh environments and are idempotent
-- no-ops in production.
CREATE INDEX IF NOT EXISTS idx_ai_themes_company_created_id
ON public.ai_themes (company_id, created_at DESC, id DESC);

COMMENT ON INDEX public.idx_ai_themes_company_created_id IS
  'Serves the per-company keyset pagination of raw themes (ai_themes_keyset_page RPC): equality on company_id, row-value cursor + ORDER BY on (created_at DESC, id DESC).';

-- Strict prefix of the new index — every query it served is served
-- identically by idx_ai_themes_company_created_id.
DROP INDEX IF EXISTS public.idx_ai_themes_company_created;
