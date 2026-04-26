-- ============================================================================
-- Organization-level Recency Coverage
-- ============================================================================
-- Gives admins a view of how many citation URLs each organization has and
-- how many have been scored in url_recency_cache. Powers the admin Recency
-- Coverage tab and the manual review queue.

-- ----------------------------------------------------------------------------
-- 1. Allow 'manual' as an extraction method (for human-reviewed URLs)
--    and add reviewer audit columns to url_recency_cache.
-- ----------------------------------------------------------------------------
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
    'manual'
  )) NOT VALID;

ALTER TABLE url_recency_cache
  ADD COLUMN IF NOT EXISTS manually_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manually_reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- 2. Materialized View: distinct citation URL per organization.
--    Flattens every prompt_responses.citations JSON array for every company
--    in every organization into one row per (organization_id, url).
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS organization_source_urls_mv CASCADE;

CREATE MATERIALIZED VIEW organization_source_urls_mv AS
WITH citation_rows AS (
  SELECT
    oc.organization_id,
    pr.company_id,
    COALESCE(c->>'url', c->>'link') AS url
  FROM organization_companies oc
  JOIN prompt_responses pr ON pr.company_id = oc.company_id
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(pr.citations) = 'array' THEN pr.citations
      ELSE '[]'::jsonb
    END
  ) AS c
  WHERE pr.citations IS NOT NULL
)
SELECT DISTINCT
  organization_id,
  url
FROM citation_rows
WHERE url IS NOT NULL
  AND url LIKE 'http%';

-- URLs can exceed btree's 2704-byte key limit, so the unique index hashes the URL.
-- md5 collision risk is astronomically low at our scale.
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_source_urls_org_url
  ON organization_source_urls_mv(organization_id, md5(url));

CREATE INDEX IF NOT EXISTS idx_org_source_urls_url_hash
  ON organization_source_urls_mv(md5(url));

-- ----------------------------------------------------------------------------
-- 3. Materialized View: coverage rollup per organization.
--    Counts how many of the org's URLs are cached, scored, or missing, plus
--    a breakdown by extraction_method so Firecrawl ROI is visible.
-- ----------------------------------------------------------------------------
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
  -- extraction_method breakdown
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
  NOW() AS refreshed_at
FROM organizations o
LEFT JOIN joined j ON j.organization_id = o.id
GROUP BY o.id, o.name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_recency_coverage_org
  ON organization_recency_coverage_mv(organization_id);

-- ----------------------------------------------------------------------------
-- 4. Refresh function. Source URL MV must refresh first (coverage depends on it).
--    Uses CONCURRENTLY so reads are never blocked.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_organization_recency_coverage()
RETURNS TABLE (
  view_name TEXT,
  refresh_started TIMESTAMPTZ,
  refresh_completed TIMESTAMPTZ,
  success BOOLEAN,
  error_message TEXT
) AS $$
DECLARE
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_err TEXT;
BEGIN
  v_start := NOW();
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY organization_source_urls_mv;
    v_end := NOW();
    RETURN QUERY SELECT 'organization_source_urls_mv'::TEXT, v_start, v_end, TRUE, NULL::TEXT;
  EXCEPTION WHEN OTHERS THEN
    v_end := NOW();
    v_err := SQLERRM;
    RETURN QUERY SELECT 'organization_source_urls_mv'::TEXT, v_start, v_end, FALSE, v_err;
  END;

  v_start := NOW();
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY organization_recency_coverage_mv;
    v_end := NOW();
    RETURN QUERY SELECT 'organization_recency_coverage_mv'::TEXT, v_start, v_end, TRUE, NULL::TEXT;
  EXCEPTION WHEN OTHERS THEN
    v_end := NOW();
    v_err := SQLERRM;
    RETURN QUERY SELECT 'organization_recency_coverage_mv'::TEXT, v_start, v_end, FALSE, v_err;
  END;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 5. Grants. Admin UI reads from these via authenticated role.
-- ----------------------------------------------------------------------------
GRANT SELECT ON organization_source_urls_mv TO authenticated;
GRANT SELECT ON organization_recency_coverage_mv TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_organization_recency_coverage() TO service_role;
GRANT EXECUTE ON FUNCTION refresh_organization_recency_coverage() TO authenticated;

COMMENT ON MATERIALIZED VIEW organization_source_urls_mv IS
  'Distinct citation URLs per organization (flattened from prompt_responses.citations across all member companies).';
COMMENT ON MATERIALIZED VIEW organization_recency_coverage_mv IS
  'Per-organization rollup of recency scoring coverage and extraction_method breakdown.';
COMMENT ON FUNCTION refresh_organization_recency_coverage() IS
  'Refreshes both org-level recency MVs. Source URLs refresh first.';
