-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260809071757; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- UAE cleanup round 2: editorial folds + employee tiers. Mirrors repo
-- migration 20260809140000_uae_editorial_folds_and_tiers.sql (see file for
-- full rationale). ON CONFLICT DO NOTHING throughout - never overwrites
-- existing enrichment.

INSERT INTO public.company_canonical_names
  (variant_name, canonical_name, variant_type, brand_key, website_domain, source, is_verified)
SELECT v.variant_name, v.canonical_name, v.variant_type,
       lower(public.unaccent(v.canonical_name)), v.website_domain, 'manual', true
FROM (VALUES
  ('gig gulf',                 'GIG Gulf',   'alias',      'gig-gulf.com'),
  ('axa gulf',                 'GIG Gulf',   'alias',      NULL),
  ('axa uae',                  'GIG Gulf',   'alias',      NULL),
  ('axa insurance gulf',       'GIG Gulf',   'alias',      NULL),
  ('sukoon',                   'Sukoon',     'alias',      'sukoon.com'),
  ('oman insurance company',   'Sukoon',     'alias',      NULL),
  ('virgin mobile uae',        'du',         'subsidiary', NULL),
  ('virgin mobile mena',       'du',         'subsidiary', NULL),
  ('dnata',                    'dnata',      'alias',      'dnata.com'),
  ('mediclinic',               'Mediclinic', 'alias',      'mediclinic.com'),
  ('mediclinic international', 'Mediclinic', 'alias',      NULL),
  ('mediclinic middle east',   'Mediclinic', 'geo',        NULL),
  ('mediclinic city hospital dubai', 'Mediclinic', 'subsidiary', NULL),
  ('bupa arabia',              'Bupa Arabia', 'alias',     'bupa.com.sa'),
  ('agility',                  'Agility',    'alias',      'agility.com'),
  ('agility logistics',        'Agility',    'alias',      NULL),
  ('agility logistics uae',    'Agility',    'geo',        NULL),
  ('vox cinemas',              'Majid Al Futtaim', 'subsidiary', NULL),
  ('mubadala health',          'Mubadala',   'subsidiary', NULL),
  ('masdar city',              'Masdar',     'alias',      NULL),
  ('etihad airways',           'Etihad',     'alias',      NULL)
) AS v(variant_name, canonical_name, variant_type, website_domain)
ON CONFLICT (variant_name) DO NOTHING;

INSERT INTO public.company_canonical_names
  (variant_name, canonical_name, variant_type, brand_key, source, is_verified)
VALUES
  ('rsa uae',                              'Rsa',           'geo',   'rsa', 'manual', true),
  ('rsa middle east',                      'Rsa',           'geo',   'rsa', 'manual', true),
  ('rsa (royal sun alliance) middle east', 'Rsa',           'alias', 'rsa', 'manual', true),
  ('rsa insurance middle east',            'Rsa Insurance', 'geo',   'rsa insurance', 'manual', true)
ON CONFLICT (variant_name) DO NOTHING;

INSERT INTO public.company_canonical_names
  (variant_name, canonical_name, variant_type, brand_key, website_domain, source, is_verified)
SELECT v.variant_name, v.canonical_name, 'alias',
       lower(public.unaccent(v.canonical_name)), v.website_domain, 'manual', true
FROM (VALUES
  ('abu dhabi islamic bank',        'Abu Dhabi Islamic Bank',        'adib.ae'),
  ('tabby',                         'Tabby',                         'tabby.ai'),
  ('paytabs',                       'PayTabs',                       'paytabs.com'),
  ('wio bank',                      'Wio Bank',                      'wio.io'),
  ('yap',                           'YAP',                           NULL),
  ('osn',                           'OSN',                           'osn.com'),
  ('yahsat',                        'Yahsat',                        NULL),
  ('darkmatter',                    'DarkMatter',                    NULL),
  ('strata manufacturing',          'Strata Manufacturing',          'strata.aero'),
  ('network international',         'Network International',         'network.ae'),
  ('century financial',             'Century Financial',             NULL),
  ('dubai health authority',        'Dubai Health Authority',        'dha.gov.ae'),
  ('khalifa university',            'Khalifa University',            'ku.ac.ae'),
  ('abu dhabi media',               'Abu Dhabi Media',               NULL),
  ('dubai media incorporated',      'Dubai Media Incorporated',      NULL),
  ('abu dhabi investment authority','Abu Dhabi Investment Authority', NULL),
  ('adq',                           'ADQ',                           NULL),
  ('twofour54',                     'twofour54',                     NULL),
  ('dubai future foundation',       'Dubai Future Foundation',       NULL),
  ('abu dhabi global market',       'Abu Dhabi Global Market',       NULL),
  ('image nation abu dhabi',        'Image Nation Abu Dhabi',        NULL),
  ('imagenation abu dhabi',         'Image Nation Abu Dhabi',        NULL)
) AS v(variant_name, canonical_name, website_domain)
ON CONFLICT (variant_name) DO NOTHING;

INSERT INTO public.company_employee_tiers (company_name, estimated_tier, confidence, classified_by)
SELECT v.company_name, v.tier, v.conf, 'manual'
FROM (VALUES
  ('ADNOC',                    '50000+',     'high'),
  ('Lulu Group',               '50000+',     'high'),
  ('Emirates NBD',             '5000-49999', 'high'),
  ('First Abu Dhabi Bank',     '5000-49999', 'high'),
  ('Etisalat',                 '5000-49999', 'high'),
  ('SEHA',                     '5000-49999', 'high'),
  ('Emirates Global Aluminium','5000-49999', 'high'),
  ('Majid Al Futtaim',         '5000-49999', 'high'),
  ('Al-Futtaim',               '5000-49999', 'high'),
  ('Chalhoub Group',           '5000-49999', 'high'),
  ('Jumeirah Group',           '5000-49999', 'high'),
  ('Al Tayer Group',           '5000-49999', 'high'),
  ('dnata',                    '5000-49999', 'high'),
  ('Mediclinic',               '5000-49999', 'high'),
  ('Agility',                  '5000-49999', 'high'),
  ('PureHealth',               '5000-49999', 'high'),
  ('flydubai',                 '5000-49999', 'high'),
  ('ADCB',                     '5000-49999', 'high'),
  ('Mashreq',                  '5000-49999', 'medium'),
  ('Dubai Islamic Bank',       '5000-49999', 'medium'),
  ('G42',                      '5000-49999', 'medium'),
  ('noon',                     '5000-49999', 'medium'),
  ('Careem',                   '5000-49999', 'medium'),
  ('Burjeel Holdings',         '5000-49999', 'medium'),
  ('NMC Healthcare',           '5000-49999', 'medium'),
  ('Emaar',                    '5000-49999', 'medium'),
  ('Dubai Health Authority',   '5000-49999', 'medium'),
  ('Abu Dhabi Islamic Bank',   '5000-49999', 'medium'),
  ('du',                        '500-4999',  'medium'),
  ('Air Arabia',                '500-4999',  'medium'),
  ('Julphar',                   '500-4999',  'medium'),
  ('Masdar',                    '500-4999',  'medium'),
  ('Mubadala',                  '500-4999',  'medium'),
  ('MBC Group',                 '500-4999',  'medium'),
  ('Commercial Bank of Dubai',  '500-4999',  'medium'),
  ('Dubai Airports',            '500-4999',  'medium'),
  ('ADNIC',                     '500-4999',  'medium'),
  ('GIG Gulf',                  '500-4999',  'medium'),
  ('Sukoon',                    '500-4999',  'medium'),
  ('Bupa Arabia',               '500-4999',  'medium'),
  ('Tabby',                     '500-4999',  'medium'),
  ('PayTabs',                   '500-4999',  'medium'),
  ('Wio Bank',                  '500-4999',  'medium'),
  ('YAP',                       '500-4999',  'medium'),
  ('OSN',                       '500-4999',  'medium'),
  ('Yahsat',                    '500-4999',  'medium'),
  ('DarkMatter',                '500-4999',  'medium'),
  ('Strata Manufacturing',      '500-4999',  'medium'),
  ('Network International',     '500-4999',  'medium'),
  ('Century Financial',         '500-4999',  'medium'),
  ('Khalifa University',        '500-4999',  'medium'),
  ('twofour54',                 '500-4999',  'medium'),
  ('Image Nation Abu Dhabi',    '500-4999',  'medium'),
  ('Dubai Media Incorporated',  '500-4999',  'medium'),
  ('Abu Dhabi Media',           '500-4999',  'medium'),
  ('Abu Dhabi Investment Authority', '500-4999', 'medium'),
  ('ADQ',                       '500-4999',  'medium'),
  ('Dubai Future Foundation',   '500-4999',  'medium'),
  ('Abu Dhabi Global Market',   '500-4999',  'medium')
) AS v(company_name, tier, conf)
ON CONFLICT (company_name) DO NOTHING;
