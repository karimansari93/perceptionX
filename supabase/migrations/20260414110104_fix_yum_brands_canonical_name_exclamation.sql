-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260414110104; this file was
-- back-filled afterwards and therefore post-dates the deployment.


UPDATE company_canonical_names
SET canonical_name = 'Yum! Brands', website_domain = 'yum.com', updated_at = now()
WHERE canonical_name = 'Yum Brands';

