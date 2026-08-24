-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260714084606; this file was
-- back-filled afterwards and therefore post-dates the deployment.

UPDATE url_recency_cache r
SET extraction_method = 'social-post',
    recency_score = NULL,
    last_checked_at = now()
WHERE r.extraction_method IN ('not-found','problematic-domain')
  AND r.manually_reviewed_at IS NULL
  AND lower(regexp_replace(split_part(split_part(r.url,'//',2),'/',1),'^www\.','')) ~ '(instagram|tiktok|facebook)\.com'
  AND r.url IN (
    SELECT DISTINCT j->>'url'
    FROM prompt_responses pr
    CROSS JOIN LATERAL jsonb_array_elements(pr.citations) j
    WHERE pr.company_id = '19a134db-bdd1-466f-ba15-0f825a06e748'
      AND pr.ai_model <> 'claude'
      AND jsonb_typeof(pr.citations) = 'array'
  );
