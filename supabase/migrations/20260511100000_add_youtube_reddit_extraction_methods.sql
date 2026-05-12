-- ============================================================================
-- Add 'youtube-api' and 'reddit-api' extraction methods
-- ============================================================================
-- Free, official APIs for YouTube (Data API v3) and Reddit (.json endpoint)
-- replace Firecrawl for these domains. See extract-recency-scores edge fn.

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
    'meta-tag',
    'json-ld',
    'time-tag',
    'openai-html',
    'not-found',
    'rate-limit-hit',
    'timeout',
    'problematic-domain',
    'cache-hit',
    'manual',
    'evergreen',
    'youtube-api',
    'reddit-api'
  )) NOT VALID;

-- Rebuild organization_recency_coverage_mv to count the new methods.
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
  COUNT(*) FILTER (WHERE j.extraction_method = 'youtube-api')         AS method_youtube_api,
  COUNT(*) FILTER (WHERE j.extraction_method = 'reddit-api')          AS method_reddit_api,
  NOW() AS refreshed_at
FROM organizations o
LEFT JOIN joined j ON j.organization_id = o.id
GROUP BY o.id, o.name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_recency_coverage_org
  ON organization_recency_coverage_mv(organization_id);

GRANT SELECT ON organization_recency_coverage_mv TO authenticated;

NOTIFY pgrst, 'reload schema';
