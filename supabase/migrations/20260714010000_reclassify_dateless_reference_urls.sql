-- ============================================================================
-- Reclassify dateless reference URLs as evergreen
-- ============================================================================
-- The null-scored manual-review queue is dominated by pages that will never
-- have a publication date: company profiles, employer-review sites, rankings,
-- directories, certification pages. Automation correctly found no date, but
-- 'not-found' + NULL score parks them in the human queue forever and drags
-- recency coverage down.
--
-- These are reference pages that are "always current", which is exactly what
-- the existing 'evergreen' method models (score 100 — same treatment as
-- homepages, /careers, /about, ATS job boards). This migration reclassifies
-- the cached rows; extract-recency-scores gets the same rules in code so
-- future URLs short-circuit before any Firecrawl spend.
--
-- Domain list was validated against the actual null-scored URLs (all samples
-- were profile/ranking/directory pages, none articles). Conservative on
-- purpose: news/article sites are untouched, jobplanet is path-scoped because
-- it also publishes dated news content.

UPDATE url_recency_cache
SET extraction_method = 'evergreen',
    recency_score = 100,
    last_checked_at = NOW()
WHERE recency_score IS NULL
  AND extraction_method IN ('not-found', 'problematic-domain')
  AND (
    -- Employer-review / best-workplace certification networks (all country TLDs)
    domain ~* '(^|\.)greatplacetowork\.[a-z]{2,3}(\.[a-z]{2})?$'
    OR domain ~* '(^|\.)(gptw\.com\.br|kununu\.com|comparably\.com|ambitionbox\.com|openwork\.jp)$'
    -- Company-data / directory / agency-listing sites
    OR domain ~* '(^|\.)(zoominfo\.com|f6s\.com|ensun\.io|bullfincher\.io|jobsbyculture\.com|startup\.jobs)$'
    OR domain ~* '(^|\.)sortlist\.[a-z]{2,3}(\.[a-z]{2})?$'
    -- Job boards / salary reference
    OR domain ~* '(^|\.)(jobkorea\.co\.kr|levels\.fyi)$'
    OR (domain ~* '(^|\.)jobplanet\.co\.kr$' AND url ~* '/companies/')
    -- Study/interview-prep reference libraries
    OR domain ~* '(^|\.)(designgurus\.io|cliffsnotes\.com|scribd\.com)$'
    -- Google search-viewer permalinks (no content date)
    OR (domain ~* '(^|\.)google\.com$' AND url ~* '/searchviewer/')
    -- Legal-directory rankings
    OR (domain ~* '(^|\.)chambers\.com$' AND url ~* '/legal-rankings/')
    -- Certification / best-workplace list pages on any host
    OR url ~* '/(certified-company|certified-companies|empresas-certificadas|beste-arbeitgeber|top-lists|toplijst|bestplaceswork)(/|$|\?)'
  );
