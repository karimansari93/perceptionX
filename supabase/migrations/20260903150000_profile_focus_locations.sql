-- profile_focus_locations
-- ------------------------
-- Users can focus on several locations. One of them is the priority the
-- dashboard opens on (profiles.default_location_context, unchanged); the
-- full ordered list lives in profiles.focus_location_contexts and is pinned
-- at the top of the dashboard's location menu.
--
--   normalize_focus_locations(default, list)  - shared cleanup (trim, dedupe,
--                                               priority always in the list,
--                                               first entry promoted to
--                                               priority when none given)
--   complete_user_onboarding(name, default, list) - replaces the 2-arg version
--   set_focus_locations(default, list)        - Account page edits

alter table public.profiles
  add column if not exists focus_location_contexts text[];

comment on column public.profiles.focus_location_contexts is
  'Ordered list of location buckets (confirmed_prompts.location_context spellings) the user focuses on; pinned in the dashboard location filter. The priority one is default_location_context and is always included. NULL = none.';

create or replace function public.normalize_focus_locations(
  p_default_location_context text,
  p_focus_location_contexts text[],
  out o_default_location_context text,
  out o_focus_location_contexts text[]
)
language plpgsql
immutable
as $$
declare
  v_default text := nullif(btrim(coalesce(p_default_location_context, '')), '');
  v_focus   text[];
begin
  -- Trim, drop blanks and duplicates, keep first-seen order.
  select coalesce(array_agg(x order by ord), '{}'::text[])
    into v_focus
    from (
      select distinct on (x) x, ord
        from (
          select btrim(x) as x, ord
            from unnest(coalesce(p_focus_location_contexts, '{}'::text[])) with ordinality as t(x, ord)
        ) u
       where x <> ''
       order by x, ord
    ) d;

  if v_default is not null and not (v_default = any(v_focus)) then
    v_focus := array_prepend(v_default, v_focus);
  end if;
  if v_default is null and coalesce(array_length(v_focus, 1), 0) > 0 then
    v_default := v_focus[1];
  end if;

  o_default_location_context := v_default;
  o_focus_location_contexts  :=
    case when coalesce(array_length(v_focus, 1), 0) = 0 then null else v_focus end;
end;
$$;

revoke all on function public.normalize_focus_locations(text, text[]) from public, anon, authenticated;

-- The 2-arg overload would make PostgREST calls with two named args ambiguous.
drop function if exists public.complete_user_onboarding(text, text);

create or replace function public.complete_user_onboarding(
  p_full_name text,
  p_default_location_context text default null,
  p_focus_location_contexts text[] default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text := nullif(btrim(p_full_name), '');
  v_loc   text;
  v_focus text[];
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

  select n.o_default_location_context, n.o_focus_location_contexts
    into v_loc, v_focus
    from public.normalize_focus_locations(p_default_location_context, p_focus_location_contexts) n;

  -- The invite flow upserts profiles with only (id, email); guarantee a row.
  insert into public.profiles (id, email)
  select v_uid, u.email from auth.users u where u.id = v_uid
  on conflict (id) do nothing;

  update public.profiles
     set full_name                = v_name,
         default_location_context = v_loc,
         focus_location_contexts  = v_focus,
         onboarding_completed_at  = coalesce(onboarding_completed_at, now()),
         updated_at               = now()
   where id = v_uid
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.complete_user_onboarding(text, text, text[]) from public, anon;
grant execute on function public.complete_user_onboarding(text, text, text[]) to authenticated;

-- Account page: change the locations later without touching the name.
create or replace function public.set_focus_locations(
  p_default_location_context text default null,
  p_focus_location_contexts text[] default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_loc   text;
  v_focus text[];
  v_row   public.profiles;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select n.o_default_location_context, n.o_focus_location_contexts
    into v_loc, v_focus
    from public.normalize_focus_locations(p_default_location_context, p_focus_location_contexts) n;

  update public.profiles
     set default_location_context = v_loc,
         focus_location_contexts  = v_focus,
         updated_at               = now()
   where id = v_uid
  returning * into v_row;

  if v_row.id is null then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke all on function public.set_focus_locations(text, text[]) from public, anon;
grant execute on function public.set_focus_locations(text, text[]) to authenticated;

-- Anyone who already chose a priority gets it as their one focus location.
update public.profiles
   set focus_location_contexts = array[default_location_context]
 where default_location_context is not null
   and focus_location_contexts is null;
