-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260811100056; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- The rebuild in fix_index_scores_null_family_zero recreated the public index
-- MVs, which picked up default privileges (ALL for anon/authenticated). Trim
-- back to SELECT-only, matching the state the lock-down migrations left.
REVOKE ALL ON public.rankings_historical,
              public.rankings_overview,
              public.company_search_index
  FROM anon, authenticated;
GRANT SELECT ON public.rankings_historical,
                public.rankings_overview,
                public.company_search_index
  TO anon, authenticated;
