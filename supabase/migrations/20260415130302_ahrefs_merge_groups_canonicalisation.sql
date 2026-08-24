-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260415130302; this file was
-- back-filled afterwards and therefore post-dates the deployment.


INSERT INTO company_canonical_names (variant_name, canonical_name, website_domain, is_verified, source)
VALUES
  -- Accenture
  ('accenture solutions',               'Accenture',                    'accenture.com',              true, 'manual'),

  -- BOE Technology
  ('boe',                               'BOE Technology',               'boe.com',                    true, 'manual'),

  -- BYD
  ('byd group',                         'BYD',                          'byd.com',                    true, 'manual'),

  -- Capital (bare word → Capital Group)
  ('capital',                           'Capital Group',                'capitalgroup.com',            true, 'manual'),

  -- CBRE
  ('cbre group',                        'CBRE',                         'cbre.com',                   true, 'manual'),

  -- Cigna
  ('cigna global',                      'Cigna',                        'cigna.com',                  true, 'manual'),

  -- CK Hutchison
  ('ck hutchison',                      'CK Hutchison Holdings',        'ckhh.com',                   true, 'manual'),

  -- Coats
  ('coats group',                       'Coats',                        'coats.com',                  true, 'manual'),

  -- Colliers
  ('colliers international',            'Colliers',                     'colliers.com',               true, 'manual'),

  -- CSPC Pharmaceutical
  ('cspc pharmaceutical group',         'CSPC Pharmaceutical',          'cspc.com.cn',                true, 'manual'),

  -- DLF
  ('dlf limited',                       'DLF',                          'dlf.in',                     true, 'manual'),
  ('dlf ltd',                           'DLF',                          'dlf.in',                     true, 'manual'),

  -- Ergo
  ('ergo group',                        'Ergo',                         'ergo.com',                   true, 'manual'),

  -- Greenland (pick Group as canonical)
  ('greenland holdings',                'Greenland Group',              'greenlandgroupusa.com',       true, 'manual'),

  -- Halfords
  ('halfords group',                    'Halfords',                     'halfords.com',               true, 'manual'),

  -- Inspur
  ('inspur group',                      'Inspur',                       'inspur.com',                 true, 'manual'),

  -- K Raheja (pick Corp as canonical)
  ('k raheja group',                    'K Raheja Corp',                'krahejagroup.com',           true, 'manual'),

  -- Kuaishou
  ('kuaishou technology',               'Kuaishou',                     'kuaishou.com',               true, 'manual'),

  -- Lodha Group (master), absorb all variants
  ('lodha',                             'Lodha Group',                  'lodhagroup.com',             true, 'manual'),
  ('lodha developers',                  'Lodha Group',                  'lodhagroup.com',             true, 'manual'),
  ('lodha developers limited',          'Lodha Group',                  'lodhagroup.com',             true, 'manual'),

  -- Longfor Group
  ('longfor',                           'Longfor Group',                'longfor.com',                true, 'manual'),

  -- LONGi Green Energy
  ('longi green energy technology',     'Longi Green Energy',           'longi.com',                  true, 'manual'),

  -- Lupin
  ('lupin ltd',                         'Lupin',                        'lupinworld.com',             true, 'manual'),

  -- Microchip Technology (more specific name wins)
  ('microchip',                         'Microchip Technology',         'microchip.com',              true, 'manual'),

  -- Network18
  ('network18 group',                   'Network18',                    'network18.com',              true, 'manual'),

  -- Opendoor
  ('opendoor technologies',             'Opendoor',                     'opendoor.com',               true, 'manual'),

  -- QBE Insurance Group (pick Group as canonical)
  ('qbe insurance',                     'QBE Insurance Group',          'qbe.com',                    true, 'manual'),

  -- Rheinmetall
  ('rheinmetall ag',                    'Rheinmetall',                  'rheinmetall.com',            true, 'manual'),

  -- Seagate Technology (more specific wins)
  ('seagate',                           'Seagate Technology',           'seagate.com',                true, 'manual'),

  -- Segro
  ('segro plc',                         'Segro',                        'segro.com',                  true, 'manual'),

  -- Sobha (pick Sobha Ltd as canonical, higher mentions)
  ('sobha limited',                     'Sobha',                        'sobha.com',                  true, 'manual'),
  ('sobha ltd',                         'Sobha',                        'sobha.com',                  true, 'manual'),

  -- Talanx
  ('talanx ag',                         'Talanx',                       'talanx.com',                 true, 'manual'),

  -- Tata Communications
  ('tata communications limited',       'Tata Communications',          'tatacommunications.com',     true, 'manual'),

  -- Anywhere Real Estate
  ('anywhere real estate inc',          'Anywhere Real Estate',         'anywhere.re',                true, 'manual'),

  -- Bertelsmann
  ('bertelsmann group',                 'Bertelsmann',                  'bertelsmann.com',            true, 'manual'),

  -- General Mills
  ('general mills inc',                 'General Mills',                'generalmills.com',           true, 'manual'),

  -- Tata Realty
  ('tata realty and infrastructure ltd',     'Tata Realty And Infrastructure', 'tatarealty.in',       true, 'manual'),
  ('tata realty and infrastructure limited', 'Tata Realty And Infrastructure', 'tatarealty.in',       true, 'manual')

ON CONFLICT (variant_name) DO UPDATE SET
  canonical_name = EXCLUDED.canonical_name,
  website_domain = EXCLUDED.website_domain,
  is_verified = true,
  updated_at = now();

