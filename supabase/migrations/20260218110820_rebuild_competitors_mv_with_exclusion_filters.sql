-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260218110820; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Rebuild competitors MV with proper exclusion logic matching parseCompetitors/isValidCompetitor
DROP MATERIALIZED VIEW IF EXISTS company_competitors_mv CASCADE;

CREATE MATERIALIZED VIEW company_competitors_mv AS
WITH competitor_mentions AS (
  SELECT
    company_id,
    TRIM(LOWER(unnest(string_to_array(detected_competitors, ',')))) AS competitor_name
  FROM prompt_responses
  WHERE detected_competitors IS NOT NULL
    AND detected_competitors != ''
),
filtered AS (
  SELECT
    company_id,
    competitor_name
  FROM competitor_mentions
  WHERE competitor_name != ''
    AND LENGTH(competitor_name) > 1
    -- Exclude job boards and non-company sites (mirrors EXCLUDED_COMPETITORS in competitorUtils.ts)
    AND competitor_name NOT IN (
      'glassdoor', 'indeed', 'ambitionbox', 'workday', 'linkedin', 'monster',
      'careerbuilder', 'ziprecruiter', 'dice', 'angelist', 'wellfound',
      'builtin', 'stackoverflow', 'github'
    )
    -- Exclude null-like values (mirrors EXCLUDED_WORDS)
    AND competitor_name NOT IN (
      'none', 'n/a', 'na', 'null', 'undefined',
      'none.', 'none,', 'none:', 'none;', 'none)', 'none]', 'none}', 'none-', 'none_',
      'n/a.', 'n/a,', 'n/a:', 'n/a;', 'n/a)', 'n/a]', 'n/a}', 'n/a-', 'n/a_',
      'na.', 'na,', 'na:', 'na;', 'na)', 'na]', 'na}', 'na-', 'na_',
      'null.', 'null,', 'null:', 'null;', 'null)', 'null]', 'null}', 'null-', 'null_',
      'undefined.', 'undefined,', 'undefined:', 'undefined;', 'undefined)', 'undefined]',
      'undefined}', 'undefined-', 'undefined_'
    )
    -- Exclude pure numbers
    AND competitor_name !~ '^[0-9]+$'
    -- Exclude only-special-characters strings
    AND competitor_name ~ '[a-z0-9]'
    -- Exclude single/double letter abbreviations (not real company names)
    AND NOT (LENGTH(competitor_name) <= 2 AND competitor_name ~ '^[a-z]{1,2}$')
)
SELECT
  company_id,
  competitor_name,
  COUNT(*) AS mention_count
FROM filtered
GROUP BY company_id, competitor_name;

CREATE UNIQUE INDEX company_competitors_mv_unique_idx ON company_competitors_mv (company_id, competitor_name);
CREATE INDEX company_competitors_mv_count_idx ON company_competitors_mv (company_id, mention_count DESC);

-- Recreate the RLS-safe view (dropped by CASCADE)
CREATE VIEW company_competitors AS
SELECT c.*
FROM company_competitors_mv c
WHERE EXISTS (
  SELECT 1 FROM company_members cm
  WHERE cm.company_id = c.company_id AND cm.user_id = (SELECT auth.uid())
);

