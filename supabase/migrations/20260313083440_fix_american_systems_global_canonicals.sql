-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260313083440; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Add "american systems" and "american global" as proper canonical entries
-- so they don't get mangled into the bare "american" variant

INSERT INTO company_canonical_names (id, variant_name, canonical_name, is_verified, source)
VALUES
  (gen_random_uuid(), 'american systems', 'American Systems', true, 'manual'),
  (gen_random_uuid(), 'american global', 'American Global', true, 'manual')
ON CONFLICT (variant_name) DO UPDATE SET canonical_name = EXCLUDED.canonical_name;

