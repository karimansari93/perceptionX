-- Publishes the 8 original countries' job-function lists by copying rows, not
-- by recalculating.
--
-- On 2026-10-24 a REFRESH of rankings_job_function covering all 23 countries
-- spilled about 10 GB of temp files and froze the database twice (restarts at
-- 14:47 and 14:59 UTC). The matview recomputes every country from the raw
-- answers in one query, and that no longer fits the instance.
--
-- New shape:
--   rankings_job_function_rows   plain table, not public: one row per company
--                                per slice, filled one country at a time.
--   rankings_job_function        public matview, SELECT * FROM the rows table;
--                                refreshing it is a copy that takes seconds.
--   rankings_job_function_recalc the old recalculating matview, kept for
--                                reference, not public, never refresh it.
--
-- The rows table starts as: the 15 countries already published (from the
-- public matview as it stood) plus the 8 original countries from
-- rankings_job_function_preview, the lists Karim signed off on 2026-10-21,
-- minus TPG (relabelled below the size bar on 2026-10-24).
--
-- Do not refresh rankings_job_function_preview: its definition only covers
-- unpublished countries, so a refresh would empty it.
--
-- Next step (separate migration): a per-country rebuild function that
-- replaces one country's rows in rankings_job_function_rows, run by hand one
-- country at a time after a collection.

-- Step A: the rows table.
CREATE TABLE public.rankings_job_function_rows AS
SELECT canonical_name, website_domain, industry_context, country, job_function,
       mention_count, combinations, all_slice_combinations,
       score_all, score_chatgpt, score_google, score_claude
FROM public.rankings_job_function
UNION ALL
SELECT p.canonical_name, p.website_domain, p.industry_context, p.country, p.job_function,
       p.mention_count, p.combinations, p.all_slice_combinations,
       p.score_all, p.score_chatgpt, p.score_google, p.score_claude
FROM public.rankings_job_function_preview p
WHERE EXISTS (SELECT 1 FROM public.index_country_status s
              WHERE s.country = p.country AND s.job_functions_published)
  AND NOT EXISTS (SELECT 1 FROM public.rankings_job_function j WHERE j.country = p.country)
  AND lower(p.canonical_name) <> 'tpg';

CREATE INDEX idx_rankings_job_function_rows_slice
  ON public.rankings_job_function_rows (country, industry_context, job_function);
ALTER TABLE public.rankings_job_function_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rankings_job_function_rows FROM anon, authenticated;
COMMENT ON TABLE public.rankings_job_function_rows IS
  'Not public. Source rows of rankings_job_function, filled one country at a time. Rebuilding every country in one query froze the database on 2026-10-24.';

-- Step B: swap the public matview to a copy of the rows table.
ALTER MATERIALIZED VIEW public.rankings_job_function RENAME TO rankings_job_function_recalc;
ALTER INDEX public.idx_rankings_job_function_slice RENAME TO idx_rankings_job_function_recalc_slice;
REVOKE ALL ON public.rankings_job_function_recalc FROM anon, authenticated;
COMMENT ON MATERIALIZED VIEW public.rankings_job_function_recalc IS
  'Not public. The old recalculating definition of rankings_job_function, kept for reference. Never refresh it: it recomputes all 23 countries in one query and froze the database on 2026-10-24.';

CREATE MATERIALIZED VIEW public.rankings_job_function AS
SELECT * FROM public.rankings_job_function_rows
WITH DATA;
CREATE INDEX idx_rankings_job_function_slice
  ON public.rankings_job_function (country, industry_context, job_function);
GRANT SELECT ON public.rankings_job_function TO anon, authenticated;
COMMENT ON MATERIALIZED VIEW public.rankings_job_function IS
  'PUBLIC BY DESIGN: read anonymously by the public site (job-function rankings, opened 2026-10-19). Revoking anon SELECT breaks it - see docs/PUBLIC_SITE_DB_DEPENDENCIES.md. A copy of rankings_job_function_rows; refresh is cheap.';

-- The schema's default privileges gave anon and authenticated write grants on
-- the new matview; the site needs SELECT only.
REVOKE ALL ON public.rankings_job_function FROM anon, authenticated;
GRANT SELECT ON public.rankings_job_function TO anon, authenticated;
