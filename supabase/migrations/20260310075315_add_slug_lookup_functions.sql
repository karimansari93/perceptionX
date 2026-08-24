-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260310075315; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Enable unaccent extension for accent-stripping
CREATE EXTENSION IF NOT EXISTS unaccent;

-- slugify_name: mirrors frontend toSlug() exactly
--   L'Oréal → loreal
--   GSK     → gsk
--   AT&T    → atandt
--   Estée Lauder → estee-lauder
CREATE OR REPLACE FUNCTION slugify_name(name text) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
  result text := name;
BEGIN
  -- Strip diacritical marks (é → e, ü → u, etc.)
  result := unaccent(result);
  -- Strip apostrophes: U+0027 ('), U+0060 (`), U+2018 ('), U+2019 (')
  result := translate(result, chr(39) || chr(96) || chr(8216) || chr(8217), '');
  -- Replace & with 'and' (matches frontend: .replace(/&/g, 'and'))
  result := replace(result, '&', 'and');
  -- Strip remaining non-alphanumeric chars (except spaces and hyphens)
  result := regexp_replace(result, '[^a-zA-Z0-9 -]', '', 'g');
  -- Lowercase
  result := lower(result);
  -- Collapse spaces to hyphens
  result := regexp_replace(result, ' +', '-', 'g');
  -- Collapse multiple hyphens
  result := regexp_replace(result, '-+', '-', 'g');
  -- Trim leading/trailing hyphens
  result := trim(both '-' from result);
  RETURN result;
END;
$$;

-- get_canonical_name_from_slug: reverse lookup slug → canonical_name
-- Usage: SELECT get_canonical_name_from_slug('loreal') → 'L''Oréal'
CREATE OR REPLACE FUNCTION get_canonical_name_from_slug(p_slug text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT canonical_name
  FROM (SELECT DISTINCT canonical_name FROM rankings_overview) names
  WHERE slugify_name(canonical_name) = p_slug
  LIMIT 1;
$$;

