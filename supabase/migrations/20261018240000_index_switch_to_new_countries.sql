-- The public Index switches to the rankings with the 15 new countries
-- (Karim, 2026-10-18: "new countries are approved", after checking the
-- preview built in 20261018190000_index_rankings_preview.sql).
--
-- Renames only. The rankings that were public until now stay as *_legacy, a
-- fallback that can be renamed back; they are no longer refreshed or public.
-- refresh_rankings_pipeline() refreshes by name, so it now refreshes the new
-- views. See docs/PUBLIC_SITE_DB_DEPENDENCIES.md for why the grants matter.

ALTER INDEX public.idx_rankings_overview_industry_country RENAME TO idx_rankings_overview_legacy_industry_country;
ALTER INDEX public.idx_rankings_overview_canonical RENAME TO idx_rankings_overview_legacy_canonical;

ALTER MATERIALIZED VIEW public.company_search_index RENAME TO company_search_index_legacy;
ALTER MATERIALIZED VIEW public.rankings_overview RENAME TO rankings_overview_legacy;
ALTER MATERIALIZED VIEW public.rankings_overview_v2 RENAME TO rankings_overview;
ALTER MATERIALIZED VIEW public.company_search_index_v2 RENAME TO company_search_index;

CREATE INDEX IF NOT EXISTS idx_rankings_overview_industry_country ON public.rankings_overview (industry_context, country);
CREATE INDEX IF NOT EXISTS idx_rankings_overview_canonical ON public.rankings_overview (canonical_name);

-- Public by design: the public site reads these anonymously.
GRANT SELECT ON public.rankings_overview, public.company_search_index TO anon, authenticated;
REVOKE ALL ON public.rankings_overview_legacy, public.company_search_index_legacy FROM anon, authenticated;

COMMENT ON MATERIALIZED VIEW public.rankings_overview IS
  'PUBLIC BY DESIGN: read anonymously (anon SELECT via PostgREST) by employers.perceptionx.ai. Revoking anon SELECT breaks the public site with 401s - see docs/PUBLIC_SITE_DB_DEPENDENCIES.md. Includes the 15 countries added 2026-10-18 (index_responses).';
COMMENT ON MATERIALIZED VIEW public.company_search_index IS
  'PUBLIC BY DESIGN - anon needs SELECT (company search). See docs/public-database-surface.md. best_industry follows the same primary-slice rule as api_company; keep them in step.';
COMMENT ON MATERIALIZED VIEW public.rankings_overview_legacy IS
  'Fallback: the public rankings before the 15 new countries (replaced 2026-10-18). Not refreshed, not public.';
COMMENT ON MATERIALIZED VIEW public.company_search_index_legacy IS
  'Fallback: company search before the 15 new countries (replaced 2026-10-18). Not refreshed, not public.';

-- Views bind to the object, not its name: point these two at the new rankings.
CREATE OR REPLACE VIEW public.index_name_health AS
 WITH ro AS (
         SELECT DISTINCT rankings_overview.canonical_name
           FROM rankings_overview
        ), raw AS (
         SELECT TRIM(BOTH '"'::text FROM TRIM(BOTH FROM unnest(string_to_array(prompt_responses.detected_competitors, ','::text)))) AS raw_name
           FROM prompt_responses
          WHERE prompt_responses.for_index IS TRUE AND prompt_responses.detected_competitors IS NOT NULL AND prompt_responses.tested_at >= (now() - '90 days'::interval)
        ), raw_d AS (
         SELECT DISTINCT raw.raw_name
           FROM raw
          WHERE raw.raw_name <> ''::text
        ), unresolved AS (
         SELECT r.raw_name
           FROM raw_d r
          WHERE NOT (EXISTS ( SELECT 1
                   FROM company_canonical_names n
                  WHERE lower(n.variant_name) = lower(r.raw_name))) AND NOT (EXISTS ( SELECT 1
                   FROM company_canonical_names n
                  WHERE n.canonical_name = r.raw_name))
        )
 SELECT now()::date AS checked_on,
    ( SELECT count(*) AS count
           FROM ro) AS companies_in_index,
    ( SELECT count(*) AS count
           FROM rankings_overview
          WHERE rankings_overview.mention_count = 1) AS single_mention_rows,
    ( SELECT count(*) AS count
           FROM raw_d) AS raw_names_last_90d,
    ( SELECT count(*) AS count
           FROM unresolved) AS raw_names_unresolved,
    round(100.0 * (( SELECT count(*) AS count
           FROM unresolved))::numeric / NULLIF(( SELECT count(*) AS count
           FROM raw_d), 0)::numeric, 1) AS unresolved_pct,
    ( SELECT count(*) AS count
           FROM prompt_responses
          WHERE prompt_responses.for_index IS TRUE AND prompt_responses.index_period IS NULL) AS index_responses_missing_period,
    ( SELECT count(*) AS count
           FROM company_snapshots s
          WHERE NOT (EXISTS ( SELECT 1
                   FROM company_branding b
                  WHERE b.canonical_name = s.canonical_name))) AS snapshots_without_logo;

CREATE OR REPLACE VIEW public.index_visible_names AS
SELECT f, sum(m) AS m
FROM (
  SELECT canonical_name AS f, mention_count AS m FROM public.rankings_overview
  UNION ALL
  SELECT canonical_name, mention_count FROM public.rankings_historical
) x
GROUP BY f;

-- The public site's /api passes countries as codes or names.
CREATE OR REPLACE FUNCTION public.api_db_country(p_country text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE lower(trim(coalesce(p_country, '')))
    WHEN 'us'  THEN 'United States'
    WHEN 'usa' THEN 'United States'
    WHEN 'united states' THEN 'United States'
    WHEN 'gb'  THEN 'United Kingdom'
    WHEN 'uk'  THEN 'United Kingdom'
    WHEN 'united kingdom' THEN 'United Kingdom'
    WHEN 'fr'  THEN 'France'
    WHEN 'france' THEN 'France'
    WHEN 'de'  THEN 'Germany'
    WHEN 'germany' THEN 'Germany'
    WHEN 'br'  THEN 'Brazil'
    WHEN 'brazil' THEN 'Brazil'
    WHEN 'cn'  THEN 'China'
    WHEN 'china' THEN 'China'
    WHEN 'in'  THEN 'India'
    WHEN 'india' THEN 'India'
    WHEN 'ae'  THEN 'United Arab Emirates'
    WHEN 'uae' THEN 'United Arab Emirates'
    WHEN 'united arab emirates' THEN 'United Arab Emirates'
    WHEN 'au'  THEN 'Australia'
    WHEN 'australia' THEN 'Australia'
    WHEN 'ca'  THEN 'Canada'
    WHEN 'canada' THEN 'Canada'
    WHEN 'dk'  THEN 'Denmark'
    WHEN 'denmark' THEN 'Denmark'
    WHEN 'ie'  THEN 'Ireland'
    WHEN 'ireland' THEN 'Ireland'
    WHEN 'it'  THEN 'Italy'
    WHEN 'italy' THEN 'Italy'
    WHEN 'jp'  THEN 'Japan'
    WHEN 'japan' THEN 'Japan'
    WHEN 'mx'  THEN 'Mexico'
    WHEN 'mexico' THEN 'Mexico'
    WHEN 'nl'  THEN 'Netherlands'
    WHEN 'netherlands' THEN 'Netherlands'
    WHEN 'no'  THEN 'Norway'
    WHEN 'norway' THEN 'Norway'
    WHEN 'sa'  THEN 'Saudi Arabia'
    WHEN 'ksa' THEN 'Saudi Arabia'
    WHEN 'saudi arabia' THEN 'Saudi Arabia'
    WHEN 'sg'  THEN 'Singapore'
    WHEN 'singapore' THEN 'Singapore'
    WHEN 'kr'  THEN 'South Korea'
    WHEN 'south korea' THEN 'South Korea'
    WHEN 'es'  THEN 'Spain'
    WHEN 'spain' THEN 'Spain'
    WHEN 'se'  THEN 'Sweden'
    WHEN 'sweden' THEN 'Sweden'
    WHEN 'ch'  THEN 'Switzerland'
    WHEN 'switzerland' THEN 'Switzerland'
    ELSE NULL
  END;
$function$;

-- With 23 countries the refresh takes 2-3 minutes, past the 2-minute
-- statement timeout pg_cron jobs run under (a SET inside the function does
-- not extend it). The nightly maintenance sets its own, as the name sync does.
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'rankings-maintenance-daily'),
  command := $$SET statement_timeout = '900s'; SELECT public.run_rankings_maintenance();$$
);
