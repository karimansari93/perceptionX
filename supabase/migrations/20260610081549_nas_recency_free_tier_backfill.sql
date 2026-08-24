-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260610081549; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Backfill url_recency_cache for NAS-cited URLs using the two deterministic
-- free tiers from extract-recency-scores (url-pattern, evergreen), replicated
-- exactly. Does not touch rows that already have a recency_score.

CREATE OR REPLACE FUNCTION pg_temp.px_safe_date(y int, m int, d int) RETURNS date AS $$
BEGIN
  RETURN make_date(y, m, d);
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION pg_temp.px_recency_score(pub date) RETURNS int AS $$
DECLARE diff int;
BEGIN
  IF pub IS NULL THEN RETURN NULL; END IF;
  diff := current_date - pub;
  IF diff < 0 THEN RETURN 100; END IF;
  IF diff <= 30 THEN RETURN 100; END IF;
  IF diff <= 90 THEN RETURN 90; END IF;
  IF diff <= 180 THEN RETURN 80; END IF;
  IF diff <= 365 THEN RETURN 70; END IF;
  IF diff <= 730 THEN RETURN 50; END IF;
  IF diff <= 1095 THEN RETURN 30; END IF;
  IF diff <= 1825 THEN RETURN 20; END IF;
  IF diff <= 3650 THEN RETURN 10; END IF;
  RETURN 0;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- extractDateFromUrl replicated: pattern priority p1..p5, year validated 1990-2050,
-- invalid year falls through to next pattern.
CREATE OR REPLACE FUNCTION pg_temp.px_url_date(u text) RETURNS date AS $$
DECLARE m text[]; y int; mo int; dd int; r date;
BEGIN
  -- p1: YYYY[/-]MM[/-]DD
  m := regexp_match(u, '(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})');
  IF m IS NOT NULL THEN
    y := m[1]::int;
    IF y BETWEEN 1990 AND 2050 THEN
      r := pg_temp.px_safe_date(y, m[2]::int, m[3]::int);
      IF r IS NOT NULL THEN RETURN r; END IF;
    END IF;
  END IF;
  -- p2: YYYY[/-]MM followed by / or end
  m := regexp_match(u, '(\d{4})[/\-](\d{1,2})(?:/|$)');
  IF m IS NOT NULL THEN
    y := m[1]::int;
    IF y BETWEEN 1990 AND 2050 THEN
      r := pg_temp.px_safe_date(y, m[2]::int, 1);
      IF r IS NOT NULL THEN RETURN r; END IF;
    END IF;
  END IF;
  -- p3: bare YYYY followed by / or end
  m := regexp_match(u, '(\d{4})(?:/|$)');
  IF m IS NOT NULL THEN
    y := m[1]::int;
    IF y BETWEEN 1990 AND 2050 THEN
      RETURN make_date(y, 1, 1);
    END IF;
  END IF;
  -- p4: full month name DD, YYYY
  m := regexp_match(u, '(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})', 'i');
  IF m IS NOT NULL THEN
    y := m[3]::int;
    IF y BETWEEN 1990 AND 2050 THEN
      mo := CASE lower(m[1]) WHEN 'january' THEN 1 WHEN 'february' THEN 2 WHEN 'march' THEN 3 WHEN 'april' THEN 4 WHEN 'may' THEN 5 WHEN 'june' THEN 6 WHEN 'july' THEN 7 WHEN 'august' THEN 8 WHEN 'september' THEN 9 WHEN 'october' THEN 10 WHEN 'november' THEN 11 WHEN 'december' THEN 12 END;
      r := pg_temp.px_safe_date(y, mo, m[2]::int);
      IF r IS NOT NULL THEN RETURN r; END IF;
    END IF;
  END IF;
  -- p5: abbreviated month name DD, YYYY
  m := regexp_match(u, '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2}),?\s+(\d{4})', 'i');
  IF m IS NOT NULL THEN
    y := m[3]::int;
    IF y BETWEEN 1990 AND 2050 THEN
      mo := CASE lower(m[1]) WHEN 'jan' THEN 1 WHEN 'feb' THEN 2 WHEN 'mar' THEN 3 WHEN 'apr' THEN 4 WHEN 'may' THEN 5 WHEN 'jun' THEN 6 WHEN 'jul' THEN 7 WHEN 'aug' THEN 8 WHEN 'sep' THEN 9 WHEN 'oct' THEN 10 WHEN 'nov' THEN 11 WHEN 'dec' THEN 12 END;
      r := pg_temp.px_safe_date(y, mo, m[2]::int);
      IF r IS NOT NULL THEN RETURN r; END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- isEvergreenUrl replicated
CREATE OR REPLACE FUNCTION pg_temp.px_is_evergreen(u text) RETURNS boolean AS $$
DECLARE host text; path text; q text; segs text[]; s text;
BEGIN
  host := lower(regexp_replace(substring(u from '^[a-zA-Z][a-zA-Z0-9+.\-]*://([^/:?#]+)'), '^www\.', ''));
  IF host IS NULL THEN RETURN false; END IF;
  path := lower(coalesce(substring(u from '^[a-zA-Z][a-zA-Z0-9+.\-]*://[^/?#]+([^?#]*)'), ''));
  path := regexp_replace(path, '/+$', '');
  q := coalesce(substring(u from '\?([^#]*)'), '');

  IF path = '' OR path = '/' THEN RETURN true; END IF;
  IF path ~* '\.pdf(\?|$)' OR q ~* '\.pdf(\?|$)' THEN RETURN true; END IF;

  IF host = ANY(ARRAY['boards.greenhouse.io','job-boards.greenhouse.io','jobs.lever.co','jobs.ashbyhq.com','apply.workable.com','recruiterbox.com','breezy.hr','smartrecruiters.com','myworkdayjobs.com'])
     OR host LIKE '%.boards.greenhouse.io' OR host LIKE '%.job-boards.greenhouse.io' OR host LIKE '%.jobs.lever.co' OR host LIKE '%.jobs.ashbyhq.com' OR host LIKE '%.apply.workable.com' OR host LIKE '%.recruiterbox.com' OR host LIKE '%.breezy.hr' OR host LIKE '%.smartrecruiters.com' OR host LIKE '%.myworkdayjobs.com'
  THEN RETURN true; END IF;
  IF host ~ '(^|\.)myworkdayjobs\.com$' THEN RETURN true; END IF;

  IF host LIKE '%linkedin.com' AND path ~ '^/jobs(/|$)' THEN RETURN true; END IF;
  IF host LIKE '%linkedin.com' AND path ~ '^/company/[^/]+/?$' THEN RETURN true; END IF;
  IF host LIKE '%indeed.com' AND path ~ '^/(viewjob|jobs|cmp)(/|$)' THEN RETURN true; END IF;

  IF host ~ '(^|\.)glassdoor\.[a-z]{2,3}(\.[a-z]{2})?$'
     AND path ~* '^/(überblick|uberblick|overview|jobs|reviews|salary|salaries|salarios|salaires|gehalt|gehälter|stipendi|beneficios|benefits|benefícios|interview|interviews|entrevista|entrevistas|empleos|empleo|empresas|arbeiten-bei)(/|$)'
  THEN RETURN true; END IF;

  IF host ~ '(^|\.)twitter\.com$' AND (path = '' OR path ~ '^/[^/]+/?$') THEN RETURN true; END IF;
  IF host ~ '(^|\.)x\.com$' AND (path = '' OR path ~ '^/[^/]+/?$') THEN RETURN true; END IF;

  segs := string_to_array(trim(both '/' from path), '/');
  IF array_length(segs, 1) >= 1 THEN
    s := segs[1];
    IF s = ANY(ARRAY[
      'about','about-us','aboutus','company','our-company','who-we-are','team','teams','leadership','people',
      'mission','values','our-story','story','culture','careers','career','jobs','job','positions','openings',
      'vacancies','opportunities','work-with-us','join-us','join','pricing','plans','products','product','features','solutions',
      'contact','contact-us','support','help','investors','press','media','newsroom','finance','financing','credit',
      'responsibilities','responsibility','sustainability','esg','corporate','corporate-info','overview',
      'benefits','rewards','compensation','perks',
      'karriere','karriär','karriere-bei-uns','arbeit','arbeitgeber',
      'empleo','empleos','empleo-y-carrera','trabajo','trabajos','ofertas',
      'carriere','carrière','carrieres','carrières','recrutement',
      'lavoro','lavora-con-noi','opportunita',
      'trabalhe-conosco','carreiras','vagas',
      'unternehmen','firma','wer-wir-sind','über-uns','uber-uns',
      'nachhaltigkeit','duurzaamheid','soziales-engagement'])
    THEN RETURN true; END IF;
    IF s ~ '^(about|experience|our|nuestra|nossa|chez)[-_]' THEN RETURN true; END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(segs) seg WHERE seg = ANY(ARRAY['jobs','careers','job','positions','openings'])) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- NAS-cited URLs needing scores
WITH nas_urls AS (
  SELECT DISTINCT (cit->>'url') AS url
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
  JOIN companies c ON c.id = cp.company_id AND length(c.name) >= 3,
  jsonb_array_elements(pr.citations) AS cit
  WHERE c.name = 'Netflix Animation Studios'
    AND jsonb_typeof(pr.citations) = 'array'
    AND (cit->>'url') IS NOT NULL AND (cit->>'url') <> ''
),
unscored AS (
  SELECT nu.url FROM nas_urls nu
  WHERE NOT EXISTS (
    SELECT 1 FROM url_recency_cache urc
    WHERE urc.url = nu.url AND urc.recency_score IS NOT NULL
  )
),
resolved AS (
  SELECT url,
    pg_temp.px_url_date(url) AS pub_date,
    pg_temp.px_is_evergreen(url) AS evergreen,
    coalesce(substring(url from '^[a-zA-Z][a-zA-Z0-9+.\-]*://([^/:?#]+)'), 'unknown') AS domain
  FROM unscored
)
INSERT INTO url_recency_cache (url, domain, publication_date, recency_score, extraction_method, last_checked_at)
SELECT url, domain,
  CASE WHEN pub_date IS NOT NULL THEN pub_date ELSE NULL END,
  CASE WHEN pub_date IS NOT NULL THEN pg_temp.px_recency_score(pub_date) ELSE 100 END,
  CASE WHEN pub_date IS NOT NULL THEN 'url-pattern' ELSE 'evergreen' END,
  now()
FROM resolved
WHERE pub_date IS NOT NULL OR evergreen
ON CONFLICT (url) DO UPDATE SET
  publication_date = EXCLUDED.publication_date,
  recency_score = EXCLUDED.recency_score,
  extraction_method = EXCLUDED.extraction_method,
  last_checked_at = EXCLUDED.last_checked_at
WHERE url_recency_cache.recency_score IS NULL;
