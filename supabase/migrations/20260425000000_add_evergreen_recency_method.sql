-- ============================================================================
-- Add 'evergreen' extraction method
-- ============================================================================
-- Evergreen URLs (homepages, /about, /careers, job listings, ATS portals,
-- pricing pages) have no meaningful publication date. They get score = 100
-- and are skipped by Firecrawl entirely.

-- 1. Update CHECK constraint to include 'evergreen'
ALTER TABLE url_recency_cache
  DROP CONSTRAINT IF EXISTS valid_extraction_method;

ALTER TABLE url_recency_cache
  ADD CONSTRAINT valid_extraction_method CHECK (extraction_method IN (
    'url-pattern',
    'firecrawl-json',
    'firecrawl-html',
    'firecrawl-metadata',
    'firecrawl-relative',
    'firecrawl-absolute',
    'firecrawl-reddit',
    'not-found',
    'rate-limit-hit',
    'timeout',
    'problematic-domain',
    'cache-hit',
    'manual',
    'evergreen'
  )) NOT VALID;

-- 2. Backfill: reclassify existing cache rows whose URL matches evergreen
--    patterns AND currently have no score. Saves Firecrawl spend on retry.
--    Pattern logic mirrors isEvergreenUrl() in the edge function.
WITH parsed AS (
  SELECT
    url,
    LOWER(REGEXP_REPLACE(SPLIT_PART(SPLIT_PART(url, '/', 3), ':', 1), '^www\.', '')) AS host,
    -- path = everything after the first 3 slashes, lowercased, trailing slash stripped
    LOWER(REGEXP_REPLACE(
      COALESCE(NULLIF(REGEXP_REPLACE(url, '^https?://[^/]+', ''), ''), '/'),
      '/+$', ''
    )) AS path
  FROM url_recency_cache
  WHERE recency_score IS NULL
)
UPDATE url_recency_cache urc
SET
  recency_score = 100,
  extraction_method = 'evergreen',
  publication_date = NULL
FROM parsed p
WHERE urc.url = p.url
  AND urc.recency_score IS NULL
  AND (
    -- Bare homepage
    p.path = '' OR p.path = '/'
    -- ATS / job-board hostnames
    OR p.host IN (
      'boards.greenhouse.io',
      'job-boards.greenhouse.io',
      'jobs.lever.co',
      'jobs.ashbyhq.com',
      'apply.workable.com',
      'recruiterbox.com',
      'breezy.hr',
      'smartrecruiters.com',
      'myworkdayjobs.com'
    )
    OR p.host LIKE '%.myworkdayjobs.com'
    OR p.host LIKE '%.greenhouse.io'
    OR p.host LIKE '%.lever.co'
    OR p.host LIKE '%.ashbyhq.com'
    -- LinkedIn jobs and company pages
    OR (p.host LIKE '%linkedin.com' AND (p.path ~ '^/jobs(/|$)' OR p.path ~ '^/company/[^/]+/?$'))
    -- Indeed jobs
    OR (p.host LIKE '%indeed.com' AND p.path ~ '^/(viewjob|jobs|cmp)(/|$|\?)')
    -- Glassdoor company / jobs pages
    OR (p.host LIKE '%glassdoor.com' AND p.path ~ '^/(overview|jobs|reviews|salary|salaries|benefits|interview|interviews)(/|$)')
    -- First-segment patterns
    OR p.path ~ '^/(about|about-us|aboutus|company|our-company|who-we-are|team|teams|leadership|people|mission|values|our-story|story|culture|careers|career|jobs|job|positions|openings|vacancies|opportunities|work-with-us|join-us|join|pricing|plans|products|product|features|solutions|contact|contact-us|support|help|investors|press|media|newsroom)(/|$)'
    -- Any segment named jobs/careers/positions/openings (catches /en/careers/...)
    OR p.path ~ '/(jobs|careers|career|job|positions|openings)(/|$)'
  );

-- 3. Rebuild organization_recency_coverage_mv to include method_evergreen.
--    Drop & recreate (CASCADE drops nothing else since no view depends on it).
DROP MATERIALIZED VIEW IF EXISTS organization_recency_coverage_mv CASCADE;

CREATE MATERIALIZED VIEW organization_recency_coverage_mv AS
WITH joined AS (
  SELECT
    osu.organization_id,
    osu.url,
    urc.recency_score,
    urc.extraction_method,
    urc.publication_date
  FROM organization_source_urls_mv osu
  LEFT JOIN url_recency_cache urc ON urc.url = osu.url
)
SELECT
  o.id AS organization_id,
  o.name AS organization_name,
  COUNT(j.url) AS total_urls,
  COUNT(j.extraction_method) AS cached_count,
  COUNT(j.recency_score) AS with_score_count,
  COUNT(j.url) FILTER (WHERE j.extraction_method IS NULL) AS missing_from_cache_count,
  COUNT(j.url) FILTER (WHERE j.extraction_method IS NOT NULL AND j.recency_score IS NULL) AS null_scored_count,
  COUNT(*) FILTER (WHERE j.extraction_method = 'url-pattern')         AS method_url_pattern,
  COUNT(*) FILTER (WHERE j.extraction_method = 'firecrawl-metadata')  AS method_firecrawl_metadata,
  COUNT(*) FILTER (WHERE j.extraction_method = 'firecrawl-relative')  AS method_firecrawl_relative,
  COUNT(*) FILTER (WHERE j.extraction_method = 'firecrawl-absolute')  AS method_firecrawl_absolute,
  COUNT(*) FILTER (WHERE j.extraction_method = 'firecrawl-reddit')    AS method_firecrawl_reddit,
  COUNT(*) FILTER (WHERE j.extraction_method = 'firecrawl-json')      AS method_firecrawl_json,
  COUNT(*) FILTER (WHERE j.extraction_method = 'firecrawl-html')      AS method_firecrawl_html,
  COUNT(*) FILTER (WHERE j.extraction_method = 'not-found')           AS method_not_found,
  COUNT(*) FILTER (WHERE j.extraction_method = 'timeout')             AS method_timeout,
  COUNT(*) FILTER (WHERE j.extraction_method = 'rate-limit-hit')      AS method_rate_limit_hit,
  COUNT(*) FILTER (WHERE j.extraction_method = 'problematic-domain')  AS method_problematic_domain,
  COUNT(*) FILTER (WHERE j.extraction_method = 'manual')              AS method_manual,
  COUNT(*) FILTER (WHERE j.extraction_method = 'evergreen')           AS method_evergreen,
  NOW() AS refreshed_at
FROM organizations o
LEFT JOIN joined j ON j.organization_id = o.id
GROUP BY o.id, o.name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_recency_coverage_org
  ON organization_recency_coverage_mv(organization_id);

GRANT SELECT ON organization_recency_coverage_mv TO authenticated;

NOTIFY pgrst, 'reload schema';
