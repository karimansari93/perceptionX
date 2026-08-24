-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260522132719; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Subsidiary/parent variant rows must not carry their own website_domain.
-- company_canonical_names.website_domain represents the CANONICAL's domain;
-- the rankings MVs take max(website_domain) across a canonical's variant rows.
-- A re-parented subsidiary (propel.com under PepsiCo) polluted that max(),
-- making PepsiCo render the Propel logo. Clear those rows.
UPDATE public.company_canonical_names
SET website_domain = NULL
WHERE variant_type IN ('subsidiary','parent')
  AND website_domain IS NOT NULL;
