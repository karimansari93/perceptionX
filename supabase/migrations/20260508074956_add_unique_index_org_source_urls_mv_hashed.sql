-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260508074956; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Some URLs exceed btree's 2704-byte row limit. Index the (org, hash(url))
-- pair instead — uniqueness is preserved (collision probability for SHA-256
-- across <1B rows is negligible) and the index row stays within limits.
-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY.

CREATE UNIQUE INDEX IF NOT EXISTS organization_source_urls_mv_unique_idx
  ON public.organization_source_urls_mv (organization_id, digest(url, 'sha256'));
