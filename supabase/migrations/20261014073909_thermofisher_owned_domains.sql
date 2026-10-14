-- Thermo Fisher Scientific: owned domains, so owned vs third-party source
-- splits work for this client. Hosts are listed exactly as AI cites them
-- (collection cycle 2026-09-01). PPD, Patheon and Fisher Scientific count as
-- Thermo Fisher, so their sites are owned too.
-- Left out on purpose (third-party job boards that host a Thermo Fisher
-- profile): thermofisher.dejobs.org, thermofisher.jobs.cz.
-- Additive and idempotent.

INSERT INTO public.company_owned_domains (company_id, domain, asset_type, notes)
SELECT '74179bad-6411-44fc-9c89-e10868472924', d.domain, d.asset_type, d.notes
  FROM (VALUES
    ('jobs.thermofisher.com',               'careers',   'Main careers site'),
    ('thermofisher.wd5.myworkdayjobs.com',  'careers',   'Workday application portal'),
    ('thermofisher.com',                    'corporate', 'Main corporate and product domain'),
    ('corporate.thermofisher.com',          'corporate', 'Corporate site (about, CSR, culture)'),
    ('ir.thermofisher.com',                 'investor',  'Investor relations'),
    ('newsroom.thermofisher.com',           'corporate', 'Newsroom'),
    ('thermofisher.mediaroom.com',          'corporate', 'Newsroom (hosted media room)'),
    ('india.newsroom.thermofisher.com',     'regional',  'India newsroom'),
    ('thermofisher.cn',                     'regional',  'China site'),
    ('assets.thermofisher.com',             'product',   'Asset and document host'),
    ('assets.thermofisher.cn',              'regional',  'China asset host'),
    ('documents.thermofisher.com',          'product',   'Document host'),
    ('commerce.thermofisher.com',           'product',   'Commerce site'),
    ('qa1-corporate.thermofisher.com',      'other',     'QA test site that is publicly readable; see watch item 2026-09-01:watch-qa-site'),
    ('ppd.com',                             'corporate', 'PPD, counts as Thermo Fisher'),
    ('patheon.com',                         'corporate', 'Patheon, counts as Thermo Fisher'),
    ('patheon.cn',                          'regional',  'Patheon China, counts as Thermo Fisher'),
    ('fishersci.com',                       'product',   'Fisher Scientific, counts as Thermo Fisher'),
    ('fishersci.de',                        'regional',  'Fisher Scientific Germany'),
    ('fishersci.co.uk',                     'regional',  'Fisher Scientific UK'),
    ('preview.fishersci.ch',                'other',     'Fisher Scientific Switzerland preview site'),
    ('fisherclinicalservices.com',          'corporate', 'Fisher Clinical Services, counts as Thermo Fisher')
  ) AS d(domain, asset_type, notes)
ON CONFLICT (company_id, domain) DO NOTHING;
