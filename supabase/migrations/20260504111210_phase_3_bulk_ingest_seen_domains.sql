-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260504111210; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Phase 3: Bulk-ingest every distinct domain seen in url_recency_cache
-- Normalize: strip leading www., lowercase
-- Status: NOT yet classified (family_id NULL, classification_method NULL)
-- These rows are the work queue for the resolver + LLM classification jobs.

WITH normalized AS (
  SELECT
    lower(regexp_replace(domain, '^www\.', '')) AS norm_domain,
    COUNT(*) AS occurrences
  FROM url_recency_cache
  WHERE domain IS NOT NULL AND domain <> ''
  GROUP BY lower(regexp_replace(domain, '^www\.', ''))
)
INSERT INTO source_domains (
  domain,
  family_id,
  classification_method,
  classification_confidence,
  occurrence_count,
  first_seen_at,
  last_seen_at
)
SELECT
  n.norm_domain,
  NULL,    -- unclassified
  NULL,    -- no method assigned yet
  NULL,    -- no confidence
  n.occurrences,
  now(),
  now()
FROM normalized n
ON CONFLICT (domain) DO UPDATE
  SET occurrence_count = EXCLUDED.occurrence_count,
      last_seen_at = EXCLUDED.last_seen_at;

-- Audit log: log only newly-created rows (not the ON CONFLICT updates)
INSERT INTO source_classification_history (
  family_id, source_domain_id, changed_by, change_type, after, reason
)
SELECT
  sd.family_id,
  sd.id,
  'migration:phase_3',
  'created',
  jsonb_build_object('domain', sd.domain, 'occurrence_count', sd.occurrence_count),
  'Bulk-ingested from url_recency_cache during Phase 3. Awaiting classification.'
FROM source_domains sd
WHERE sd.classification_method IS NULL
  AND sd.family_id IS NULL;
