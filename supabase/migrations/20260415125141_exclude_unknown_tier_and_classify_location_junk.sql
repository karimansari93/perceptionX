-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260415125141; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Fix 1: Classify known non-company junk as source entities so they're filtered at root
INSERT INTO company_entity_classifications (company_name, entity_type, reason, classified_by)
VALUES
  ('dubai',          'source', 'City/location, not a company', 'manual'),
  ('abu dhabi',      'source', 'City/location, not a company', 'manual'),
  ('berlin',         'source', 'City/location, not a company', 'manual'),
  ('london',         'source', 'City/location, not a company', 'manual'),
  ('singapore',      'source', 'City/location, not a company', 'manual'),
  ('shanghai',       'source', 'City/location, not a company', 'manual'),
  ('beijing',        'source', 'City/location, not a company', 'manual'),
  ('mumbai',         'source', 'City/location, not a company', 'manual'),
  ('delhi',          'source', 'City/location, not a company', 'manual'),
  ('bangalore',      'source', 'City/location, not a company', 'manual'),
  ('hyderabad',      'source', 'City/location, not a company', 'manual'),
  ('chennai',        'source', 'City/location, not a company', 'manual'),
  ('pune',           'source', 'City/location, not a company', 'manual'),
  ('kolkata',        'source', 'City/location, not a company', 'manual'),
  ('paris',          'source', 'City/location, not a company', 'manual'),
  ('tokyo',          'source', 'City/location, not a company', 'manual'),
  ('sydney',         'source', 'City/location, not a company', 'manual'),
  ('toronto',        'source', 'City/location, not a company', 'manual'),
  ('amsterdam',      'source', 'City/location, not a company', 'manual'),
  ('hong kong',      'source', 'City/location, not a company', 'manual'),
  ('riyadh',         'source', 'City/location, not a company', 'manual'),
  ('doha',           'source', 'City/location, not a company', 'manual'),
  ('cairo',          'source', 'City/location, not a company', 'manual'),
  ('nairobi',        'source', 'City/location, not a company', 'manual'),
  ('lagos',          'source', 'City/location, not a company', 'manual'),
  ('india',          'source', 'Country, not a company', 'manual'),
  ('china',          'source', 'Country, not a company', 'manual'),
  ('germany',        'source', 'Country, not a company', 'manual'),
  ('france',         'source', 'Country, not a company', 'manual'),
  ('brazil',         'source', 'Country, not a company', 'manual'),
  ('united states',  'source', 'Country, not a company', 'manual'),
  ('united kingdom', 'source', 'Country, not a company', 'manual'),
  ('uae',            'source', 'Country, not a company', 'manual'),
  ('ministry of daru','source','Nonsense/hallucination', 'manual'),
  ('enterprise',     'source', 'Generic term, not a specific company', 'manual'),
  ('startup',        'source', 'Generic term, not a specific company', 'manual'),
  ('government',     'source', 'Generic term, not a specific company', 'manual'),
  ('public sector',  'source', 'Generic term, not a specific company', 'manual')
ON CONFLICT (company_name) DO NOTHING;

