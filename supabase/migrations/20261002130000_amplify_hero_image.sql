-- Amplify hero photo: a full-bleed photo of the client's people behind the top
-- of the recipient page, toned into the brand colours (duotone) so any photo
-- sits on any primary and the computed ink colour keeps its contrast.
-- Set per org in Admin -> Amplify -> Branding.
--
-- activate_get_by_token is restated from its live definition (the function is
-- replaced wholesale on every change) with hero_image_url added to the org
-- payload. Nothing else in it changes.

alter table public.activate_branding add column if not exists hero_image_url text;

comment on column public.activate_branding.hero_image_url is
  'Optional hero photo behind the top of the Amplify page, rendered duotone in the brand colours.';

create or replace function public.activate_get_by_token(p_token text, p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_link public.activate_links; v_branding public.activate_branding;
  v_org public.organizations; v_entities jsonb;
  v_entity_names text[];
begin
  -- Single uniform failure: unknown, revoked and expired are one answer.
  select * into v_link from public.activate_links
  where token = p_token and revoked_at is null and (expires_at is null or expires_at > now());
  if v_link.id is null then return jsonb_build_object('error','not_found'); end if;

  select * into v_org from public.organizations where id = v_link.org_id;
  select * into v_branding from public.activate_branding where org_id = v_link.org_id;
  select entity_names into v_entity_names
  from public.activate_org_settings where org_id = v_link.org_id;
  if p_session_id is not null
     and not exists (select 1 from public.activate_link_events
       where link_id = v_link.id and session_id = p_session_id and event_type = 'open')
     and (select count(*) from public.activate_link_events
          where link_id = v_link.id and occurred_at > now() - interval '1 hour') < 5000
  then insert into public.activate_link_events (link_id, session_id, event_type)
       values (v_link.id, p_session_id, 'open'); end if;
  with ent as (
    select c.id, c.name from public.organization_companies oc
    join public.companies c on c.id = oc.company_id
    where oc.organization_id = v_link.org_id
      and (v_entity_names is null or c.name = any(v_entity_names))),
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
      'hero_image_url', v_branding.hero_image_url,
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
        join public.companies c
          on c.id = cp.company_id
        where cp.is_active and coalesce(trim(cp.job_function_context),'') <> ''
          and (v_entity_names is null or c.name = any(v_entity_names))
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
end $function$;

grant execute on function public.activate_get_by_token(text, uuid) to anon, authenticated;
