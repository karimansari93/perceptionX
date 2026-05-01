-- ============================================================================
-- View: per-org URL with cache status
-- ============================================================================
-- Pre-joins organization_source_urls_mv with url_recency_cache so the admin
-- UI can filter by status without round-tripping all URLs to the browser.

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

NOTIFY pgrst, 'reload schema';
