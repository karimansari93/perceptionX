-- Design handoff for the Activate recipient page: branding carries the company
-- domain (logo.dev lookup on the page; initials fallback when absent), and the
-- CSL tokens move to the design's final-intent values. The canvas/ink system
-- derives everything else from primary + accent at runtime.

alter table public.activate_branding add column if not exists logo_domain text;

update public.activate_branding
set primary_color = '#003D6B',
    accent_color = '#00A0A8',
    tagline = 'Global biotech · 32,000 people · 35 countries',
    blurb = 'Two questions, and we''ll show you the platforms AI systems actually read about working here.',
    logo_domain = 'csl.com'
where org_id = 'ebbe52ed-0c8e-4d5b-9526-67496e09c6b4';

-- Same function, org payload gains logo_domain.
create or replace function public.activate_get_by_token(p_token text, p_session_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_link public.activate_links;
  v_branding public.activate_branding;
  v_org public.organizations;
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

  -- One open per pageview session; capped so a scanner can't flood the table.
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

  return jsonb_build_object(
    'org', jsonb_build_object(
      'display_name', coalesce(v_branding.display_name, v_org.name),
      'tagline', v_branding.tagline,
      'blurb', v_branding.blurb,
      'logo_url', coalesce(v_branding.logo_url, v_org.logo_url),
      'logo_domain', v_branding.logo_domain,
      'primary_color', coalesce(v_branding.primary_color, '#13274F'),
      'accent_color', coalesce(v_branding.accent_color, '#F59E0B')
    ),
    'audience', v_link.audience,
    'prefill_market_code', v_link.prefill_market_code,
    'prefill_entity_company_id', v_link.prefill_entity_company_id,
    'entities', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name)
      from public.organization_companies oc
      join public.companies c on c.id = oc.company_id
      where oc.organization_id = v_link.org_id
    ), '[]'::jsonb),
    'routes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'market_code', r.market_code,
        'tier', r.tier,
        'platform', r.platform,
        'destination_url', r.destination_url,
        'write_url', r.write_url,
        'rationale_stat', r.rationale_stat,
        'rank', r.rank,
        'use_direct_link', r.use_direct_link,
        'entity_company_id', r.entity_company_id
      ) order by r.market_code nulls last, r.rank)
      from public.activate_routes r
      where r.org_id = v_link.org_id and r.active
    ), '[]'::jsonb)
  );
end $$;

grant execute on function public.activate_get_by_token(text, uuid) to anon, authenticated;
