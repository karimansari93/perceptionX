-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260720082958; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Security hardening (part 1 of 2)

-- 1. Dedicated authorization table (roles not stored on a user-editable row)
create table if not exists public.user_roles (
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  primary key (user_id, role)
);

alter table public.user_roles enable row level security;

drop policy if exists user_roles_self_read on public.user_roles;
create policy user_roles_self_read on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()));

insert into public.user_roles (user_id, role)
select id, 'admin' from public.profiles where is_admin = true
on conflict do nothing;

-- 2. is_admin() reads the non-writable roles table (same signature)
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

-- 3. Admin-only grant/revoke helpers (safe path for adding admins)
create or replace function public.grant_admin(target_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can grant admin';
  end if;
  insert into public.user_roles (user_id, role, created_by)
  values (target_user_id, 'admin', auth.uid())
  on conflict do nothing;
end;
$$;

create or replace function public.revoke_admin(target_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can revoke admin';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'Admins cannot revoke their own admin role';
  end if;
  delete from public.user_roles where user_id = target_user_id and role = 'admin';
end;
$$;

revoke all on function public.grant_admin(uuid)  from public, anon;
revoke all on function public.revoke_admin(uuid) from public, anon;
grant execute on function public.grant_admin(uuid)  to authenticated;
grant execute on function public.revoke_admin(uuid) to authenticated;

-- 4. Neutralize the legacy writable column
revoke update (is_admin) on public.profiles from anon, authenticated;

-- 5. Cross-tenant org join fix
drop policy if exists organization_members_insert_policy on public.organization_members;

-- 6. Over-broad profile reads fix
create or replace function public.shares_org_with(target_user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members me
    join public.organization_members them
      on them.organization_id = me.organization_id
    where me.user_id = auth.uid()
      and them.user_id = target_user_id
  );
$$;

drop policy if exists profiles_select_policy on public.profiles;
create policy profiles_select_policy on public.profiles
  for select to public
  using (
    (select auth.uid()) = id
    or public.is_admin()
    or public.shares_org_with(id)
  );

-- 7. Drop world-readable leftover backup tables
drop table if exists public.ai_themes_backup_pilot_20260715;
drop table if exists public.ai_themes_backup_ford_jul_20260715;
drop table if exists public.ai_themes_backup_netflix_jul_20260716;
drop table if exists public.url_recency_cache_pepsico_reclass_backup_2026_07;
drop table if exists public.url_recency_cache_reclass_backup_2026_07;

