-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260714153606; this file was
-- back-filled afterwards and therefore post-dates the deployment.


UPDATE url_recency_cache
SET extraction_method = 'evergreen',
    recency_score = 100,
    last_checked_at = NOW()
WHERE recency_score IS NULL
  AND extraction_method IN ('not-found', 'problematic-domain')
  AND (
    domain ~* '(^|\.)greatplacetowork\.[a-z]{2,3}(\.[a-z]{2})?$'
    OR domain ~* '(^|\.)(gptw\.com\.br|kununu\.com|comparably\.com|ambitionbox\.com|openwork\.jp)$'
    OR domain ~* '(^|\.)(zoominfo\.com|f6s\.com|ensun\.io|bullfincher\.io|jobsbyculture\.com|startup\.jobs)$'
    OR domain ~* '(^|\.)sortlist\.[a-z]{2,3}(\.[a-z]{2})?$'
    OR domain ~* '(^|\.)(jobkorea\.co\.kr|levels\.fyi)$'
    OR (domain ~* '(^|\.)jobplanet\.co\.kr$' AND url ~* '/companies/')
    OR domain ~* '(^|\.)(designgurus\.io|cliffsnotes\.com|scribd\.com)$'
    OR (domain ~* '(^|\.)google\.com$' AND url ~* '/searchviewer/')
    OR (domain ~* '(^|\.)chambers\.com$' AND url ~* '/legal-rankings/')
    OR url ~* '/(certified-company|certified-companies|empresas-certificadas|beste-arbeitgeber|top-lists|toplijst|bestplaceswork)(/|$|\?)'
  );

