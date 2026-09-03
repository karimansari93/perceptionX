-- profile_default_company
-- -----------------------
-- First-login setup asks "What do you want to focus on first?": one
-- subsidiary (company/brand) and one country. The dashboard lands there.
-- Multi-brand organizations (Ford / Ford Credit / Ford Business Solutions /
-- Lincoln …) need the company as well as the country: without it everyone
-- lands on the org's first brand.
--
-- The stored company is one row of the chosen brand (the one whose country
-- matches the chosen location, else the brand's first row); the app's brand
-- scope merges same-name siblings anyway.
--
--   profiles.default_company_id                        - new, FK companies
--   list_org_location_buckets(org, company_ids)        - optional brand filter
--   complete_user_onboarding(name, location, company)  - replaces 2-arg version
--   set_dashboard_focus(location, company)             - Account page edits

alter table public.profiles
  add column if not exists default_company_id uuid references public.companies(id) on delete set null;

comment on column public.profiles.default_company_id is
  'Company row the dashboard opens on at login (a representative row of the subsidiary chosen at first-login setup). NULL = the app''s usual first-brand heuristic.';

create index if not exists profiles_default_company_id_idx
  on public.profiles (default_company_id)
  where default_company_id is not null;

-- Only companies the user can reach through an organization membership may
-- be stored; anything else silently becomes NULL (no preference).
create or replace function public.accessible_default_company(p_user_id uuid, p_company_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select oc.company_id
    from public.organization_companies oc
    join public.organization_members m on m.organization_id = oc.organization_id
   where oc.company_id = p_company_id
     and m.user_id = p_user_id
   limit 1;
$$;

revoke all on function public.accessible_default_company(uuid, uuid) from public, anon, authenticated;

-- Location buckets, optionally restricted to some of the org's companies
-- (the rows of one subsidiary).
drop function if exists public.list_org_location_buckets(uuid);

create or replace function public.list_org_location_buckets(
  p_org_id uuid,
  p_company_ids uuid[] default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with org_companies as (
    select oc.company_id
      from public.organization_companies oc
     where oc.organization_id = p_org_id
       and (p_company_ids is null or oc.company_id = any (p_company_ids))
       and (public.is_org_member(p_org_id) or public.is_admin())
  ),
  buckets as (
    select t.location_context
      from public.company_scope_stats_mv t
      join org_companies c on c.company_id = t.company_id
     where t.location_context is not null and t.location_context <> ''
    union
    select cp.location_context
      from public.confirmed_prompts cp
      join org_companies c on c.company_id = cp.company_id
     where cp.is_active
       and cp.location_context is not null and cp.location_context <> ''
  )
  select coalesce(jsonb_agg(location_context order by location_context), '[]'::jsonb)
    from buckets;
$$;

revoke all on function public.list_org_location_buckets(uuid, uuid[]) from public, anon;
grant execute on function public.list_org_location_buckets(uuid, uuid[]) to authenticated;

-- The 2-arg overload would make PostgREST calls with two named args ambiguous.
drop function if exists public.complete_user_onboarding(text, text);

create or replace function public.complete_user_onboarding(
  p_full_name text,
  p_default_location_context text default null,
  p_default_company_id uuid default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text := nullif(btrim(p_full_name), '');
  v_loc     text := nullif(btrim(coalesce(p_default_location_context, '')), '');
  v_company uuid;
  v_row     public.profiles;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if v_name is null then
    raise exception 'full_name is required' using errcode = '22023';
  end if;
  if length(v_name) > 120 then
    raise exception 'full_name is too long (max 120 characters)' using errcode = '22023';
  end if;

  v_company := public.accessible_default_company(v_uid, p_default_company_id);

  -- The invite flow upserts profiles with only (id, email); guarantee a row.
  insert into public.profiles (id, email)
  select v_uid, u.email from auth.users u where u.id = v_uid
  on conflict (id) do nothing;

  update public.profiles
     set full_name                = v_name,
         default_location_context = v_loc,
         default_company_id       = v_company,
         onboarding_completed_at  = coalesce(onboarding_completed_at, now()),
         updated_at               = now()
   where id = v_uid
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.complete_user_onboarding(text, text, uuid) from public, anon;
grant execute on function public.complete_user_onboarding(text, text, uuid) to authenticated;

-- Account page: change the focus later without touching the name.
create or replace function public.set_dashboard_focus(
  p_default_location_context text default null,
  p_default_company_id uuid default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_loc     text := nullif(btrim(coalesce(p_default_location_context, '')), '');
  v_company uuid;
  v_row     public.profiles;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  v_company := public.accessible_default_company(v_uid, p_default_company_id);

  update public.profiles
     set default_location_context = v_loc,
         default_company_id       = v_company,
         updated_at               = now()
   where id = v_uid
  returning * into v_row;

  if v_row.id is null then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke all on function public.set_dashboard_focus(text, uuid) from public, anon;
grant execute on function public.set_dashboard_focus(text, uuid) to authenticated;
