-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260414072247; this file was
-- back-filled afterwards and therefore post-dates the deployment.


INSERT INTO company_canonical_names (variant_name, canonical_name, website_domain, is_verified, source)
VALUES
  ('yum brands',                 'Yum! Brands', 'yum.com', true, 'manual'),
  ('yum! brands inc',            'Yum! Brands', 'yum.com', true, 'manual'),
  ('yum!',                       'Yum! Brands', 'yum.com', true, 'manual'),
  ('yum',                        'Yum! Brands', 'yum.com', true, 'manual'),
  ('yum! restaurant holdings',   'Yum! Brands', 'yum.com', true, 'manual'),
  ('yum restaurants india',      'Yum! Brands', 'yum.com', true, 'manual'),
  ('yum china holdings inc',     'Yum China',   'yumchina.com', true, 'manual')
ON CONFLICT (variant_name) DO UPDATE SET
  canonical_name = EXCLUDED.canonical_name,
  website_domain = EXCLUDED.website_domain,
  is_verified = true,
  updated_at = now();

