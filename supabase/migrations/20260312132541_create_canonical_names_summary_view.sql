-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260312132541; this file was
-- back-filled afterwards and therefore post-dates the deployment.


CREATE OR REPLACE VIEW canonical_names_summary AS
SELECT
  ccn.canonical_name,
  STRING_AGG(DISTINCT ccn.variant_name, ', ' ORDER BY ccn.variant_name) AS variants,
  MAX(ccn.website_domain) AS website_domain,
  MAX(cet.estimated_tier) AS employee_tier,
  MAX(cet.confidence) AS tier_confidence
FROM company_canonical_names ccn
LEFT JOIN company_employee_tiers cet
  ON LOWER(cet.company_name) = LOWER(ccn.variant_name)
GROUP BY ccn.canonical_name
ORDER BY ccn.canonical_name;

