-- =============================================================================
-- Seed source_canonicals + source_aliases for the obvious global brands.
--
-- This is the "auto-rule first wave" — pre-populating the canonicals + aliases
-- that we know are recurrent in the data, so the next dashboard refresh
-- already collapses 80%+ of source domain variants without an LLM call.
-- =============================================================================

WITH seed(canonical_name, domain_root, source_kind, is_active, aliases) AS (
  VALUES
    -- ============ JOB BOARDS / REVIEW SITES ============
    ('Glassdoor', 'glassdoor.com', 'review', true, ARRAY[
      'glassdoor.com', 'www.glassdoor.com',
      'glassdoor.co.uk', 'glassdoor.ie', 'glassdoor.de', 'glassdoor.fr',
      'glassdoor.com.au', 'glassdoor.ca', 'glassdoor.com.br',
      'glassdoor.com.mx', 'glassdoor.in', 'glassdoor.sg', 'glassdoor.nl',
      'glassdoor.es', 'glassdoor.it', 'glassdoor.com.ar', 'glassdoor.ch',
      'glassdoor.co.nz', 'glassdoor.hk', 'fr.glassdoor.com', 'es.glassdoor.com',
      'de.glassdoor.com', 'it.glassdoor.com'
    ]),
    ('Indeed', 'indeed.com', 'job_board', true, ARRAY[
      'indeed.com', 'www.indeed.com',
      'uk.indeed.com', 'ie.indeed.com', 'de.indeed.com', 'fr.indeed.com',
      'ca.indeed.com', 'au.indeed.com', 'in.indeed.com', 'sg.indeed.com',
      'nl.indeed.com', 'es.indeed.com', 'it.indeed.com', 'jp.indeed.com',
      'mx.indeed.com', 'br.indeed.com', 'pl.indeed.com', 'th.indeed.com',
      'id.indeed.com', 'ph.indeed.com'
    ]),
    ('LinkedIn', 'linkedin.com', 'social', true, ARRAY[
      'linkedin.com', 'www.linkedin.com',
      'uk.linkedin.com', 'de.linkedin.com', 'fr.linkedin.com',
      'ca.linkedin.com', 'au.linkedin.com', 'in.linkedin.com',
      'jp.linkedin.com', 'br.linkedin.com', 'mx.linkedin.com',
      'es.linkedin.com', 'it.linkedin.com', 'nl.linkedin.com',
      'sg.linkedin.com', 'business.linkedin.com'
    ]),
    ('AmbitionBox', 'ambitionbox.com', 'review', true, ARRAY[
      'ambitionbox.com', 'www.ambitionbox.com'
    ]),
    ('Comparably', 'comparably.com', 'review', true, ARRAY[
      'comparably.com', 'www.comparably.com'
    ]),
    ('Kununu', 'kununu.com', 'review', true, ARRAY[
      'kununu.com', 'www.kununu.com'
    ]),
    ('OpenWork', 'en-hyouban.com', 'review', true, ARRAY[
      'en-hyouban.com', 'openwork.jp', 'www.openwork.jp'
    ]),
    ('Blind', 'teamblind.com', 'social', true, ARRAY[
      'teamblind.com', 'www.teamblind.com', 'blind.com'
    ]),
    ('Levels.fyi', 'levels.fyi', 'other', true, ARRAY[
      'levels.fyi', 'www.levels.fyi'
    ]),
    ('Monster', 'monster.com', 'job_board', true, ARRAY[
      'monster.com', 'monster.co.uk', 'monster.de', 'monster.fr',
      'monster.ca', 'monster.com.au', 'monster.com.sg', 'monster.com.hk',
      'monster.com.mx'
    ]),
    ('ZipRecruiter', 'ziprecruiter.com', 'job_board', true, ARRAY[
      'ziprecruiter.com', 'www.ziprecruiter.com'
    ]),
    ('Dice', 'dice.com', 'job_board', true, ARRAY['dice.com', 'www.dice.com']),
    ('Built In', 'builtin.com', 'job_board', true, ARRAY[
      'builtin.com', 'www.builtin.com'
    ]),
    ('Wellfound', 'wellfound.com', 'job_board', true, ARRAY[
      'wellfound.com', 'angel.co', 'angellist.com', 'www.wellfound.com'
    ]),
    ('CareerBuilder', 'careerbuilder.com', 'job_board', true, ARRAY[
      'careerbuilder.com', 'www.careerbuilder.com'
    ]),
    ('SimplyHired', 'simplyhired.com', 'job_board', true, ARRAY[
      'simplyhired.com', 'www.simplyhired.com'
    ]),
    ('Vault', 'vault.com', 'review', true, ARRAY['vault.com', 'firsthand.co']),

    -- ============ SOCIAL / FORUMS ============
    ('Reddit', 'reddit.com', 'social', true, ARRAY[
      'reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com',
      'np.reddit.com'
    ]),
    ('Quora', 'quora.com', 'social', true, ARRAY[
      'quora.com', 'www.quora.com', 'jp.quora.com'
    ]),
    ('YouTube', 'youtube.com', 'social', true, ARRAY[
      'youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com'
    ]),
    ('X (Twitter)', 'x.com', 'social', true, ARRAY[
      'x.com', 'twitter.com', 'www.twitter.com', 'www.x.com', 'mobile.twitter.com'
    ]),
    ('Facebook', 'facebook.com', 'social', true, ARRAY[
      'facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.com'
    ]),
    ('Instagram', 'instagram.com', 'social', true, ARRAY[
      'instagram.com', 'www.instagram.com'
    ]),
    ('TikTok', 'tiktok.com', 'social', true, ARRAY[
      'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com'
    ]),
    ('Threads', 'threads.net', 'social', true, ARRAY[
      'threads.net', 'www.threads.net'
    ]),
    ('Pinterest', 'pinterest.com', 'social', true, ARRAY[
      'pinterest.com', 'www.pinterest.com', 'pin.it'
    ]),
    ('Discord', 'discord.com', 'social', true, ARRAY[
      'discord.com', 'discord.gg', 'discordapp.com'
    ]),
    ('Stack Overflow', 'stackoverflow.com', 'social', true, ARRAY[
      'stackoverflow.com', 'www.stackoverflow.com',
      'stackexchange.com'
    ]),
    ('GitHub', 'github.com', 'social', true, ARRAY[
      'github.com', 'www.github.com', 'gist.github.com'
    ]),
    ('Medium', 'medium.com', 'news', true, ARRAY[
      'medium.com', 'www.medium.com'
    ]),
    ('Substack', 'substack.com', 'news', true, ARRAY[
      'substack.com', 'www.substack.com'
    ]),

    -- ============ NEWS / TRADE PUBLICATIONS ============
    ('Forbes', 'forbes.com', 'news', true, ARRAY[
      'forbes.com', 'www.forbes.com', 'forbes.co.uk', 'forbesindia.com'
    ]),
    ('Bloomberg', 'bloomberg.com', 'news', true, ARRAY[
      'bloomberg.com', 'www.bloomberg.com'
    ]),
    ('Reuters', 'reuters.com', 'news', true, ARRAY[
      'reuters.com', 'www.reuters.com'
    ]),
    ('Business Insider', 'businessinsider.com', 'news', true, ARRAY[
      'businessinsider.com', 'businessinsider.in', 'businessinsider.co.uk',
      'businessinsider.jp', 'www.businessinsider.com'
    ]),
    ('CNBC', 'cnbc.com', 'news', true, ARRAY['cnbc.com', 'www.cnbc.com']),
    ('Fast Company', 'fastcompany.com', 'news', true, ARRAY[
      'fastcompany.com', 'www.fastcompany.com'
    ]),
    ('Wired', 'wired.com', 'news', true, ARRAY[
      'wired.com', 'wired.co.uk', 'wired.jp', 'wired.it'
    ]),
    ('TechCrunch', 'techcrunch.com', 'news', true, ARRAY[
      'techcrunch.com', 'www.techcrunch.com'
    ]),
    ('The Verge', 'theverge.com', 'news', true, ARRAY[
      'theverge.com', 'www.theverge.com'
    ]),
    ('Wall Street Journal', 'wsj.com', 'news', true, ARRAY['wsj.com', 'www.wsj.com']),
    ('New York Times', 'nytimes.com', 'news', true, ARRAY[
      'nytimes.com', 'www.nytimes.com', 'nyt.com'
    ]),
    ('The Guardian', 'theguardian.com', 'news', true, ARRAY[
      'theguardian.com', 'guardian.co.uk', 'www.theguardian.com'
    ]),
    ('BBC', 'bbc.com', 'news', true, ARRAY[
      'bbc.com', 'bbc.co.uk', 'www.bbc.com', 'www.bbc.co.uk'
    ]),
    ('Financial Times', 'ft.com', 'news', true, ARRAY['ft.com', 'www.ft.com']),
    ('NPR', 'npr.org', 'news', true, ARRAY['npr.org', 'www.npr.org']),
    ('Variety', 'variety.com', 'news', true, ARRAY['variety.com', 'www.variety.com']),
    ('Hollywood Reporter', 'hollywoodreporter.com', 'news', true, ARRAY[
      'hollywoodreporter.com', 'www.hollywoodreporter.com'
    ]),
    ('Deadline', 'deadline.com', 'news', true, ARRAY['deadline.com', 'www.deadline.com']),
    ('IndieWire', 'indiewire.com', 'news', true, ARRAY['indiewire.com', 'www.indiewire.com']),
    ('CNN', 'cnn.com', 'news', true, ARRAY['cnn.com', 'edition.cnn.com', 'www.cnn.com']),
    ('Nikkei', 'nikkei.com', 'news', true, ARRAY[
      'nikkei.com', 'asia.nikkei.com', 'www.nikkei.com'
    ]),
    ('Folha', 'folha.uol.com.br', 'news', true, ARRAY[
      'folha.uol.com.br', 'folha.com.br', 'www.folha.uol.com.br'
    ]),
    ('Globo', 'globo.com', 'news', true, ARRAY[
      'globo.com', 'g1.globo.com', 'www.globo.com'
    ]),

    -- ============ ANALYST / CONSULTING ============
    ('Gartner', 'gartner.com', 'other', true, ARRAY['gartner.com', 'www.gartner.com']),
    ('Forrester', 'forrester.com', 'other', true, ARRAY['forrester.com', 'www.forrester.com']),
    ('Crunchbase', 'crunchbase.com', 'other', true, ARRAY['crunchbase.com', 'www.crunchbase.com']),
    ('PitchBook', 'pitchbook.com', 'other', true, ARRAY['pitchbook.com', 'www.pitchbook.com']),
    ('Statista', 'statista.com', 'other', true, ARRAY['statista.com', 'www.statista.com']),
    ('CB Insights', 'cbinsights.com', 'other', true, ARRAY['cbinsights.com', 'www.cbinsights.com']),

    -- ============ AI / SEARCH PLATFORMS (citation sources) ============
    ('Google', 'google.com', 'other', true, ARRAY[
      'google.com', 'www.google.com',
      'google.co.uk', 'google.de', 'google.fr', 'google.es', 'google.it',
      'google.com.au', 'google.ca', 'google.com.br', 'google.com.mx',
      'google.co.in', 'google.com.sg', 'google.co.jp', 'google.com.hk'
    ]),
    ('Wikipedia', 'wikipedia.org', 'other', true, ARRAY[
      'wikipedia.org', 'en.wikipedia.org', 'de.wikipedia.org', 'fr.wikipedia.org',
      'es.wikipedia.org', 'it.wikipedia.org', 'ja.wikipedia.org',
      'pt.wikipedia.org', 'ko.wikipedia.org', 'zh.wikipedia.org',
      'id.wikipedia.org', 'th.wikipedia.org', 'simple.wikipedia.org'
    ]),

    -- ============ EDU / RESEARCH ============
    ('ResearchGate', 'researchgate.net', 'other', true, ARRAY[
      'researchgate.net', 'www.researchgate.net'
    ]),
    ('Coursera', 'coursera.org', 'other', true, ARRAY['coursera.org', 'www.coursera.org']),
    ('Udemy', 'udemy.com', 'other', true, ARRAY['udemy.com', 'www.udemy.com']),
    ('Harvard Business Review', 'hbr.org', 'news', true, ARRAY['hbr.org', 'www.hbr.org']),

    -- ============ INDIAN / SEA TECH MEDIA ============
    ('YourStory', 'yourstory.com', 'news', true, ARRAY['yourstory.com', 'www.yourstory.com']),
    ('Inc42', 'inc42.com', 'news', true, ARRAY['inc42.com', 'www.inc42.com']),
    ('Moneycontrol', 'moneycontrol.com', 'news', true, ARRAY['moneycontrol.com', 'www.moneycontrol.com']),
    ('Tech in Asia', 'techinasia.com', 'news', true, ARRAY['techinasia.com', 'www.techinasia.com']),
    ('e27', 'e27.co', 'news', true, ARRAY['e27.co', 'www.e27.co']),
    ('KrAsia', 'kr-asia.com', 'news', true, ARRAY['kr-asia.com', 'www.kr-asia.com']),

    -- ============ COMPANY-OWNED (kept distinct for "Owned" badge) ============
    ('Netflix (Owned)', 'netflix.com', 'owned', true, ARRAY[
      'netflix.com', 'www.netflix.com', 'about.netflix.com',
      'jobs.netflix.com', 'help.netflix.com',
      'explore.jobs.netflix.net'
    ])
),
inserted_canonicals AS (
  INSERT INTO public.canonical_sources (canonical_name, domain_root, normalized_domain_root, source_kind, is_active)
  SELECT DISTINCT ON (public.normalize_source_domain(s.domain_root))
         s.canonical_name,
         s.domain_root,
         public.normalize_source_domain(s.domain_root),
         s.source_kind,
         s.is_active
  FROM seed s
  ORDER BY public.normalize_source_domain(s.domain_root)
  ON CONFLICT (normalized_domain_root) DO UPDATE
    SET canonical_name = EXCLUDED.canonical_name,
        domain_root    = EXCLUDED.domain_root,
        source_kind    = EXCLUDED.source_kind,
        is_active      = EXCLUDED.is_active
  RETURNING id, normalized_domain_root
),
all_aliases AS (
  SELECT
    ic.id AS canonical_id,
    alias_value,
    public.normalize_source_domain(alias_value) AS norm
  FROM inserted_canonicals ic
  JOIN seed s ON public.normalize_source_domain(s.domain_root) = ic.normalized_domain_root
  CROSS JOIN LATERAL UNNEST(s.aliases) AS alias_value
  WHERE public.normalize_source_domain(alias_value) IS NOT NULL
)
INSERT INTO public.source_aliases (canonical_id, alias_domain, normalized_alias_domain, source, approved_at)
SELECT DISTINCT ON (norm) canonical_id, alias_value, norm, 'auto_rule', now()
FROM all_aliases
ORDER BY norm
ON CONFLICT (normalized_alias_domain) DO UPDATE
  SET canonical_id = EXCLUDED.canonical_id;
