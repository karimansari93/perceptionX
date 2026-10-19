-- Netflix: additional owned domains, so owned vs third-party source splits
-- pick up every Netflix-run host AI cites. Added to the Netflix company that
-- already holds the owned-domain list (28af863e...). Exact hosts only for
-- shared platforms: never myworkdayjobs.com, medium.com or github.io.
-- Already present before this migration: netflix.com, jobs.netflix.com,
-- about.netflix.com, explore.jobs.netflix.net, help.netflix.com,
-- ir.netflix.net, netflixtechblog.com.
-- Additive and idempotent.

INSERT INTO public.company_owned_domains (company_id, domain, asset_type, notes)
SELECT '28af863e-2cc5-42a9-b324-53487206667d', d.domain, d.asset_type, d.notes
  FROM (VALUES
    ('netflix.net',                     'corporate', 'Root for Netflix-run .net hosts cited by AI: studiopartner / partnercollege / nextgen / npaa.pc'),
    ('netflix.wd108.myworkdayjobs.com', 'careers',   'Netflix Workday job listings (current tenant). Exact host only; never add myworkdayjobs.com'),
    ('netflix.wd1.myworkdayjobs.com',   'careers',   'Netflix Workday job listings (older tenant). Exact host only'),
    ('netflixtechblog.medium.com',      'tech_blog', 'Tech Blog posts served from the medium.com subdomain. Exact host only; never add medium.com'),
    ('research.netflix.com',            'tech_blog', 'Netflix Research site (ML / data science / engineering research)'),
    ('netflix.github.io',               'tech_blog', 'Netflix open-source project pages. Exact host only; never add github.io'),
    ('media.netflix.com',               'corporate', 'Netflix newsroom / press site'),
    ('advertising.netflix.com',         'product',   'Netflix Ads business site'),
    ('openconnect.netflix.com',         'product',   'Open Connect (CDN partner programme) site'),
    ('prod-resources.netflix.com',      'careers',   'Production crew resources incl. benefits and sick-time policies'),
    ('brand.netflix.com',               'corporate', 'Brand assets portal'),
    ('netflixstudios.com',              'corporate', 'Studio/production partner sites (partnerhelp / npfp / np3)'),
    ('partnerhelp.netflixstudios.com',  'support',   'Production partner help centre (dubbing / creative guidelines); exact host, root above also covers it'),
    ('netflixanimation.com',            'corporate', 'Netflix Animation studio site incl. work-life philosophy and FAQ pages'),
    ('netflixhouse.com',                'product',   'Netflix House (experiential venues)'),
    ('jobs.netflixhouse.com',           'careers',   'Netflix House careers site')
  ) AS d(domain, asset_type, notes)
ON CONFLICT (company_id, domain) DO NOTHING;
