-- ============================================================================
-- Fix: recency-coverage source MVs could never refresh (silently)
-- ============================================================================
-- refresh_organization_recency_coverage() refreshed all three recency MVs with
-- REFRESH MATERIALIZED VIEW CONCURRENTLY. But CONCURRENTLY requires a UNIQUE
-- index built on plain columns only — it rejects expression / partial indexes.
--
-- The two *source* MVs hash the URL in their unique index because URLs can
-- exceed btree's 2704-byte key limit:
--   organization_source_urls_mv          UNIQUE (organization_id, md5(url))
--   organization_company_source_urls_mv  UNIQUE (organization_id, company_id, md5(url))
-- md5(url) is an expression, so CONCURRENTLY refresh of those two has ALWAYS
-- failed with:
--   55000: cannot refresh materialized view ... concurrently
-- and the per-view EXCEPTION blocks in the function swallowed the error. Net
-- effect: both source MVs were frozen at their CREATE-time contents, so any data
-- added to any org afterward (e.g. a company's citations) was invisible to the
-- recency coverage UI and to enqueue_recency_rescore — they showed 0 URLs to
-- score even when thousands were missing. Only the coverage rollup
-- (organization_recency_coverage_mv, UNIQUE on the plain organization_id column)
-- kept refreshing, re-aggregating stale source data with a fresh timestamp.
--
-- Fix: refresh the two source MVs NON-concurrently (plain REFRESH has no
-- expression-index restriction). The rollup stays CONCURRENTLY since its unique
-- index is a plain column and reads of it shouldn't block. The source MVs are
-- read only by the admin Recency Coverage tooling, so the brief ACCESS EXCLUSIVE
-- lock a non-concurrent refresh takes is an acceptable trade for refreshes that
-- actually succeed.
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
    -- NOT concurrently: unique index is on md5(url) (an expression).
    REFRESH MATERIALIZED VIEW organization_source_urls_mv;
    v_end := NOW();
    RETURN QUERY SELECT 'organization_source_urls_mv'::TEXT, v_start, v_end, TRUE, NULL::TEXT;
  EXCEPTION WHEN OTHERS THEN
    v_end := NOW();
    v_err := SQLERRM;
    RETURN QUERY SELECT 'organization_source_urls_mv'::TEXT, v_start, v_end, FALSE, v_err;
  END;

  v_start := NOW();
  BEGIN
    -- NOT concurrently: unique index is on md5(url) (an expression).
    REFRESH MATERIALIZED VIEW organization_company_source_urls_mv;
    v_end := NOW();
    RETURN QUERY SELECT 'organization_company_source_urls_mv'::TEXT, v_start, v_end, TRUE, NULL::TEXT;
  EXCEPTION WHEN OTHERS THEN
    v_end := NOW();
    v_err := SQLERRM;
    RETURN QUERY SELECT 'organization_company_source_urls_mv'::TEXT, v_start, v_end, FALSE, v_err;
  END;

  v_start := NOW();
  BEGIN
    -- Concurrently is fine here: unique index is on the plain organization_id column.
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

NOTIFY pgrst, 'reload schema';
