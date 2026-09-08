-- What's-new modal + "Set up AI integrations" request form
-- (docs: CHANGES-announcement-and-integrations spec, 2026-09-08).
--
-- announcement_seen: one row per user per announcement version. The modal
-- opens for a signed-in user until a row exists for the current version;
-- shipping the next version (a new string in src/lib/announcements.ts)
-- re-opens it once.
--
-- integration_requests: the "which assistants does your team use?" form.
-- Users insert their own rows; admins read them.

create table if not exists public.announcement_seen (
  user_id  uuid not null references auth.users(id) on delete cascade,
  version  text not null,
  seen_at  timestamptz not null default now(),
  primary key (user_id, version)
);

alter table public.announcement_seen enable row level security;

drop policy if exists announcement_seen_select_own on public.announcement_seen;
create policy announcement_seen_select_own on public.announcement_seen
  for select using (auth.uid() = user_id);

drop policy if exists announcement_seen_insert_own on public.announcement_seen;
create policy announcement_seen_insert_own on public.announcement_seen
  for insert with check (auth.uid() = user_id);

create table if not exists public.integration_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  tools           text[] not null default '{}',
  other           text not null default '',
  note            text not null default '',
  reply_to        text not null,
  created_at      timestamptz not null default now(),
  constraint integration_requests_has_content check (cardinality(tools) > 0 or length(btrim(other)) > 0)
);

create index if not exists integration_requests_created_idx on public.integration_requests (created_at desc);

alter table public.integration_requests enable row level security;

drop policy if exists integration_requests_insert_own on public.integration_requests;
create policy integration_requests_insert_own on public.integration_requests
  for insert with check (auth.uid() = user_id);

drop policy if exists integration_requests_select_admin on public.integration_requests;
create policy integration_requests_select_admin on public.integration_requests
  for select using (auth.uid() = user_id or public.is_admin());
