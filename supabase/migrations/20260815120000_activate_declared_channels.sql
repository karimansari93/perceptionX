-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260815124500; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- "What are you up for?" — the recipient picks which kinds of contribution
-- they're open to (review / forum / social), and the payoff page shows only
-- those. Skipping shows everything.
--
-- Worth storing: the share of people willing to leave a review at all is a
-- more honest read on appetite than click counts, and it costs one column.
alter table public.activate_link_events
  add column if not exists declared_channels text[];

create or replace function public.activate_log_event(
  p_token text,
  p_session_id uuid,
  p_event_type text,
  p_market_code text default null,
  p_entity_company_id uuid default null,
  p_platform text default null,
  p_tier int default null,
  p_function text default null,
  p_seniority text default null,
  p_channels text[] default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_link public.activate_links;
begin
  select * into v_link from public.activate_links where token = p_token;

  if v_link.id is null then return jsonb_build_object('error','not_found'); end if;
  if v_link.revoked_at is not null or v_link.expires_at < now() then
    return jsonb_build_object('error','link_closed');
  end if;
  if p_session_id is null
     or p_event_type not in ('market_declared','entity_declared','profile_declared','platform_click') then
    return jsonb_build_object('error','invalid_event');
  end if;
  if p_market_code is not null and p_market_code !~ '^[A-Z]{2}$' then
    return jsonb_build_object('error','invalid_market');
  end if;
  if p_event_type = 'platform_click' and coalesce(trim(p_platform),'') = '' then
    return jsonb_build_object('error','missing_platform');
  end if;
  if length(coalesce(p_function,'')) > 60 or length(coalesce(p_seniority,'')) > 60 then
    return jsonb_build_object('error','invalid_profile');
  end if;
  if p_channels is not null and (
       array_length(p_channels, 1) > 3
       or exists (select 1 from unnest(p_channels) c where c not in ('review','forum','social'))
     ) then
    return jsonb_build_object('error','invalid_channels');
  end if;

  if (select count(*) from public.activate_link_events
      where link_id = v_link.id and session_id = p_session_id) >= 200
     or (select count(*) from public.activate_link_events
         where link_id = v_link.id and occurred_at > now() - interval '1 hour') >= 5000
  then
    return jsonb_build_object('error','rate_limited');
  end if;

  insert into public.activate_link_events
    (link_id, session_id, event_type, declared_market_code, declared_entity_id,
     platform, tier, declared_function, declared_seniority, declared_channels)
  values
    (v_link.id, p_session_id, p_event_type, p_market_code, p_entity_company_id,
     nullif(trim(p_platform),''), p_tier,
     nullif(trim(p_function),''), nullif(trim(p_seniority),''), p_channels);

  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.activate_log_event(text, uuid, text, text, uuid, text, int, text, text, text[])
  to anon, authenticated;
