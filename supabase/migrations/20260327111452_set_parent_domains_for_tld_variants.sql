-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260327111452; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Register regional TLD variants as directory sources with parent_domain set
-- These aren't new platforms, they're the same source in a different market

INSERT INTO directory_sources (domain, name, source_type, category, actionability, country_focus, parent_domain) VALUES

-- Glassdoor regional variants
('glassdoor.co.uk', 'Glassdoor UK', 'Review Platform', 'review', 'high', ARRAY['GB'], 'glassdoor.com'),
('glassdoor.co.in', 'Glassdoor India', 'Review Platform', 'review', 'high', ARRAY['IN'], 'glassdoor.com'),
('glassdoor.com.br', 'Glassdoor Brazil', 'Review Platform', 'review', 'high', ARRAY['BR'], 'glassdoor.com'),
('glassdoor.com.mx', 'Glassdoor Mexico', 'Review Platform', 'review', 'high', ARRAY['MX'], 'glassdoor.com'),
('glassdoor.com.ar', 'Glassdoor Argentina', 'Review Platform', 'review', 'high', ARRAY['AR'], 'glassdoor.com'),
('glassdoor.ie', 'Glassdoor Ireland', 'Review Platform', 'review', 'high', ARRAY['IE'], 'glassdoor.com'),
('glassdoor.nl', 'Glassdoor Netherlands', 'Review Platform', 'review', 'high', ARRAY['NL'], 'glassdoor.com'),
('glassdoor.sg', 'Glassdoor Singapore', 'Review Platform', 'review', 'high', ARRAY['SG'], 'glassdoor.com'),
('glassdoor.de', 'Glassdoor Germany', 'Review Platform', 'review', 'high', ARRAY['DE'], 'glassdoor.com'),
('glassdoor.es', 'Glassdoor Spain', 'Review Platform', 'review', 'high', ARRAY['ES'], 'glassdoor.com'),

-- Great Place to Work regional variants
('greatplacetowork.co.uk', 'Great Place to Work UK', 'Rankings & Lists', 'rankings', 'high', ARRAY['GB'], 'greatplacetowork.com'),
('greatplacetowork.co.kr', 'Great Place to Work Korea', 'Rankings & Lists', 'rankings', 'high', ARRAY['KR'], 'greatplacetowork.com'),
('greatplacetowork.com.mx', 'Great Place to Work Mexico', 'Rankings & Lists', 'rankings', 'high', ARRAY['MX'], 'greatplacetowork.com'),
('greatplacetowork.com.ar', 'Great Place to Work Argentina', 'Rankings & Lists', 'rankings', 'high', ARRAY['AR'], 'greatplacetowork.com'),
('greatplacetowork.de', 'Great Place to Work Germany', 'Rankings & Lists', 'rankings', 'high', ARRAY['DE'], 'greatplacetowork.com'),
('greatplacetowork.nl', 'Great Place to Work Netherlands', 'Rankings & Lists', 'rankings', 'high', ARRAY['NL'], 'greatplacetowork.com'),
('greatplacetowork.pl', 'Great Place to Work Poland', 'Rankings & Lists', 'rankings', 'high', ARRAY['PL'], 'greatplacetowork.com'),
('greatplacetowork.in', 'Great Place to Work India', 'Rankings & Lists', 'rankings', 'high', ARRAY['IN'], 'greatplacetowork.com'),
('gptw.com.br', 'Great Place to Work Brazil', 'Rankings & Lists', 'rankings', 'high', ARRAY['BR'], 'greatplacetowork.com'),

-- Indeed regional variants
('uk.indeed.com', 'Indeed UK', 'Job Aggregator', 'jobs', 'high', ARRAY['GB'], 'indeed.com'),
('in.indeed.com', 'Indeed India', 'Job Aggregator', 'jobs', 'high', ARRAY['IN'], 'indeed.com'),
('nl.indeed.com', 'Indeed Netherlands', 'Job Aggregator', 'jobs', 'high', ARRAY['NL'], 'indeed.com'),
('mx.indeed.com', 'Indeed Mexico', 'Job Aggregator', 'jobs', 'high', ARRAY['MX'], 'indeed.com'),

-- Built In regional variants
('builtinnyc.com', 'Built In NYC', 'Startup Directory', 'reference', 'high', ARRAY['US'], 'builtin.com'),
('builtinlondon.uk', 'Built In London', 'Startup Directory', 'reference', 'high', ARRAY['GB'], 'builtin.com'),

-- Korea-specific review/job platforms (standalone, not variants)
('jobkorea.co.kr', 'JobKorea', 'Job Aggregator', 'jobs', 'high', ARRAY['KR'], NULL),
('jobplanet.co.kr', 'JobPlanet', 'Review Platform', 'review', 'high', ARRAY['KR'], NULL),
('saramin.co.kr', 'Saramin', 'Job Aggregator', 'jobs', 'high', ARRAY['KR'], NULL);

