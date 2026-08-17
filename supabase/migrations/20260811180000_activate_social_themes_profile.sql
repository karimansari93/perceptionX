-- Activate demo-stage extensions (ideation build; screen-share demos only):
--
-- 1. Routes gain a channel: 'review' (the measured tiered mechanic) vs
--    'social' (where AI reads the public conversation). Review routing stays
--    market × entity ONLY — the baseline measured that function does not move
--    the review-platform mix. Social affinity, by contrast, is demographic:
--    audience_functions / audience_seniority rank the social section for the
--    declared profile (null = relevant to everyone). fit_note is the card's
--    sub-line for social rows (rationale_stat stays tier-1 review only).
-- 2. activate_market_themes: the themes that carry the most weight in AI's
--    picture of the employer (market_code null = portfolio-wide). Shown as
--    topic *visibility*, never as sentiment direction — measurement, not
--    scripting.
-- 3. Recipients can optionally declare job function + seniority (a third,
--    skippable step): stored on events like the other declarations.
-- 4. DEMO MODE: DE/CH routes flipped active so screen demos can show the
--    kununu story. Re-gate (active=false) before any real distribution —
--    kununu consolidation + client works-council review remain prerequisites.
--    The consent gate still blocks real link minting.
-- 5. Reddit ships as a social route for the demo. The spec's Reddit exclusion
--    concerned the review mechanic; strategy for real distribution stays open.

alter table public.activate_routes
  add column if not exists channel text not null default 'review'
    check (channel in ('review', 'social')),
  add column if not exists audience_functions text[],
  add column if not exists audience_seniority text[],
  add column if not exists fit_note text;

create table public.activate_market_themes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  market_code text check (market_code ~ '^[A-Z]{2}$'),  -- null = portfolio-wide
  theme text not null,
  detail text,
  rank smallint not null default 1
);

create unique index activate_market_themes_identity_key on public.activate_market_themes (
  org_id, coalesce(market_code, '--'), theme
);

alter table public.activate_market_themes enable row level security;
create policy activate_market_themes_admin_all on public.activate_market_themes
  for all using (is_admin()) with check (is_admin());

alter table public.activate_link_events
  add column if not exists declared_function text,
  add column if not exists declared_seniority text;

alter table public.activate_link_events drop constraint activate_link_events_event_type_check;
alter table public.activate_link_events add constraint activate_link_events_event_type_check
  check (event_type in ('open', 'market_declared', 'entity_declared', 'profile_declared', 'platform_click'));

------------------------------------------------------------------------------
-- Token RPCs: routes gain channel/affinity/fit_note, payload gains themes,
-- log accepts the optional profile declaration.
------------------------------------------------------------------------------

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
        'channel', r.channel,
        'platform', r.platform,
        'destination_url', r.destination_url,
        'write_url', r.write_url,
        'rationale_stat', r.rationale_stat,
        'fit_note', r.fit_note,
        'audience_functions', r.audience_functions,
        'audience_seniority', r.audience_seniority,
        'rank', r.rank,
        'use_direct_link', r.use_direct_link,
        'entity_company_id', r.entity_company_id
      ) order by r.market_code nulls last, r.rank)
      from public.activate_routes r
      where r.org_id = v_link.org_id and r.active
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

drop function if exists public.activate_log_event(text, uuid, text, text, uuid, text, int);

create or replace function public.activate_log_event(
  p_token text,
  p_session_id uuid,
  p_event_type text,
  p_market_code text default null,
  p_entity_company_id uuid default null,
  p_platform text default null,
  p_tier int default null,
  p_function text default null,
  p_seniority text default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_link public.activate_links;
begin
  select * into v_link from public.activate_links where token = p_token;

  if v_link.id is null then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_link.revoked_at is not null or v_link.expires_at < now() then
    return jsonb_build_object('error', 'link_closed');
  end if;
  if p_session_id is null
     or p_event_type not in ('market_declared', 'entity_declared', 'profile_declared', 'platform_click') then
    return jsonb_build_object('error', 'invalid_event');
  end if;
  if p_market_code is not null and p_market_code !~ '^[A-Z]{2}$' then
    return jsonb_build_object('error', 'invalid_market');
  end if;
  if p_event_type = 'platform_click' and coalesce(trim(p_platform), '') = '' then
    return jsonb_build_object('error', 'missing_platform');
  end if;
  if length(coalesce(p_function, '')) > 60 or length(coalesce(p_seniority, '')) > 60 then
    return jsonb_build_object('error', 'invalid_profile');
  end if;

  if (select count(*) from public.activate_link_events
      where link_id = v_link.id and session_id = p_session_id) >= 200
     or (select count(*) from public.activate_link_events
         where link_id = v_link.id and occurred_at > now() - interval '1 hour') >= 5000
  then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  insert into public.activate_link_events
    (link_id, session_id, event_type, declared_market_code, declared_entity_id,
     platform, tier, declared_function, declared_seniority)
  values
    (v_link.id, p_session_id, p_event_type, p_market_code, p_entity_company_id,
     nullif(trim(p_platform), ''), p_tier,
     nullif(trim(p_function), ''), nullif(trim(p_seniority), ''));

  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.activate_log_event(text, uuid, text, text, uuid, text, int, text, text)
  to anon, authenticated;

------------------------------------------------------------------------------
-- Seeds (CSL) + demo-mode flip
------------------------------------------------------------------------------

do $$
declare
  v_org uuid := 'ebbe52ed-0c8e-4d5b-9526-67496e09c6b4';
begin
  if not exists (select 1 from public.organizations where id = v_org) then
    raise notice 'CSL org % not found; skipping', v_org;
    return;
  end if;

  -- Social routes: global (tier 3, market null), entity-agnostic. Affinity
  -- arrays rank the section for a declared profile; null = everyone.
  insert into public.activate_routes
    (org_id, entity_company_id, market_code, tier, channel, platform, destination_url,
     fit_note, audience_functions, audience_seniority, rank, active, use_direct_link)
  values
    (v_org, null, null, 3, 'social', 'linkedin', 'https://www.linkedin.com',
     'Public posts from people at a company shape how AI describes it.',
     null, array['mid-level','senior','executive'], 1, true, false),
    (v_org, null, null, 3, 'social', 'reddit', 'https://www.reddit.com',
     'Where engineers and technical candidates compare employers.',
     array['engineering-tech'], null, 2, true, false),
    (v_org, null, null, 3, 'social', 'instagram', 'https://www.instagram.com',
     'Everyday culture content AI increasingly reads.',
     null, array['early-career'], 3, true, false),
    (v_org, null, null, 3, 'social', 'tiktok', 'https://www.tiktok.com',
     'Where younger candidates ask what jobs are really like.',
     null, array['early-career'], 4, true, false)
  on conflict (org_id, coalesce(market_code, '--'), platform,
               coalesce(entity_company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set
    channel = excluded.channel,
    destination_url = excluded.destination_url,
    fit_note = excluded.fit_note,
    audience_functions = excluded.audience_functions,
    audience_seniority = excluded.audience_seniority,
    rank = excluded.rank,
    use_direct_link = excluded.use_direct_link;

  -- Portfolio-wide theme weights from the Q3 2026 baseline (drag-attribute
  -- composition shares). Topic visibility only — no sentiment direction.
  insert into public.activate_market_themes (org_id, market_code, theme, detail, rank)
  values
    (v_org, null, 'Company Culture', 'the single heaviest theme in AI''s picture', 1),
    (v_org, null, 'Leadership', null, 2),
    (v_org, null, 'Job Security', null, 3),
    (v_org, null, 'Wellbeing & Balance', null, 4),
    (v_org, null, 'Career Opportunities', null, 5)
  on conflict (org_id, coalesce(market_code, '--'), theme) do nothing;

  -- DEMO MODE: light up DE/CH for screen demos. Re-gate before any real send.
  update public.activate_routes
  set active = true
  where org_id = v_org and market_code in ('DE', 'CH') and not active;
end $$;
