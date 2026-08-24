-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260416074513; this file was
-- back-filled afterwards and therefore post-dates the deployment.


UPDATE company_canonical_names SET canonical_name = 'Ford', updated_at = now()
WHERE lower(canonical_name) IN (
  'ford gb',
  'ford motor',
  'ford of britain',
  'ford-werke',
  'ford werke',
  'ford india (automotive)'
);

