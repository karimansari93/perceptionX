-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260327084144; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Add actionability score: how much can a company actually influence this source?
ALTER TABLE directory_sources
  ADD COLUMN IF NOT EXISTS actionability text CHECK (actionability IN ('high', 'medium', 'low')),
  ADD COLUMN IF NOT EXISTS parent_domain text; -- for grouping TLD variants (e.g. glassdoor.co.uk → glassdoor.com)

COMMENT ON COLUMN directory_sources.actionability IS 'high = company can directly manage/publish (Glassdoor, LinkedIn); medium = company can influence indirectly (Reddit, Medium, news coverage); low = ambient content, no direct lever (Wikipedia, university pages, blogging platforms)';
COMMENT ON COLUMN directory_sources.parent_domain IS 'Root domain this source rolls up to, for grouping regional TLD variants. Null if this IS the parent.';

-- Backfill actionability for existing 23 sources
UPDATE directory_sources SET actionability = 'high' WHERE domain IN (
  'glassdoor.com', 'linkedin.com', 'indeed.com', 'comparably.com', 
  'greatplacetowork.com', 'builtin.com', 'wellfound.com', 'universumglobal.com',
  'ambitionbox.com', 'kununu.com', 'openwork.jp', 'instagram.com', 'youtube.com'
);

UPDATE directory_sources SET actionability = 'medium' WHERE domain IN (
  'teamblind.com', 'reddit.com', 'quora.com', 'medium.com', 
  'hbr.org', 'forbes.com', 'businessinsider.com', 'reuters.com',
  'levels.fyi', 'jointaro.com', 'rankings.statista.com', 'exame.com'
);

UPDATE directory_sources SET actionability = 'low' WHERE domain IN (
  'en.wikipedia.org', 'note.com', 'brunch.co.kr', 'blog.naver.com',
  'www.seedtable.com', 'www.f6s.com', 'gartner.com'
);

