-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260312131135; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Fix mappings that point to an intermediate canonical (not the final one)
-- These are old mappings like "X GmbH" → "X Deutschland" that need to go all the way to the parent

-- Burger King
UPDATE company_canonical_names 
SET canonical_name = 'Burger King' 
WHERE canonical_name = 'Burger King Deutschland';

-- Find and fix Ford intermediate mappings
UPDATE company_canonical_names 
SET canonical_name = 'Ford Motor' 
WHERE canonical_name IN ('Ford Motor Company', 'Ford Motor Private Limited');

-- Fix BMW
UPDATE company_canonical_names 
SET canonical_name = 'BMW' 
WHERE canonical_name IN ('Bmw of North America', 'BMW of North America');

-- Fix Domino's Pizza Deutschland
UPDATE company_canonical_names 
SET canonical_name = 'Domino''s Pizza' 
WHERE canonical_name = 'Domino''s Pizza Deutschland';

-- Fix Deloitte intermediate variants
UPDATE company_canonical_names 
SET canonical_name = 'Deloitte' 
WHERE canonical_name IN ('Deloitte Consulting', 'Deloitte LLP', 'Deloitte Consulting LLP');

-- Fix any other intermediate Deutschland mappings pointing to X Deutschland
UPDATE company_canonical_names 
SET canonical_name = regexp_replace(canonical_name, '\s+Deutschland$', '', 'i')
WHERE canonical_name ILIKE '% Deutschland'
AND canonical_name NOT IN ('Burger King Deutschland'); -- already handled above

-- Refresh materialized view to pick up all fixes
REFRESH MATERIALIZED VIEW rankings_overview;

-- Refresh rankings_historical if it exists  
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'rankings_historical') THEN
    REFRESH MATERIALIZED VIEW rankings_historical;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

