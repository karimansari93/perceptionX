-- ============================================================================
-- Invalidate cache rows with publication_date = today (almost always bugs)
-- ============================================================================
-- The old extraction logic had a /today/i regex that matched the word "today"
-- anywhere on a scraped page and returned today's date as the publish date.
-- This produced thousands of rows with score=100 and publication_date=today
-- that are almost certainly wrong. Reset them so they can be re-scored with
-- the new LLM-based extraction.
--
-- Strategy: DELETE the rows entirely. They'll show up as "Missing cache" in
-- the admin drill-down and the next Rescore pass will re-process them.
-- For URLs that are genuinely evergreen, the new isEvergreenUrl() patterns
-- will catch them for free; for real articles, JSON-mode extraction will
-- pull the actual publish date.

DELETE FROM url_recency_cache
WHERE publication_date = CURRENT_DATE
  AND extraction_method NOT IN ('manual', 'evergreen');

-- Also invalidate the bug variant: extraction_method like firecrawl-relative
-- with publication_date = today (definitely the "today"/"yesterday" regex hit)
DELETE FROM url_recency_cache
WHERE extraction_method = 'firecrawl-relative'
  AND publication_date >= CURRENT_DATE - INTERVAL '1 day';

-- Refresh the coverage MV so the admin UI reflects the cleanup
REFRESH MATERIALIZED VIEW organization_recency_coverage_mv;
