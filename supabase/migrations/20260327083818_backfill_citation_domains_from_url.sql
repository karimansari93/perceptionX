-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260327083818; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Backfill domain field for citations where domain is 'unknown' or 'translate.google.com'
-- by extracting the real domain from the URL

UPDATE prompt_responses
SET citations = (
  SELECT jsonb_agg(
    CASE
      -- Fix 'unknown': extract hostname from URL directly
      WHEN (citation->>'domain') = 'unknown' AND (citation->>'url') IS NOT NULL AND (citation->>'url') != '' THEN
        jsonb_set(
          citation,
          '{domain}',
          to_jsonb(
            regexp_replace(
              regexp_replace(citation->>'url', '^https?://(www\.)?', ''),
              '[/?#].*$', ''
            )
          )
        )
      -- Fix 'translate.google.com': extract real domain from u= parameter
      WHEN (citation->>'domain') = 'translate.google.com' AND (citation->>'url') LIKE '%u=%' THEN
        jsonb_set(
          citation,
          '{domain}',
          to_jsonb(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(citation->>'url', '^.*[?&]u=', ''),
                  '%3A%2F%2F', '://'
                ),
                '^https?://(www\.)?', ''
              ),
              '[/?&#].*$', ''
            )
          )
        )
      ELSE citation
    END
  )
  FROM jsonb_array_elements(citations) AS citation
)
WHERE citations IS NOT NULL
  AND citations != 'null'::jsonb
  AND jsonb_array_length(citations) > 0
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(citations) AS c
    WHERE (c->>'domain') IN ('unknown', 'translate.google.com')
  );

