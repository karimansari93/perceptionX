-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260716145812; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Resolve google.com/url redirect wrappers in canonical_citations to their target URLs.
-- Scope: Ford, Ford Business Solutions, Ford Credit rows only. Reversible: original wrapper
-- preserved in 'original_url', rewritten entries flagged 'resolved_from' = 'google_redirect'.

CREATE OR REPLACE FUNCTION pg_temp.urldecode(input text) RETURNS text AS $$
SELECT convert_from(CAST(E'\\x' || string_agg(
  CASE WHEN length(r.m[1]) = 1 THEN encode(convert_to(r.m[1], 'UTF8'), 'hex')
       ELSE substring(r.m[1] from 2 for 2) END, '') AS bytea), 'UTF8')
FROM regexp_matches(input, '%[0-9a-fA-F][0-9a-fA-F]|.', 'g') AS r(m);
$$ LANGUAGE sql IMMUTABLE STRICT;

UPDATE prompt_responses pr
SET canonical_citations = sub.new_cits
FROM (
  SELECT pr2.id,
         jsonb_agg(
           CASE
             WHEN lower(cit->>'domain') IN ('google.com','www.google.com')
                  AND cit->>'url' ~* '[?&]url=(https?|https?%3[aA])'
                  AND pg_temp.urldecode(substring(cit->>'url' from '[?&]url=([^&]+)')) ~* '^https?://[^/]+'
             THEN cit || jsonb_build_object(
               'original_url', cit->>'url',
               'resolved_from', 'google_redirect',
               'url', pg_temp.urldecode(substring(cit->>'url' from '[?&]url=([^&]+)')),
               'domain', regexp_replace(
                           lower(substring(pg_temp.urldecode(substring(cit->>'url' from '[?&]url=([^&]+)'))
                                 from '^https?://([^/:]+)')),
                           '^(www\.|m\.)', '')
             )
             ELSE cit
           END ORDER BY ord)
         AS new_cits
  FROM prompt_responses pr2
  JOIN companies c ON c.id = pr2.company_id
  CROSS JOIN LATERAL jsonb_array_elements(pr2.canonical_citations) WITH ORDINALITY AS t(cit, ord)
  WHERE c.name IN ('Ford','Ford Business Solutions','Ford Credit') AND length(c.name) >= 3
    AND pr2.canonical_citations IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(pr2.canonical_citations) e
      WHERE lower(e->>'domain') IN ('google.com','www.google.com')
        AND e->>'url' ~* '[?&]url=(https?|https?%3[aA])'
    )
  GROUP BY pr2.id
) sub
WHERE pr.id = sub.id;
