-- user_onboarding_default_location
-- ----------------------------------
-- First-login onboarding for invited teammates.
--
-- Invites (invite-team-member) only capture an email, and the /welcome page
-- only sets a password, so 12 of 33 signed-in users have no profiles.full_name
-- and nothing stores which market a user cares about. This migration adds:
--
--   profiles.default_location_context  - the dashboard "location bucket"
--                                        (confirmed_prompts.location_context /
--                                        company_scope_stats_mv.location_context,
--                                        e.g. 'United Kingdom'). NULL = all.
--   profiles.onboarding_completed_at   - NULL means "show the onboarding flow".
--                                        Backfilled for everyone who has already
--                                        signed in, so only never-logged-in
--                                        users see it.
--
--   list_org_location_buckets(p_org_id) - buckets the onboarding picker offers.
--   complete_user_onboarding(name, loc) - saves name + location + timestamp
--                                        for auth.uid() in one call.

alter table public.profiles
  add column if not exists default_location_context text,
  add column if not exists onboarding_completed_at timestamptz;

comment on column public.profiles.default_location_context is
  'Dashboard location bucket (matches confirmed_prompts.location_context) the user chose at onboarding; NULL = all locations.';
comment on column public.profiles.onboarding_completed_at is
  'NULL until the first-login onboarding (name + default location) is completed. Backfilled for users who signed in before the flow existed.';

-- Existing users have already been through the product; do not interrupt them.
update public.profiles p
   set onboarding_completed_at = u.last_sign_in_at
  from auth.users u
 where u.id = p.id
   and u.last_sign_in_at is not null
   and p.onboarding_completed_at is null;

-- Location buckets available to an organization: every location_context that
-- has collected data (company_scope_stats_mv) or configured prompts
-- (confirmed_prompts) across the org's companies. Only org members / platform
-- admins get a non-empty answer.
create or replace function public.list_org_location_buckets(p_org_id uuid)
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

revoke all on function public.list_org_location_buckets(uuid) from public, anon;
grant execute on function public.list_org_location_buckets(uuid) to authenticated;

-- Saves the onboarding answers for the calling user. Name is required;
-- location is optional (NULL = "all locations"). Returns the updated profile
-- row so the client can refresh its cached profile without a second query.
create or replace function public.complete_user_onboarding(
  p_full_name text,
  p_default_location_context text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text := nullif(btrim(p_full_name), '');
  v_loc   text := nullif(btrim(p_default_location_context), '');
  v_row   public.profiles;
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

  -- The invite flow upserts profiles with only (id, email); guarantee a row.
  insert into public.profiles (id, email)
  select v_uid, u.email from auth.users u where u.id = v_uid
  on conflict (id) do nothing;

  update public.profiles
     set full_name                = v_name,
         default_location_context = v_loc,
         onboarding_completed_at  = coalesce(onboarding_completed_at, now()),
         updated_at               = now()
   where id = v_uid
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.complete_user_onboarding(text, text) from public, anon;
grant execute on function public.complete_user_onboarding(text, text) to authenticated;
