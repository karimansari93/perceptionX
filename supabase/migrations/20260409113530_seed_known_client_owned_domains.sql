-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260409113530; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Netflix owned domains
INSERT INTO company_owned_domains (company_id, domain, asset_type, is_auto_detected, notes)
SELECT c.id, d.domain, d.asset_type::text, false, d.notes
FROM (SELECT id FROM companies WHERE name = 'Netflix' LIMIT 1) c
CROSS JOIN (VALUES
  ('netflix.com',               'corporate',  'Main corporate/product domain'),
  ('jobs.netflix.com',          'careers',    'Primary careers site — highest cited Netflix domain'),
  ('about.netflix.com',         'corporate',  'Corporate about/culture pages'),
  ('explore.jobs.netflix.net',  'careers',    'Secondary careers/jobs portal'),
  ('netflixtechblog.com',       'tech_blog',  'Engineering and technology blog'),
  ('help.netflix.com',          'support',    'Customer support'),
  ('ir.netflix.net',            'investor',   'Investor relations')
) AS d(domain, asset_type, notes)
ON CONFLICT (company_id, domain) DO NOTHING;

-- Cloudera owned domains
INSERT INTO company_owned_domains (company_id, domain, asset_type, is_auto_detected, notes)
SELECT c.id, d.domain, d.asset_type::text, false, d.notes
FROM (SELECT id FROM companies WHERE name = 'Cloudera' LIMIT 1) c
CROSS JOIN (VALUES
  ('cloudera.com',    'corporate', 'Main corporate domain'),
  ('es.cloudera.com', 'regional',  'Spanish-language regional site')
) AS d(domain, asset_type, notes)
ON CONFLICT (company_id, domain) DO NOTHING;

-- GoFundMe owned domains
INSERT INTO company_owned_domains (company_id, domain, asset_type, is_auto_detected, notes)
SELECT c.id, d.domain, d.asset_type::text, false, d.notes
FROM (SELECT id FROM companies WHERE name = 'GoFundMe' LIMIT 1) c
CROSS JOIN (VALUES
  ('gofundme.com',         'product', 'Product is the brand — main domain cited for employer perception'),
  ('support.gofundme.com', 'support', 'Customer support subdomain')
) AS d(domain, asset_type, notes)
ON CONFLICT (company_id, domain) DO NOTHING;

