-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260714084557; this file was
-- back-filled afterwards and therefore post-dates the deployment.

CREATE TABLE IF NOT EXISTS url_recency_cache_pepsico_reclass_backup_2026_07 AS
SELECT r.id, r.url, r.extraction_method AS old_extraction_method, r.recency_score AS old_recency_score, now() AS backed_up_at
FROM url_recency_cache r
WHERE r.extraction_method IN ('not-found','problematic-domain')
  AND r.manually_reviewed_at IS NULL
  AND r.url IN (
    SELECT DISTINCT j->>'url'
    FROM prompt_responses pr
    CROSS JOIN LATERAL jsonb_array_elements(pr.citations) j
    WHERE pr.company_id = '19a134db-bdd1-466f-ba15-0f825a06e748'
      AND pr.ai_model <> 'claude'
      AND jsonb_typeof(pr.citations) = 'array'
  );
