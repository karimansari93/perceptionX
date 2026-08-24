-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260310075731; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Update get_canonical_name_from_slug to return the canonical_name with the most rows
-- (handles duplicate entries like L'oreal vs L'Oréal — picks the primary one)
CREATE OR REPLACE FUNCTION get_canonical_name_from_slug(p_slug text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT canonical_name
  FROM rankings_overview
  WHERE slugify_name(canonical_name) = p_slug
  GROUP BY canonical_name
  ORDER BY COUNT(*) DESC
  LIMIT 1;
$$;

