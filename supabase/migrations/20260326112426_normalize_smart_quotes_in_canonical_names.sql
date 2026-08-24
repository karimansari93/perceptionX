-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260326112426; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Helper function to normalize smart quotes to ASCII
CREATE OR REPLACE FUNCTION public.normalize_quotes(input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT REPLACE(REPLACE(REPLACE(REPLACE(
    input,
    E'\u2019', ''''),
    E'\u2018', ''''),
    E'\u201C', '"'),
    E'\u201D', '"')
$$;

-- Delete ALL smart-quote rows where an ASCII variant_name equivalent already exists
-- (unique constraint is on variant_name alone)
DELETE FROM company_canonical_names
WHERE id IN (
  SELECT s.id
  FROM company_canonical_names s
  INNER JOIN company_canonical_names a
    ON normalize_quotes(s.variant_name) = a.variant_name
    AND s.id != a.id
  WHERE s.variant_name ~ E'[\u2018\u2019\u201C\u201D]'
     OR s.canonical_name ~ E'[\u2018\u2019\u201C\u201D]'
);

-- Now update remaining smart-quote rows to ASCII (no conflicts since dupes are gone)
UPDATE company_canonical_names
SET 
  variant_name = normalize_quotes(variant_name),
  canonical_name = normalize_quotes(canonical_name)
WHERE variant_name ~ E'[\u2018\u2019\u201C\u201D]'
   OR canonical_name ~ E'[\u2018\u2019\u201C\u201D]';

-- Add trigger to auto-normalize on insert/update to prevent future duplicates
CREATE OR REPLACE FUNCTION public.normalize_canonical_name_quotes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.variant_name := normalize_quotes(NEW.variant_name);
  NEW.canonical_name := normalize_quotes(NEW.canonical_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_quotes ON company_canonical_names;
CREATE TRIGGER trg_normalize_quotes
  BEFORE INSERT OR UPDATE ON company_canonical_names
  FOR EACH ROW
  EXECUTE FUNCTION normalize_canonical_name_quotes();

