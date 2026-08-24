-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260221115601; this file was
-- back-filled afterwards and therefore post-dates the deployment.


CREATE UNIQUE INDEX ON public.rankings_overview(company_name, industry_context, country);
CREATE UNIQUE INDEX ON public.rankings_historical(company_name, index_period, industry_context, country);

