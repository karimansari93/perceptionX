-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260813042235; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Split the recipient page into three action-led sections instead of two.
-- Forums (Reddit, Quora, Blind) are a different act from social posting: you
-- join an existing conversation rather than publish to your own audience, so
-- they get their own section and their own call to action.

alter table public.activate_routes drop constraint if exists activate_routes_channel_check;
alter table public.activate_routes add constraint activate_routes_channel_check
  check (channel in ('review', 'forum', 'social'));

update public.activate_routes
set channel = 'forum'
where platform in ('reddit', 'quora', 'blind');
