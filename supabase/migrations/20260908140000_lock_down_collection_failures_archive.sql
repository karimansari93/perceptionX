-- Security advisor (rls_disabled_in_public, 2026-09-06):
-- public.prompt_responses_collection_failures was created directly in the
-- database on 2026-09-03 as an archive of collector placeholder rows (no AI
-- Overview returned / fetch failed) moved out of prompt_responses. It was
-- created without RLS and inherited the default anon/authenticated grants, so
-- anyone with the project URL could read, edit, or delete it through the API.
--
-- Nothing in the app or edge functions reads this table; only the service
-- role (which bypasses RLS) needs access. Lock it down the same way as
-- _cron_settings: RLS on, no policies, no grants for API roles.
--
-- Guarded so the migration is a no-op in environments where the ad hoc
-- archive table was never created.

do $$
begin
  if to_regclass('public.prompt_responses_collection_failures') is not null then
    alter table public.prompt_responses_collection_failures enable row level security;
    revoke all on table public.prompt_responses_collection_failures from anon, authenticated;
  end if;
end
$$;
