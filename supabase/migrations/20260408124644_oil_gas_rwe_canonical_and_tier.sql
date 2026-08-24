-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260408124644; this file was
-- back-filled afterwards and therefore post-dates the deployment.


INSERT INTO company_canonical_names (variant_name, canonical_name, website_domain, is_verified, source)
VALUES
  ('rwe',           'RWE', 'rwe.com', true, 'manual'),
  ('rwe oil & gas', 'RWE', 'rwe.com', true, 'manual')
ON CONFLICT (variant_name) DO UPDATE SET
  canonical_name = EXCLUDED.canonical_name,
  website_domain = EXCLUDED.website_domain,
  is_verified = true,
  updated_at = now();

INSERT INTO company_employee_tiers (company_name, estimated_tier, confidence, classified_by, classified_at)
VALUES ('RWE', '50000+', 'high', 'manual', now())
ON CONFLICT (company_name) DO NOTHING;

