-- ============================================================================
-- Nuke all cache rows produced by the deprecated regex-based extraction
-- ============================================================================
-- The old extraction logic produced wrong dates from regex matching markdown:
--   - firecrawl-relative: matched "X years ago" / "today" / "yesterday" anywhere
--     in page text, often pulling timestamps from comments, nav, or body text.
--   - firecrawl-absolute: matched any 4-digit number that looked like a year
--     (including "6387-02-01" from random numeric sequences).
--
-- The new edge function uses Firecrawl JSON mode (LLM-extracted) instead.
-- These methods are no longer emitted, so any row with these methods is
-- legacy junk. Delete them; they'll be re-scored next pass.

DELETE FROM url_recency_cache
WHERE extraction_method IN ('firecrawl-relative', 'firecrawl-absolute', 'firecrawl-reddit');

-- Also nuke any row with a publication_date outside the sensible range
-- (covers the 6387-02-01 case if it crept in via another path).
DELETE FROM url_recency_cache
WHERE publication_date IS NOT NULL
  AND (publication_date < DATE '1995-01-01' OR publication_date > DATE '2050-01-01');

-- And rows where score=100 with publication_date=today and method isn't
-- explicitly evergreen or manual (those are intentional 100s).
DELETE FROM url_recency_cache
WHERE recency_score = 100
  AND publication_date = CURRENT_DATE
  AND extraction_method NOT IN ('evergreen', 'manual');

-- Refresh the coverage MV so the admin UI reflects the cleanup
REFRESH MATERIALIZED VIEW organization_recency_coverage_mv;
