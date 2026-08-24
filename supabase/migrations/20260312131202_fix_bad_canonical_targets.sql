-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260312131202; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Fix mappings where the canonical_name target is itself a regional variant
-- that should point to the true parent brand instead

UPDATE company_canonical_names SET canonical_name = 'Burger King'
WHERE lower(variant_name) = 'burger king deutschland gmbh';

UPDATE company_canonical_names SET canonical_name = 'Burger King'
WHERE lower(variant_name) = 'burger king europe gmbh';

-- Fix any other GmbH variants pointing to Deutschland sub-brands
UPDATE company_canonical_names SET canonical_name = 'Domino''s Pizza'
WHERE lower(variant_name) LIKE 'domino''s pizza deutschland%';

UPDATE company_canonical_names SET canonical_name = 'Ikea'
WHERE lower(variant_name) LIKE 'ikea deutschland%';

UPDATE company_canonical_names SET canonical_name = 'Decathlon'
WHERE lower(variant_name) LIKE 'decathlon deutschland%';

-- Also add missing mappings for variants still appearing as canonical_names in rankings_overview
-- that have no mapping at all yet
INSERT INTO company_canonical_names (variant_name, canonical_name)
VALUES
  ('burger king deutschland', 'Burger King'),
  ('ford motor company', 'Ford'),
  ('deere & company', 'John Deere'),
  ('bharat electronics limited', 'Bharat Electronics'),
  ('bharat sanchar nigam limited', 'Bharat Sanchar Nigam')
ON CONFLICT (variant_name) DO UPDATE SET canonical_name = EXCLUDED.canonical_name;

-- Refresh the mat view to apply all fixes
REFRESH MATERIALIZED VIEW rankings_overview;

NOTIFY pgrst, 'reload schema';

