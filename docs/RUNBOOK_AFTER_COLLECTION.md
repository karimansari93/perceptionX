# After a collection: steps to run by hand

Nothing below runs on a schedule (Karim, 2026-10-21). Client reports and the
Index are collected quarterly, so these steps run once after each collection,
or after a recollection, and at no other time. See
`supabase/migrations/20261021060000_manual_maintenance.sql` for why.

Ground rules for every step:

- One heavy step at a time. Wait for each to finish before starting the next.
- Run heavy steps while Karim is awake: Dubai working hours, roughly 05:00
  to 15:00 UTC (also clear of the US evening peak). Never leave one running
  overnight in Dubai.
- Run long steps as a one-off pg_cron job with its own time limit
  (`SET statement_timeout = '900s'; ...`), then unschedule the job. The
  Supabase MCP gives up after about 60 seconds, and pg_cron's default limit
  is 2 minutes.
- Check the Disk IO budget in the Supabase dashboard (Reports, Database)
  before starting. If it is low, wait for it to refill.
- Quote the cost of any AI step to Karim before it runs (see CLAUDE.md).

## Index (public site)

1. **Names.** Size labels and the duplicate / not-an-employer check for new
   company names: `queue_index_name_review()` (industry answers) or
   `queue_index_name_review_job_functions()` (job-function answers), then
   schedule `index-name-review-tick`
   (`SELECT public.index_name_review_tick();`, every 5 minutes) until the
   batch is collected, then unschedule it. Review the model's merge and
   exclusion suggestions by hand; they are wrong often. Apply them with
   `apply_index_name_review(duplicates, not_employers)`.
2. **Name clean-up.** `SELECT public.sync_index_obvious_variants();` then
   `REFRESH MATERIALIZED VIEW public.rankings_historical;`
3. **Exclusions.** `SELECT public.reconcile_stale_exclusions();`
4. **Job-function rankings, one country at a time.** The public
   `rankings_job_function` is a copy of the table
   `rankings_job_function_rows`. Replace one country's rows at a time (the
   per-country rebuild function is pending; until it exists, the only safe
   route is copying finished rows, as `20261024150000` did), then
   `REFRESH MATERIALIZED VIEW public.rankings_job_function;` (a copy,
   seconds). Never refresh `rankings_job_function_recalc`: it recomputes all
   countries in one query and froze the database twice on 2026-10-24.
5. **Industry rankings.** `SELECT public.refresh_rankings_pipeline();` (2 to 4
   minutes; the public rankings are locked while it runs). Its
   `rankings_job_function` step is now the cheap copy above.
6. **Profiles.** Only when the industry rankings changed:
   `SELECT public.trigger_snapshot_regen();` then, about 20 minutes later,
   `SELECT public.rebuild_slug_aliases();`
7. **New countries.** A country's rankings stay hidden until Karim signs off
   its lists; then update `index_country_status` and repeat steps 4 and 5.

## Client data (dashboards and reports)

1. **Theming** runs through `theme-batch` while items are queued (still
   automatic, idle otherwise).
2. **Dashboard scores.** Run `SELECT public.refresh_metrics_tick();`
   repeatedly until it returns `idle`. It rebuilds five changed companies per
   call. To rebuild the by-location views as well:
   `UPDATE public.mv_refresh_state SET force_refresh = true WHERE mv_name LIKE '%\_by\_location\_mv';`
   then call it again until `idle`.
3. **Recency coverage.** `SELECT public.refresh_organization_recency_coverage();`
4. **Company sizes** (AI cost, quote first):
   `SELECT public.classify_company_size_tick(1000);`
5. **Scraper dead-domain list**, only when scraping:
   `SELECT public.refresh_firecrawl_dead_domains();`
6. **Client name-matching** is off until it reads only the new collection's
   answers instead of the whole database (it froze the database on
   2026-10-21). Do not switch `entity-canonicalization-tick` back on.
