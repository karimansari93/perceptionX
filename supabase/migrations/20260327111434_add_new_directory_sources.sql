-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260327111434; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Insert 33 new directory sources identified from citation data analysis
INSERT INTO directory_sources (domain, name, source_type, category, description, actionability, country_focus) VALUES

-- Review Platforms
('clutch.co', 'Clutch', 'Review Platform', 'review', 'B2B ratings and reviews platform. Cited frequently for tech and professional services employers.', 'high', ARRAY['US', 'Global']),
('g2.com', 'G2', 'Review Platform', 'review', 'Software and company reviews. Strong signal for tech employers — candidates research culture alongside product.', 'high', ARRAY['US', 'Global']),
('inhersight.com', 'InHerSight', 'Review Platform', 'review', 'Workplace reviews focused on women''s experience. Key DEI signal in AI responses.', 'high', ARRAY['US']),
('repvue.com', 'RepVue', 'Review Platform', 'review', 'Sales team and compensation reviews. Sales-function specific employer signal.', 'high', ARRAY['US', 'Global']),
('topworkplaces.com', 'Top Workplaces', 'Rankings & Lists', 'rankings', 'Regional and national workplace certification and rankings by Energage.', 'high', ARRAY['US']),

-- Job Aggregators / Boards
('ziprecruiter.com', 'ZipRecruiter', 'Job Aggregator', 'jobs', 'Job aggregator with employer profiles. Broad citation across 37 companies and 3 AI models.', 'high', ARRAY['US']),
('himalayas.app', 'Himalayas', 'Job Aggregator', 'jobs', 'Remote-first job board with detailed employer profiles and culture data.', 'high', ARRAY['Global']),
('greenhouse.com', 'Greenhouse', 'Job Aggregator', 'jobs', 'ATS platform whose public job listings are frequently cited by AI when describing open roles and hiring processes.', 'high', ARRAY['US', 'Global']),
('unstop.com', 'Unstop', 'Job Aggregator', 'jobs', 'India campus hiring and competitions platform. Key source for India market employer perception.', 'high', ARRAY['IN']),
('nofluffjobs.com', 'No Fluff Jobs', 'Job Aggregator', 'jobs', 'Poland-focused tech job board with transparent salary listings. Cited by 4 AI models for Poland market.', 'high', ARRAY['PL']),

-- Rankings & Lists
('fortune.com', 'Fortune', 'Rankings & Lists', 'rankings', '100 Best Companies to Work For and other employer rankings. Cited by all 5 AI models across 30 companies.', 'medium', ARRAY['US', 'Global']),
('4dayweek.io', '4 Day Week', 'Rankings & Lists', 'rankings', 'Certified employer directory for companies offering a 4-day work week. Niche but consistently cited by AI.', 'high', ARRAY['Global']),
('time.com', 'TIME', 'Rankings & Lists', 'rankings', 'TIME World''s Best Companies and 100 Best rankings. Cited across 15 companies by 4 AI models.', 'medium', ARRAY['US', 'Global']),
('mercer.com', 'Mercer', 'Rankings & Lists', 'rankings', 'Global HR consulting firm. Compensation surveys and workforce research cited as employer signals.', 'medium', ARRAY['Global']),

-- Business News & Media
('cnbc.com', 'CNBC', 'Business News', 'news', 'Business news with employer coverage. Cited across 23 companies by 4 AI models.', 'medium', ARRAY['US', 'Global']),
('bloomberg.com', 'Bloomberg', 'Business News', 'news', 'Financial and business news. Employer coverage cited across 22 companies by 4 models.', 'medium', ARRAY['US', 'Global']),
('wsj.com', 'Wall Street Journal', 'Business News', 'news', 'Business and employer coverage. Cited across 16 companies by 3 models.', 'medium', ARRAY['US', 'Global']),
('fastcompany.com', 'Fast Company', 'Business Media', 'news', 'Innovation and workplace culture media. Best Workplaces for Innovators list. 22 companies, 4 models.', 'medium', ARRAY['US', 'Global']),
('techcrunch.com', 'TechCrunch', 'Business News', 'news', 'Tech industry news. Employer brand signal for tech companies. Cited by all 5 models across 21 companies.', 'medium', ARRAY['US', 'Global']),
('nytimes.com', 'New York Times', 'Business News', 'news', 'Broad editorial coverage including employer and workplace stories.', 'medium', ARRAY['US', 'Global']),
('peoplemanagingpeople.com', 'People Managing People', 'Business Media', 'news', 'HR and management editorial. Publishes employer brand and workplace culture content.', 'medium', ARRAY['Global']),
('newsletter.pragmaticengineer.com', 'The Pragmatic Engineer', 'Business Media', 'news', 'High-influence engineering industry newsletter. Strong signal for tech employer perception among engineers.', 'medium', ARRAY['Global']),
('deel.com', 'Deel', 'Business Media', 'news', 'Global HR platform that publishes employer guides and compensation benchmarks. Cited as content source across 28 companies.', 'medium', ARRAY['Global']),

-- Social Media
('facebook.com', 'Facebook', 'Social Media', 'social', 'Company pages and employer content. Cited across 29 companies by 3 models.', 'high', ARRAY['Global']),
('tiktok.com', 'TikTok', 'Social Media', 'social', 'Employer brand and culture content. Growing AI citation signal. 14 companies, 2 models — will grow.', 'high', ARRAY['Global']),

-- Compensation & Transparency
('candor.co', 'Candor', 'Compensation Data', 'compensation', 'Salary and culture transparency platform. Cited across 19 companies by 4 models.', 'medium', ARRAY['US']),

-- Interview Prep (these are where candidates form perceptions)
('tryexponent.com', 'Exponent', 'Interview Prep', 'community', 'Interview prep platform with company-specific guides. Shapes candidate perception pre-application.', 'medium', ARRAY['US', 'Global']),
('igotanoffer.com', 'IGotAnOffer', 'Interview Prep', 'community', 'Interview guides and company reviews. Cited across 19 companies by 3 models.', 'medium', ARRAY['US', 'Global']),
('interviewquery.com', 'Interview Query', 'Interview Prep', 'community', 'Data and analytics interview prep with company profiles. 21 companies, 4 models.', 'medium', ARRAY['US', 'Global']),

-- PR & Reference
('prnewswire.com', 'PR Newswire', 'PR Wire', 'reference', 'Press release distribution. Companies own this content — AI cites press releases as employer signals across 33 companies.', 'high', ARRAY['US', 'Global']),
('statista.com', 'Statista', 'Reference', 'reference', 'Data and statistics platform. Employer rankings and workforce data cited across 22 companies.', 'low', ARRAY['Global']),
('deloitte.com', 'Deloitte', 'Business Media', 'news', 'Consulting and research. Workforce and workplace studies cited across 22 companies by 4 models.', 'low', ARRAY['Global']),
('mckinsey.com', 'McKinsey', 'Business Media', 'news', 'Management consulting research and thought leadership. Cited across 24 companies by 4 models.', 'low', ARRAY['Global']);

