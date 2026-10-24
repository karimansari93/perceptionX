-- member_quarterly_digest
-- -----------------------
-- Quarterly update email, admin side. Each organization member can be put
-- on the send list, and an admin can set the member's dashboard focus (the
-- brand and the location selection) on their behalf. The email reads the
-- same two profile columns the dashboard reads, so "what a member sees" and
-- "what a member is emailed" are one setting.
--
--   organization_members.quarterly_digest           - on the send list
--   admin_set_member_focus(member, company, loc, on) - admin edits, one call

alter table public.organization_members
  add column if not exists quarterly_digest boolean not null default false;

comment on column public.organization_members.quarterly_digest is
  'On the quarterly update email send list for this organization. Scope of the email = the member''s profile focus (default_company_id + default_location_context).';

-- Admin-only: set a member's send-list flag and dashboard focus in one call.
-- The focus is written exactly as the Account page writes it for oneself:
-- the profile columns (durable, what the email reads) plus the session copy
-- in auth user metadata (what the dashboard applies on first paint), so the
-- member's own dashboard picks the change up on their next session refresh.
create or replace function public.admin_set_member_focus(
  p_member_id uuid,
  p_default_company_id uuid default null,
  p_default_location_context text default null,
  p_quarterly_digest boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member  public.organization_members;
  v_loc     text := nullif(btrim(coalesce(p_default_location_context, '')), '');
  v_company uuid;
  v_name    text;
  v_profile public.profiles;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_member from public.organization_members where id = p_member_id;
  if v_member.id is null then
    raise exception 'member not found' using errcode = 'P0002';
  end if;

  -- Only a company the member can reach through their org memberships may
  -- be stored; anything else becomes NULL (no preference), as for self-edits.
  v_company := public.accessible_default_company(v_member.user_id, p_default_company_id);
  select c.name into v_name from public.companies c where c.id = v_company;

  if p_quarterly_digest is not null then
    update public.organization_members
       set quarterly_digest = p_quarterly_digest
     where id = p_member_id
    returning * into v_member;
  end if;

  -- The invite flow upserts profiles with only (id, email); guarantee a row.
  insert into public.profiles (id, email)
  select u.id, u.email from auth.users u where u.id = v_member.user_id
  on conflict (id) do nothing;

  update public.profiles
     set default_location_context = v_loc,
         default_company_id       = v_company,
         updated_at               = now()
   where id = v_member.user_id
  returning * into v_profile;

  update auth.users
     set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
       || jsonb_build_object(
            'default_location_context', v_loc,
            'default_company_id',       v_company,
            'default_company_name',     v_name
          )
   where id = v_member.user_id;

  return jsonb_build_object(
    'member_id',                v_member.id,
    'user_id',                  v_member.user_id,
    'quarterly_digest',         v_member.quarterly_digest,
    'default_company_id',       v_profile.default_company_id,
    'default_location_context', v_profile.default_location_context
  );
end;
$$;

revoke all on function public.admin_set_member_focus(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.admin_set_member_focus(uuid, uuid, text, boolean) to authenticated;
