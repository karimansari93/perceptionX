-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260727153242; this file was
-- back-filled afterwards and therefore post-dates the deployment.

insert into public.company_mention_aliases (company_name, alias, match_type, locale, notes) values
  ('Ford Business Solutions', '\mFBS\M', 'regex', null, 'FBS abbreviation of Ford Business Solutions')
on conflict (lower(company_name), lower(alias)) do nothing;
