-- Step 2 of the per-country gate (see 20261019110000_index_country_status_gate.sql):
-- the rebuilt rankings replace the live ones, after checking they match them
-- row for row. Renames only, as in 20261018240000; the replaced copies stay
-- as *_prev, not refreshed and not public.
--
-- Also opens the job-function rankings to the public site (Karim, 2026-10-19:
-- "open access"): anon SELECT, and refreshed nightly with the rest of the
-- rankings. Only countries with job_functions_published show.

ALTER INDEX public.idx_rankings_overview_industry_country RENAME TO idx_rankings_overview_prev_industry_country;
ALTER INDEX public.idx_rankings_overview_canonical RENAME TO idx_rankings_overview_prev_canonical;
ALTER INDEX public.idx_rankings_job_function_slice RENAME TO idx_rankings_job_function_prev_slice;

ALTER MATERIALIZED VIEW public.company_search_index RENAME TO company_search_index_prev;
ALTER MATERIALIZED VIEW public.rankings_overview RENAME TO rankings_overview_prev;
ALTER MATERIALIZED VIEW public.rankings_job_function RENAME TO rankings_job_function_prev;
ALTER MATERIALIZED VIEW public.rankings_overview_next RENAME TO rankings_overview;
ALTER MATERIALIZED VIEW public.company_search_index_next RENAME TO company_search_index;
ALTER MATERIALIZED VIEW public.rankings_job_function_next RENAME TO rankings_job_function;

ALTER INDEX public.idx_rankings_overview_next_industry_country RENAME TO idx_rankings_overview_industry_country;
ALTER INDEX public.idx_rankings_overview_next_canonical RENAME TO idx_rankings_overview_canonical;
ALTER INDEX public.idx_rankings_job_function_next_slice RENAME TO idx_rankings_job_function_slice;

-- Public by design: the public site reads these anonymously.
GRANT SELECT ON public.rankings_overview, public.company_search_index, public.rankings_job_function TO anon, authenticated;
REVOKE ALL ON public.rankings_overview_prev, public.company_search_index_prev, public.rankings_job_function_prev FROM anon, authenticated;

COMMENT ON MATERIALIZED VIEW public.rankings_overview IS
  'PUBLIC BY DESIGN: read anonymously (anon SELECT via PostgREST) by employers.perceptionx.ai. Revoking anon SELECT breaks the public site with 401s - see docs/PUBLIC_SITE_DB_DEPENDENCIES.md. Each country reads one collection, set by index_country_status.overview_source.';
COMMENT ON MATERIALIZED VIEW public.company_search_index IS
  'PUBLIC BY DESIGN - anon needs SELECT (company search). See docs/public-database-surface.md. best_industry follows the same primary-slice rule as api_company; keep them in step.';
COMMENT ON MATERIALIZED VIEW public.rankings_job_function IS
  'PUBLIC BY DESIGN: read anonymously by the public site (job-function rankings, opened 2026-10-19). Revoking anon SELECT breaks it - see docs/PUBLIC_SITE_DB_DEPENDENCIES.md. Shows only countries with index_country_status.job_functions_published.';
COMMENT ON MATERIALIZED VIEW public.rankings_overview_prev IS
  'Fallback: the public rankings before the per-country gate (replaced 2026-10-19). Not refreshed, not public.';
COMMENT ON MATERIALIZED VIEW public.company_search_index_prev IS
  'Fallback: company search before the per-country gate (replaced 2026-10-19). Not refreshed, not public.';
COMMENT ON MATERIALIZED VIEW public.rankings_job_function_prev IS
  'Fallback: job-function rankings before the per-country gate (replaced 2026-10-19). Not refreshed, not public.';

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

-- The nightly refresh now covers the job-function rankings too.
CREATE OR REPLACE FUNCTION public.refresh_rankings_pipeline()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '600000'
AS $function$
DECLARE
  v_count bigint;
  v_obj   text;
  v_order text[] := ARRAY[
    'mv_industry_stats',
    'mv_company_mentions',
    'rankings_overview',
    'company_search_index',
    'rankings_job_function'
  ];
BEGIN
  FOREACH v_obj IN ARRAY v_order LOOP
    BEGIN
      EXECUTE format('REFRESH MATERIALIZED VIEW public.%I', v_obj);
      EXECUTE format('SELECT count(*) FROM public.%I', v_obj) INTO v_count;
      INSERT INTO public.pipeline_freshness (object, refreshed_at, row_count, detail)
      VALUES (v_obj, now(), v_count, 'refresh_rankings_pipeline')
      ON CONFLICT (object) DO UPDATE
        SET refreshed_at = excluded.refreshed_at,
            row_count    = excluded.row_count,
            detail       = excluded.detail;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.pipeline_freshness (object, refreshed_at, row_count, detail)
      VALUES (v_obj, now(), NULL,
              'refresh FAILED: ' || left(SQLERRM, 300))
      ON CONFLICT (object) DO UPDATE
        SET refreshed_at = excluded.refreshed_at,
            detail       = excluded.detail;
    END;
  END LOOP;
END;
$function$;
