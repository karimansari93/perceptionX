-- Supabase security advisor, 25 Oct 2026: rls_disabled_in_public.
-- These backup and scratch tables were created without RLS, so the public
-- anon key could read and delete them. Nothing in the app or edge functions
-- reads them. Enabling RLS with no policies leaves them readable only by the
-- service role (SQL editor, edge functions); revoking grants is belt and braces.
do $$
declare
  t text;
begin
  foreach t in array array[
    'backup_20261023_gofundme_prompts',
    'backup_20261023_gofundme_responses',
    'backup_20261023_gofundme_companies',
    'backup_20261023_gofundme_company_industries',
    'company_canonical_names_backup_20261018',
    'company_canonical_names_backup_20261018b',
    'company_canonical_names_backup_20261018c',
    'company_canonical_names_backup_20261021',
    'company_overrides_backup_20261018',
    'company_overrides_backup_20261021',
    'company_employee_tiers_backup_20261018',
    'company_employee_tiers_backup_20261021',
    'tmp_ddl_probe'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- Internal-only functions that anyone with the anon key could call.
-- Not used by the app or edge functions; the service role keeps access.
revoke execute on function public.collection_run_summary(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.collection_alerts_tick() from public, anon, authenticated;
