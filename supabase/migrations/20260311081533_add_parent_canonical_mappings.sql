-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260311081533; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Map regional/divisional variants to their true parent canonical
-- These will ensure that when querying by canonical_name, divisions resolve to parent

INSERT INTO company_canonical_names (variant_name, canonical_name, is_verified, source)
VALUES
  -- Mercedes-Benz family
  ('mercedes-benz u.s.', 'Mercedes-Benz', true, 'manual'),
  ('mercedes‑benz u.s.', 'Mercedes-Benz', true, 'manual'),
  ('mercedes-amg', 'Mercedes-Benz', true, 'manual'),
  ('mercedes amg', 'Mercedes-Benz', true, 'manual'),
  ('mercedes-benz ag', 'Mercedes-Benz', true, 'manual'),

  -- Toyota family
  ('toyota motor europe', 'Toyota', true, 'manual'),
  ('toyota u.s.', 'Toyota', true, 'manual'),
  ('toyota motor manufacturing', 'Toyota', true, 'manual'),

  -- Hyundai family
  ('hyundai mobis', 'Hyundai', true, 'manual'),

  -- Airbus family
  ('airbus defence & space', 'Airbus', true, 'manual'),
  ('airbus defence and space', 'Airbus', true, 'manual'),

  -- Rolls-Royce family
  ('rolls-royce deutschland', 'Rolls-Royce', true, 'manual'),
  ('rolls royce deutschland', 'Rolls-Royce', true, 'manual'),

  -- Siemens family
  ('siemens digital industries software', 'Siemens', true, 'manual'),
  ('siemens digital industries', 'Siemens', true, 'manual'),

  -- Roche family
  ('roche deutschland', 'Roche', true, 'manual'),

  -- Eli Lilly family
  ('lilly deutschland', 'Eli Lilly', true, 'manual'),
  ('lilly', 'Eli Lilly', true, 'manual'),

  -- Honda family
  ('honda manufacturing of alabama', 'Honda', true, 'manual'),
  ('honda of america manufacturing', 'Honda', true, 'manual'),
  ('honda of america', 'Honda', true, 'manual'),
  ('subaru of indiana automotive', 'Subaru', true, 'manual'),

  -- Michelin family
  ('michelin north america', 'Michelin', true, 'manual'),

  -- Otsuka family
  ('otsuka america pharmaceutical', 'Otsuka', true, 'manual'),

  -- T-Mobile family
  ('t-mobile us', 'T-Mobile', true, 'manual'),

  -- McLaren family
  ('mclaren applied', 'McLaren', true, 'manual'),

  -- Rohde & Schwarz family
  ('rohde & schwarz aerospace & defense', 'Rohde & Schwarz', true, 'manual'),

  -- Renault family
  ('renault trucks', 'Renault', true, 'manual'),
  ('renault ampere', 'Renault', true, 'manual')

ON CONFLICT (variant_name) DO UPDATE SET
  canonical_name = EXCLUDED.canonical_name,
  is_verified = true,
  source = 'manual',
  updated_at = now();

