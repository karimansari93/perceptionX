-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260408123147; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Canonicalisation: merge known variants into canonical names
INSERT INTO company_canonical_names (variant_name, canonical_name, website_domain, is_verified, source)
VALUES
  ('chevron corporation',           'Chevron',                      'chevron.com',               true, 'manual'),
  ('conocophillips',                'ConocoPhillips',               'conocophillips.com',         true, 'manual'),
  ('schlumberger',                  'SLB',                          'slb.com',                    true, 'manual'),
  ('slb',                           'SLB',                          'slb.com',                    true, 'manual'),
  ('occidental',                    'Occidental Petroleum',         'oxy.com',                    true, 'manual'),
  ('oxy',                           'Occidental Petroleum',         'oxy.com',                    true, 'manual'),
  ('hess corporation',              'Hess',                         'hess.com',                   true, 'manual'),
  ('hess',                          'Hess',                         'hess.com',                   true, 'manual'),
  ('anadarko petroleum',            'Occidental Petroleum',         'oxy.com',                    true, 'manual'),
  ('anadarko',                      'Occidental Petroleum',         'oxy.com',                    true, 'manual'),
  ('pioneer natural resources',     'Pioneer Natural Resources',    'pxd.com',                    true, 'manual'),
  ('shell usa',                     'Shell',                        'shell.com',                  true, 'manual'),
  ('bp europa se',                  'BP',                           'bp.com',                     true, 'manual'),
  ('phillips 66',                   'Phillips 66',                  'phillips66.com',              true, 'manual'),
  ('marathon petroleum',            'Marathon Petroleum',           'marathonpetroleum.com',       true, 'manual'),
  ('halliburton',                   'Halliburton',                  'halliburton.com',             true, 'manual'),
  ('devon energy',                  'Devon Energy',                 'devonenergy.com',             true, 'manual'),
  ('atmos energy',                  'Atmos Energy',                 'atmosenergy.com',             true, 'manual'),
  ('enbridge',                      'Enbridge',                     'enbridge.com',                true, 'manual'),
  ('kinder morgan',                 'Kinder Morgan',                'kindermorgan.com',            true, 'manual'),
  ('oneok',                         'ONEOK',                        'oneok.com',                   true, 'manual'),
  ('eqt corporation',               'EQT Corporation',              'eqt.com',                     true, 'manual'),
  ('energy transfer',               'Energy Transfer',              'energytransfer.com',          true, 'manual'),
  ('cheniere energy',               'Cheniere Energy',              'cheniere.com',                true, 'manual'),
  ('sempra',                        'Sempra',                       'sempra.com',                  true, 'manual'),
  ('saudi aramco',                  'Saudi Aramco',                 'aramco.com',                  true, 'manual'),
  ('plains all american pipeline',  'Plains All American Pipeline', 'plainsallamerican.com',       true, 'manual'),
  ('enverus',                       'Enverus',                      'enverus.com',                 true, 'manual'),
  ('mansfield energy',              'Mansfield Energy',             'mansfieldenergy.com',         true, 'manual'),
  ('hilcorp energy company',        'Hilcorp Energy',               'hilcorpenergy.com',           true, 'manual'),
  ('avangrid',                      'Avangrid',                     'avangrid.com',                true, 'manual'),
  ('firstenergy',                   'FirstEnergy',                  'firstenergycorp.com',         true, 'manual'),
  ('nes fircroft',                  'NES Fircroft',                 'nesfircroft.com',             true, 'manual'),
  ('magnolia oil & gas',            'Magnolia Oil & Gas',           'magnoliaoilgas.com',          true, 'manual'),
  ('ingevity',                      'Ingevity',                     'ingevity.com',                true, 'manual')
ON CONFLICT (variant_name) DO UPDATE SET
  canonical_name = EXCLUDED.canonical_name,
  website_domain = EXCLUDED.website_domain,
  is_verified = true,
  updated_at = now();

-- Tiers for all Oil & Gas companies missing them (insert under canonical name)
INSERT INTO company_employee_tiers (company_name, estimated_tier, confidence, classified_by, classified_at)
VALUES
  ('Chevron',                       '50000+',     'high',   'manual', now()),
  ('ConocoPhillips',                '5000-49999', 'high',   'manual', now()),
  ('Phillips 66',                   '5000-49999', 'high',   'manual', now()),
  ('Occidental Petroleum',          '5000-49999', 'high',   'manual', now()),
  ('Devon Energy',                  '5000-49999', 'high',   'manual', now()),
  ('Pioneer Natural Resources',     '5000-49999', 'high',   'manual', now()),
  ('SLB',                           '50000+',     'high',   'manual', now()),
  ('Atmos Energy',                  '5000-49999', 'high',   'manual', now()),
  ('Marathon Petroleum',            '5000-49999', 'high',   'manual', now()),
  ('Halliburton',                   '50000+',     'high',   'manual', now()),
  ('Hess',                          '5000-49999', 'high',   'manual', now()),
  ('Enbridge',                      '50000+',     'high',   'manual', now()),
  ('Kinder Morgan',                 '5000-49999', 'high',   'manual', now()),
  ('ONEOK',                         '5000-49999', 'high',   'manual', now()),
  ('EQT Corporation',               '5000-49999', 'high',   'manual', now()),
  ('Energy Transfer',               '5000-49999', 'high',   'manual', now()),
  ('Cheniere Energy',               '5000-49999', 'high',   'manual', now()),
  ('Sempra',                        '5000-49999', 'high',   'manual', now()),
  ('Saudi Aramco',                  '50000+',     'high',   'manual', now()),
  ('Plains All American Pipeline',  '5000-49999', 'high',   'manual', now()),
  ('Enverus',                       '500-4999',   'medium', 'manual', now()),
  ('Mansfield Energy',              '500-4999',   'medium', 'manual', now()),
  ('Hilcorp Energy',                '500-4999',   'medium', 'manual', now()),
  ('Avangrid',                      '5000-49999', 'high',   'manual', now()),
  ('FirstEnergy',                   '5000-49999', 'high',   'manual', now()),
  ('NES Fircroft',                  '500-4999',   'medium', 'manual', now()),
  ('Magnolia Oil & Gas',            '500-4999',   'medium', 'manual', now()),
  ('Ingevity',                      '500-4999',   'medium', 'manual', now())
ON CONFLICT (company_name) DO NOTHING;

