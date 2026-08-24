-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260416070721; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- 4a: Exclude <50 and 50-499 tier companies
INSERT INTO company_overrides (canonical_name, status, exclusion_reason, notes)
SELECT DISTINCT ccn.canonical_name, 'excluded', 'other',
  'Enterprise filter: tier ' || cet.estimated_tier || ' (<500 employees)'
FROM company_canonical_names ccn
JOIN company_employee_tiers cet ON lower(ccn.variant_name) = lower(cet.company_name)
WHERE cet.estimated_tier IN ('<50', '50-499')
ON CONFLICT (canonical_name) DO NOTHING;

INSERT INTO company_overrides (canonical_name, status, exclusion_reason, notes)
SELECT DISTINCT cvh.canonical_name, 'excluded', 'other',
  'Enterprise filter: tier ' || cet.estimated_tier || ' (<500 employees)'
FROM company_visibility_history cvh
JOIN company_employee_tiers cet ON lower(cvh.canonical_name) = lower(cet.company_name)
LEFT JOIN company_canonical_names ccn ON lower(cvh.canonical_name) = lower(ccn.variant_name)
WHERE cet.estimated_tier IN ('<50', '50-499')
  AND ccn.variant_name IS NULL
ON CONFLICT (canonical_name) DO NOTHING;

-- 4b: Exclude unknown tier
INSERT INTO company_overrides (canonical_name, status, exclusion_reason, notes)
SELECT DISTINCT ccn.canonical_name, 'excluded', 'other',
  'Enterprise filter: unknown employee count'
FROM company_canonical_names ccn
JOIN company_employee_tiers cet ON lower(ccn.variant_name) = lower(cet.company_name)
WHERE cet.estimated_tier = 'unknown'
ON CONFLICT (canonical_name) DO NOTHING;

INSERT INTO company_overrides (canonical_name, status, exclusion_reason, notes)
SELECT DISTINCT cvh.canonical_name, 'excluded', 'other',
  'Enterprise filter: unknown employee count'
FROM company_visibility_history cvh
JOIN company_employee_tiers cet ON lower(cvh.canonical_name) = lower(cet.company_name)
LEFT JOIN company_canonical_names ccn ON lower(cvh.canonical_name) = lower(ccn.variant_name)
WHERE cet.estimated_tier = 'unknown'
  AND ccn.variant_name IS NULL
ON CONFLICT (canonical_name) DO NOTHING;

-- 4c: Exclude no tier entry at all
INSERT INTO company_overrides (canonical_name, status, exclusion_reason, notes)
SELECT DISTINCT ccn.canonical_name, 'excluded', 'other',
  'Enterprise filter: no employee tier data found'
FROM company_canonical_names ccn
LEFT JOIN company_employee_tiers cet ON lower(ccn.variant_name) = lower(cet.company_name)
WHERE cet.company_name IS NULL
ON CONFLICT (canonical_name) DO NOTHING;

-- 4d: Re-include the 16 companies we corrected in Section 1
DELETE FROM company_overrides
WHERE canonical_name IN (
  'Snowflake', 'Revolut', 'Wise', 'OVHcloud', 'BeiGene',
  'C6 Bank', 'Trade Republic', 'Freshworks', 'Rapid7',
  'StoneCo', 'Shake Shack', 'GetYourGuide', 'GitLab',
  'Airwallex', 'Chargebee', 'Agibank'
)
AND exclusion_reason = 'other'
AND notes LIKE 'Enterprise filter:%';

