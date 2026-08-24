-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260817110615; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Activate: one indistinguishable failure for every bad token.
-- See supabase/migrations/20260817140000_activate_uniform_token_errors.sql

create or replace function public.activate_get_by_token(p_token text, p_session_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_link public.activate_links; v_branding public.activate_branding;
  v_org public.organizations; v_entities jsonb;
begin
  -- Single uniform failure: unknown, revoked and expired are one answer.
  select * into v_link from public.activate_links
  where token = p_token and revoked_at is null and expires_at > now();
  if v_link.id is null then return jsonb_build_object('error','not_found'); end if;

  select * into v_org from public.organizations where id = v_link.org_id;
  select * into v_branding from public.activate_branding where org_id = v_link.org_id;
  if p_session_id is not null
     and not exists (select 1 from public.activate_link_events
       where link_id = v_link.id and session_id = p_session_id and event_type = 'open')
     and (select count(*) from public.activate_link_events
          where link_id = v_link.id and occurred_at > now() - interval '1 hour') < 5000
  then insert into public.activate_link_events (link_id, session_id, event_type)
       values (v_link.id, p_session_id, 'open'); end if;
  with ent as (
    select c.id, c.name from public.organization_companies oc
    join public.companies c on c.id = oc.company_id where oc.organization_id = v_link.org_id),
  em as (select distinct on (e.name, amm.market_code) e.name, amm.market_code, e.id
    from ent e join public.confirmed_prompts cp on cp.company_id = e.id
    join public.activate_market_map amm on amm.org_id = v_link.org_id
      and amm.location_context = cp.location_context
    order by e.name, amm.market_code, e.id)
  select coalesce(jsonb_agg(row order by row->>'name'), '[]'::jsonb) into v_entities
  from (select jsonb_build_object('id',(array_agg(e.id order by e.id))[1],'name',e.name,
          'markets', coalesce((select jsonb_object_agg(em.market_code, em.id) from em where em.name = e.name),'{}'::jsonb)) as row
        from ent e group by e.name) x;
  return jsonb_build_object(
    'org', jsonb_build_object(
      'display_name', coalesce(v_branding.display_name, v_org.name),
      'tagline', v_branding.tagline, 'blurb', v_branding.blurb,
      'logo_url', coalesce(v_branding.logo_url, v_org.logo_url),
      'logo_domain', v_branding.logo_domain, 'banner_url', v_branding.banner_url,
      'heading_font', v_branding.heading_font, 'body_font', v_branding.body_font,
      'heading_font_url', v_branding.heading_font_url, 'body_font_url', v_branding.body_font_url,
      'primary_color', coalesce(v_branding.primary_color,'#13274F'),
      'accent_color', coalesce(v_branding.accent_color,'#F59E0B')),
    'audience', v_link.audience,
    'prefill_market_code', v_link.prefill_market_code,
    'prefill_entity_company_id', v_link.prefill_entity_company_id,
    'entities', v_entities,
    'job_functions', coalesce((
      select jsonb_agg(f.job_function_context order by f.n desc)
      from (
        select cp.job_function_context, count(*) n
        from public.confirmed_prompts cp
        join public.organization_companies oc
          on oc.company_id = cp.company_id and oc.organization_id = v_link.org_id
        where cp.is_active and coalesce(trim(cp.job_function_context),'') <> ''
        group by 1 order by 2 desc limit 24
      ) f), '[]'::jsonb),
    'coverage', coalesce((select jsonb_object_agg(mc.market_code, mc.people_pct)
      from public.activate_market_coverage mc where mc.org_id = v_link.org_id), '{}'::jsonb),
    'routes', coalesce((select jsonb_agg(jsonb_build_object(
        'market_code', r.market_code,'tier', r.tier,'channel', r.channel,'platform', r.platform,
        'destination_url', r.destination_url,'write_url', r.write_url,
        'rationale_stat', r.rationale_stat,'fit_note', r.fit_note,'is_local', r.is_local,
        'action_label', r.action_label,'is_listen_only', r.is_listen_only,
        'audience_functions', r.audience_functions,'audience_seniority', r.audience_seniority,
        'rank', r.rank,'use_direct_link', r.use_direct_link,'entity_company_id', r.entity_company_id)
      order by r.market_code nulls last, r.rank)
      from public.activate_routes r where r.org_id = v_link.org_id and r.active), '[]'::jsonb),
    'highlights', coalesce((select jsonb_agg(jsonb_build_object(
        'market_code', h.market_code,'platform', h.platform,'url', h.url,
        'label', h.label,'citations', h.citations,'rank', h.rank) order by h.rank)
      from public.activate_route_highlights h where h.org_id = v_link.org_id), '[]'::jsonb),
    'themes', coalesce((select jsonb_agg(jsonb_build_object(
        'market_code', t.market_code,'theme', t.theme,'detail', t.detail,'rank', t.rank) order by t.rank)
      from public.activate_market_themes t where t.org_id = v_link.org_id), '[]'::jsonb));
end $$;

grant execute on function public.activate_get_by_token(text, uuid) to anon, authenticated;

create or replace function public.activate_log_event(
  p_token text, p_session_id uuid, p_event_type text,
  p_market_code text default null, p_entity_company_id uuid default null,
  p_platform text default null, p_tier integer default null,
  p_function text default null, p_seniority text default null,
  p_channels text[] default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_link public.activate_links;
begin
  select * into v_link from public.activate_links
  where token = p_token and revoked_at is null and expires_at > now();
  if v_link.id is null then return jsonb_build_object('error','not_found'); end if;

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

grant execute on function public.activate_log_event(
  text, uuid, text, text, uuid, text, integer, text, text, text[]
) to anon, authenticated;

create or replace function public.activate_log_event(
  p_token text, p_session_id uuid, p_event_type text,
  p_market_code text default null, p_entity_company_id uuid default null,
  p_platform text default null, p_tier integer default null,
  p_function text default null, p_seniority text default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_link public.activate_links;
begin
  select * into v_link from public.activate_links
  where token = p_token and revoked_at is null and expires_at > now();
  if v_link.id is null then return jsonb_build_object('error','not_found'); end if;

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

  if (select count(*) from public.activate_link_events
      where link_id = v_link.id and session_id = p_session_id) >= 200
     or (select count(*) from public.activate_link_events
         where link_id = v_link.id and occurred_at > now() - interval '1 hour') >= 5000
  then
    return jsonb_build_object('error','rate_limited');
  end if;

  insert into public.activate_link_events
    (link_id, session_id, event_type, declared_market_code, declared_entity_id,
     platform, tier, declared_function, declared_seniority)
  values
    (v_link.id, p_session_id, p_event_type, p_market_code, p_entity_company_id,
     nullif(trim(p_platform),''), p_tier,
     nullif(trim(p_function),''), nullif(trim(p_seniority),''));

  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.activate_log_event(
  text, uuid, text, text, uuid, text, integer, text, text
) to anon, authenticated;
