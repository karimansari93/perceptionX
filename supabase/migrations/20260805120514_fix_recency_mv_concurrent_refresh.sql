-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260805120514; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- ============================================================================
-- Fix: recency source MVs could never refresh concurrently
-- ============================================================================
-- REFRESH MATERIALIZED VIEW CONCURRENTLY requires a unique index built on
-- plain columns — expression indexes don't qualify. Both URL source MVs only
-- had unique indexes on md5(url), so every refresh attempt failed with
-- "cannot refresh materialized view concurrently". The admin Refresh button
-- swallowed that error, leaving the URL lists (and any org created after the
-- last manual refresh) frozen at their creation-time snapshot.
--
-- Fix: store md5(url) as a real column (url_md5) in both MVs and rebuild the
-- unique indexes on it. Dependent objects (coverage MV + status views) are
-- dropped by CASCADE and recreated with their current definitions unchanged.

-- ----------------------------------------------------------------------------
-- 1. Rebuild organization_source_urls_mv with a stored url_md5 column.
--    CASCADE drops organization_recency_coverage_mv and
--    v_organization_url_status; both are recreated below.
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
  url,
  md5(url) AS url_md5
FROM citation_rows
WHERE url IS NOT NULL
  AND url LIKE 'http%';

-- URLs can exceed btree's 2704-byte key limit, so uniqueness goes through the
-- md5 hash — stored as a column (not an expression) so CONCURRENTLY works.
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_source_urls_org_url
  ON organization_source_urls_mv(organization_id, url_md5);

CREATE INDEX IF NOT EXISTS idx_org_source_urls_url_hash
  ON organization_source_urls_mv(url_md5);

GRANT SELECT ON organization_source_urls_mv TO authenticated;

COMMENT ON MATERIALIZED VIEW organization_source_urls_mv IS
  'Distinct citation URLs per organization (flattened from prompt_responses.citations across all member companies).';

-- ----------------------------------------------------------------------------
-- 2. Rebuild organization_company_source_urls_mv the same way.
--    CASCADE drops v_company_url_status; recreated below.
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS organization_company_source_urls_mv CASCADE;

CREATE MATERIALIZED VIEW organization_company_source_urls_mv AS
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
  company_id,
  url,
  md5(url) AS url_md5
FROM citation_rows
WHERE url IS NOT NULL
  AND url LIKE 'http%';

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_company_source_urls_unique
  ON organization_company_source_urls_mv(organization_id, company_id, url_md5);

CREATE INDEX IF NOT EXISTS idx_org_company_source_urls_company
  ON organization_company_source_urls_mv(company_id, url_md5);

GRANT SELECT ON organization_company_source_urls_mv TO authenticated;

COMMENT ON MATERIALIZED VIEW organization_company_source_urls_mv IS
  'Distinct citation URLs per (organization, company) — company-grained sibling of organization_source_urls_mv.';

-- ----------------------------------------------------------------------------
-- 3. Recreate organization_recency_coverage_mv (definition unchanged from
--    20260511100000_add_youtube_reddit_extraction_methods.sql).
-- ----------------------------------------------------------------------------
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
  COUNT(*) FILTER (WHERE j.extraction_method = 'youtube-api')         AS method_youtube_api,
  COUNT(*) FILTER (WHERE j.extraction_method = 'reddit-api')          AS method_reddit_api,
  NOW() AS refreshed_at
FROM organizations o
LEFT JOIN joined j ON j.organization_id = o.id
GROUP BY o.id, o.name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_recency_coverage_org
  ON organization_recency_coverage_mv(organization_id);

GRANT SELECT ON organization_recency_coverage_mv TO authenticated;

COMMENT ON MATERIALIZED VIEW organization_recency_coverage_mv IS
  'Per-organization rollup of recency scoring coverage and extraction_method breakdown.';

-- ----------------------------------------------------------------------------
-- 4. Recreate the status views (definitions unchanged).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_organization_url_status AS
SELECT
  osu.organization_id,
  osu.url,
  urc.recency_score,
  urc.extraction_method,
  urc.publication_date,
  urc.last_checked_at
FROM organization_source_urls_mv osu
LEFT JOIN url_recency_cache urc ON urc.url = osu.url;

GRANT SELECT ON v_organization_url_status TO authenticated;

CREATE OR REPLACE VIEW v_company_url_status AS
SELECT
  csu.organization_id,
  csu.company_id,
  csu.url,
  urc.recency_score,
  urc.extraction_method,
  urc.publication_date,
  urc.last_checked_at
FROM organization_company_source_urls_mv csu
LEFT JOIN url_recency_cache urc ON urc.url = csu.url;

GRANT SELECT ON v_company_url_status TO authenticated;

NOTIFY pgrst, 'reload schema';
