-- One run of the nightly clean-up over the preview rankings (ran as a one-off
-- pg_cron job), then four group names the suffix rule leaves in machine
-- casing, then the preview views refreshed.
SET statement_timeout='900s';
SELECT public.sync_index_obvious_variants();
SELECT public.index_fold_entry('Cj', 'CJ Group', true);
SELECT public.index_fold_entry('Sk', 'SK Group', true);
SELECT public.index_fold_entry('Nn', 'NN Group', true);
SELECT public.index_fold_entry('Line', 'LY Corp', true);
REFRESH MATERIALIZED VIEW public.rankings_historical;
REFRESH MATERIALIZED VIEW public.rankings_overview_v2;
REFRESH MATERIALIZED VIEW public.company_search_index_v2;
