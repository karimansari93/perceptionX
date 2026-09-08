-- Performance advisor follow-up for 20260908120000: wrap auth.uid() in a
-- subselect so RLS evaluates it once per query, and index the two foreign
-- keys on integration_requests.

drop policy if exists announcement_seen_select_own on public.announcement_seen;
create policy announcement_seen_select_own on public.announcement_seen
  for select using ((select auth.uid()) = user_id);

drop policy if exists announcement_seen_insert_own on public.announcement_seen;
create policy announcement_seen_insert_own on public.announcement_seen
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists integration_requests_insert_own on public.integration_requests;
create policy integration_requests_insert_own on public.integration_requests
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists integration_requests_select_admin on public.integration_requests;
create policy integration_requests_select_admin on public.integration_requests
  for select using ((select auth.uid()) = user_id or (select public.is_admin()));

create index if not exists integration_requests_user_idx on public.integration_requests (user_id);
create index if not exists integration_requests_org_idx on public.integration_requests (organization_id);
