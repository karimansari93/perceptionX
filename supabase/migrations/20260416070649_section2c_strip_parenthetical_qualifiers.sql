-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260416070649; this file was
-- back-filled afterwards and therefore post-dates the deployment.


UPDATE company_canonical_names
SET canonical_name = regexp_replace(canonical_name, '\s*\([^)]+\)\s*$', ''),
    updated_at = now()
WHERE canonical_name ~ '\([^)]+\)$'
  AND EXISTS (
    SELECT 1 FROM company_canonical_names c2
    WHERE lower(c2.canonical_name) = lower(regexp_replace(company_canonical_names.canonical_name, '\s*\([^)]+\)\s*$', ''))
      AND c2.canonical_name != company_canonical_names.canonical_name
  );

