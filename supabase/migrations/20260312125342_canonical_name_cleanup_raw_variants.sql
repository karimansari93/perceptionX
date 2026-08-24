-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260312125342; this file was
-- back-filled afterwards and therefore post-dates the deployment.


INSERT INTO company_canonical_names (variant_name, canonical_name) VALUES
  ('bristol-myers squibb co',         'Bristol Myers Squibb'),
  ('bristol-myers squibb co.',        'Bristol Myers Squibb'),
  ('mcdonald''s deutschland llc',     'McDonald''s'),
  ('yum',                             'Yum'),
  ('yum! brands germany',             'Yum'),
  ('yum china holdings',              'Yum'),
  ('yum china holdings inc.',         'Yum')
ON CONFLICT (variant_name) DO UPDATE SET canonical_name = EXCLUDED.canonical_name;

