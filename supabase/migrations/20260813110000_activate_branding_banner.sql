-- Optional campaign banner for the recipient page, shown at the top of the
-- welcome screen above the company avatar (e.g. a "Ready Set Ford" lockup).
-- Set per org in Admin -> Activate -> Branding. Any aspect ratio is accepted;
-- a wide strip (roughly 6:1) fills the column with no letterboxing, and the
-- image is rendered in a rounded card so client artwork carrying its own
-- background colour sits cleanly on the brand canvas.
--
-- The full activate_get_by_token body is restated here (the function is
-- replaced wholesale on every change) with banner_url added to the org payload.

alter table public.activate_branding add column if not exists banner_url text;

create or replace function public.activate_get_by_token(p_token text, p_session_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_link public.activate_links;
  v_branding public.activate_branding;
  v_org public.organizations;
  v_entities jsonb;
begin
  select * into v_link from public.activate_links where token = p_token;

  if v_link.id is null then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_link.revoked_at is not null then
    return jsonb_build_object('error', 'revoked');
  end if;
  if v_link.expires_at < now() then
    return jsonb_build_object('error', 'expired');
  end if;

  select * into v_org from public.organizations where id = v_link.org_id;
  select * into v_branding from public.activate_branding where org_id = v_link.org_id;

  if p_session_id is not null
     and not exists (
       select 1 from public.activate_link_events
       where link_id = v_link.id and session_id = p_session_id and event_type = 'open'
     )
     and (select count(*) from public.activate_link_events
          where link_id = v_link.id and occurred_at > now() - interval '1 hour') < 5000
  then
    insert into public.activate_link_events (link_id, session_id, event_type)
    values (v_link.id, p_session_id, 'open');
  end if;

  with ent as (
    select c.id, c.name
    from public.organization_companies oc
    join public.companies c on c.id = oc.company_id
    where oc.organization_id = v_link.org_id
  ),
  em as (
    select distinct on (e.name, amm.market_code)
           e.name, amm.market_code, e.id
    from ent e
    join public.confirmed_prompts cp on cp.company_id = e.id
    join public.activate_market_map amm
      on amm.org_id = v_link.org_id and amm.location_context = cp.location_context
    order by e.name, amm.market_code, e.id
  )
  select coalesce(jsonb_agg(row order by row->>'name'), '[]'::jsonb)
    into v_entities
  from (
    select jsonb_build_object(
             'id', (array_agg(e.id order by e.id))[1],
             'name', e.name,
             'markets', coalesce(
               (select jsonb_object_agg(em.market_code, em.id) from em where em.name = e.name),
               '{}'::jsonb)
           ) as row
    from ent e
    group by e.name
  ) x;

  return jsonb_build_object(
    'org', jsonb_build_object(
      'display_name', coalesce(v_branding.display_name, v_org.name),
      'tagline', v_branding.tagline,
      'blurb', v_branding.blurb,
      'logo_url', coalesce(v_branding.logo_url, v_org.logo_url),
      'logo_domain', v_branding.logo_domain,
      'banner_url', v_branding.banner_url,
      'primary_color', coalesce(v_branding.primary_color, '#13274F'),
      'accent_color', coalesce(v_branding.accent_color, '#F59E0B')
    ),
    'audience', v_link.audience,
    'prefill_market_code', v_link.prefill_market_code,
    'prefill_entity_company_id', v_link.prefill_entity_company_id,
    'entities', v_entities,
    'routes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'market_code', r.market_code,
        'tier', r.tier,
        'channel', r.channel,
        'platform', r.platform,
        'destination_url', r.destination_url,
        'write_url', r.write_url,
        'rationale_stat', r.rationale_stat,
        'fit_note', r.fit_note,
        'is_local', r.is_local,
        'audience_functions', r.audience_functions,
        'audience_seniority', r.audience_seniority,
        'rank', r.rank,
        'use_direct_link', r.use_direct_link,
        'entity_company_id', r.entity_company_id
      ) order by r.market_code nulls last, r.rank)
      from public.activate_routes r
      where r.org_id = v_link.org_id and r.active
    ), '[]'::jsonb),
    'highlights', coalesce((
      select jsonb_agg(jsonb_build_object(
        'market_code', h.market_code,
        'platform', h.platform,
        'url', h.url,
        'label', h.label,
        'citations', h.citations,
        'rank', h.rank
      ) order by h.rank)
      from public.activate_route_highlights h
      where h.org_id = v_link.org_id
    ), '[]'::jsonb),
    'themes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'market_code', t.market_code,
        'theme', t.theme,
        'detail', t.detail,
        'rank', t.rank
      ) order by t.rank)
      from public.activate_market_themes t
      where t.org_id = v_link.org_id
    ), '[]'::jsonb)
  );
end $$;

grant execute on function public.activate_get_by_token(text, uuid) to anon, authenticated;
