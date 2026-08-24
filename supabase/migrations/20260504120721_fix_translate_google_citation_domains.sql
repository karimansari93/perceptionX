-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260504120721; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Fix citations where domain was incorrectly stored as 'translate.google.com'
-- The url field already contains the unwrapped target URL; only the domain field is wrong.
-- Recompute domain from url: strip http(s)://, strip leading www., take host up to first /, ?, or #.

UPDATE prompt_responses
SET citations = (
  SELECT jsonb_agg(
    CASE
      WHEN citation->>'domain' = 'translate.google.com'
        AND citation->>'url' IS NOT NULL
        AND citation->>'url' ~* '^https?://'
      THEN jsonb_set(
        citation,
        '{domain}',
        to_jsonb(
          regexp_replace(
            regexp_replace(citation->>'url', '^https?://', ''),
            '^(?:www\.)?([^/?#]+).*$',
            '\1'
          )
        )
      )
      ELSE citation
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(prompt_responses.citations) WITH ORDINALITY AS arr(citation, ord)
)
WHERE id IN (
  SELECT DISTINCT pr.id
  FROM prompt_responses pr,
       jsonb_array_elements(pr.citations) c
  WHERE c->>'domain' = 'translate.google.com'
);
