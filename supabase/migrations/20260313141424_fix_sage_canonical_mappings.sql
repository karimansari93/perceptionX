-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260313141424; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Fix Sage Software → Sage
UPDATE company_canonical_names
SET canonical_name = 'Sage', updated_at = now()
WHERE LOWER(variant_name) = 'sage software';

-- Fix The Sage Group → Sage
UPDATE company_canonical_names
SET canonical_name = 'Sage', updated_at = now()
WHERE LOWER(variant_name) = 'the sage group';

-- Fix SageMaker — remap to its correct canonical (AWS product, not a company)
-- We exclude it via company_overrides but also correct the canonical so it doesn't surface
UPDATE company_canonical_names
SET canonical_name = 'SageMaker', updated_at = now()
WHERE LOWER(variant_name) = 'sagemaker';

-- Insert SageMaker exclusion into company_overrides if not already there
INSERT INTO company_overrides (canonical_name, status, exclusion_reason, notes)
VALUES ('SageMaker', 'excluded', 'product_not_company', 'AWS SageMaker product — not a standalone employer')
ON CONFLICT (canonical_name) DO NOTHING;

-- Also exclude Sage People while we're here
INSERT INTO company_overrides (canonical_name, status, exclusion_reason, notes)
VALUES ('Sage People', 'excluded', 'product_not_company', 'Sage Group HR product — not a standalone employer')
ON CONFLICT (canonical_name) DO NOTHING;

