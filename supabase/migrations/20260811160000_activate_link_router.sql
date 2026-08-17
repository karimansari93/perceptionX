-- Activate link router: tokenized public links that route employees/candidates
-- to the review platforms feeding AI answers in their declared market.
-- Spec: docs/ACTIVATE_LINK_ROUTER.md
--
-- Access model mirrors conversational intake: anon has NO table access; the
-- public page goes through the SECURITY DEFINER token RPCs below. Admins get
-- full access via is_admin() RLS.
--
-- Naming: org = the client (organizations), entity = a division (companies).

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------

create table public.activate_org_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  -- Consent gate: no link is mintable while this is null.
  consent_confirmed_at timestamptz,
  consent_confirmed_by uuid references auth.users(id),
  consent_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.activate_branding (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  display_name text not null,
  tagline text,
  blurb text,
  logo_url text,
  -- The two tokens the whole page's identity derives from.
  primary_color text not null default '#13274F',
  accent_color text not null default '#F59E0B',
  updated_at timestamptz not null default now()
);

create table public.activate_routes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- Entity-specific route; null = entity-agnostic for that market.
  entity_company_id uuid references public.companies(id) on delete cascade,
  -- ISO 3166-1 alpha-2. NULL means tier-3 global default (check below).
  market_code text check (market_code ~ '^[A-Z]{2}$'),
  tier smallint not null check (tier in (1, 2, 3)),
  platform text not null,
  destination_url text not null,
  -- Where a person actually posts, when it differs. Resolved manually per
  -- platform — never constructed by URL pattern.
  write_url text,
  -- Measured prose shown to the recipient. Tier 1 only: tier 2/3 must never
  -- display another market's statistic.
  rationale_stat text,
  rank smallint not null default 1,
  active boolean not null default true,
  -- true = bare URL + rel="noreferrer" on the anchor (Glassdoor/Indeed, which
  -- monitor review surges arriving from a single referrer). Click attribution
  -- is client-side on our page either way.
  use_direct_link boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activate_routes_tier3_is_global check ((tier = 3) = (market_code is null)),
  constraint activate_routes_rationale_tier1_only check (rationale_stat is null or tier = 1)
);

-- One route per org × market × platform × entity (nulls collapsed) so seeds
-- can upsert idempotently.
create unique index activate_routes_identity_key on public.activate_routes (
  org_id,
  coalesce(market_code, '--'),
  platform,
  coalesce(entity_company_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

create index activate_routes_org_active_idx on public.activate_routes (org_id) where active;

create table public.activate_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  token text unique not null,
  -- Cohort-level label ("DE plasma ops"), encouraged over per-person labels.
  label text not null,
  audience text check (audience in ('employee', 'candidate', 'alumni')),
  prefill_market_code text check (prefill_market_code ~ '^[A-Z]{2}$'),
  prefill_entity_company_id uuid references public.companies(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days',
  revoked_at timestamptz
);

create index activate_links_org_idx on public.activate_links (org_id);

create table public.activate_link_events (
  id bigint generated always as identity primary key,
  link_id uuid not null references public.activate_links(id) on delete cascade,
  -- Random client-generated UUID per pageview: identifies a pageview, not a
  -- person. The only key that ties a click to the declaration before it.
  session_id uuid not null,
  event_type text not null
    check (event_type in ('open', 'market_declared', 'entity_declared', 'platform_click')),
  declared_market_code text check (declared_market_code ~ '^[A-Z]{2}$'),
  declared_entity_id uuid,
  platform text,
  tier smallint,
  occurred_at timestamptz not null default now()
);

create index activate_link_events_link_time_idx on public.activate_link_events (link_id, occurred_at desc);
create index activate_link_events_link_session_idx on public.activate_link_events (link_id, session_id);

-- ISO market code ↔ confirmed_prompts.location_context, per org. Not consulted
-- at runtime; exists so cohort measurement can join without string-matching.
create table public.activate_market_map (
  org_id uuid not null references public.organizations(id) on delete cascade,
  market_code text not null check (market_code ~ '^[A-Z]{2}$'),
  location_context text not null,
  primary key (org_id, market_code, location_context)
);

------------------------------------------------------------------------------
-- RLS: admin everything, anon nothing (token RPCs are the only public door)
------------------------------------------------------------------------------

alter table public.activate_org_settings enable row level security;
alter table public.activate_branding enable row level security;
alter table public.activate_routes enable row level security;
alter table public.activate_links enable row level security;
alter table public.activate_link_events enable row level security;
alter table public.activate_market_map enable row level security;

create policy activate_org_settings_admin_all on public.activate_org_settings
  for all using (is_admin()) with check (is_admin());
create policy activate_branding_admin_all on public.activate_branding
  for all using (is_admin()) with check (is_admin());
create policy activate_routes_admin_all on public.activate_routes
  for all using (is_admin()) with check (is_admin());
create policy activate_links_admin_all on public.activate_links
  for all using (is_admin()) with check (is_admin());
create policy activate_link_events_admin_all on public.activate_link_events
  for all using (is_admin()) with check (is_admin());
create policy activate_market_map_admin_all on public.activate_market_map
  for all using (is_admin()) with check (is_admin());

create trigger activate_org_settings_touch
  before update on public.activate_org_settings
  for each row execute function public.intake_touch_updated_at();
create trigger activate_branding_touch
  before update on public.activate_branding
  for each row execute function public.intake_touch_updated_at();
create trigger activate_routes_touch
  before update on public.activate_routes
  for each row execute function public.intake_touch_updated_at();

------------------------------------------------------------------------------
-- Recipient: load the page config by token. Logs one 'open' per session.
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

------------------------------------------------------------------------------
-- Recipient: record a declaration or a platform click. 'open' is only ever
-- logged by activate_get_by_token.
------------------------------------------------------------------------------

create or replace function public.activate_log_event(
  p_token text,
  p_session_id uuid,
  p_event_type text,
  p_market_code text default null,
  p_entity_company_id uuid default null,
  p_platform text default null,
  p_tier int default null
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
     or p_event_type not in ('market_declared', 'entity_declared', 'platform_click') then
    return jsonb_build_object('error', 'invalid_event');
  end if;
  if p_market_code is not null and p_market_code !~ '^[A-Z]{2}$' then
    return jsonb_build_object('error', 'invalid_market');
  end if;
  if p_event_type = 'platform_click' and coalesce(trim(p_platform), '') = '' then
    return jsonb_build_object('error', 'missing_platform');
  end if;

  -- Rate caps: per pageview session and per link-hour.
  if (select count(*) from public.activate_link_events
      where link_id = v_link.id and session_id = p_session_id) >= 200
     or (select count(*) from public.activate_link_events
         where link_id = v_link.id and occurred_at > now() - interval '1 hour') >= 5000
  then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  insert into public.activate_link_events
    (link_id, session_id, event_type, declared_market_code, declared_entity_id, platform, tier)
  values
    (v_link.id, p_session_id, p_event_type, p_market_code, p_entity_company_id,
     nullif(trim(p_platform), ''), p_tier);

  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.activate_log_event(text, uuid, text, text, uuid, text, int)
  to anon, authenticated;

------------------------------------------------------------------------------
-- Admin: mint a link. Refuses until client consent is recorded for the org.
------------------------------------------------------------------------------

create or replace function public.admin_create_activate_link(
  p_org_id uuid,
  p_label text,
  p_audience text default null,
  p_prefill_market_code text default null,
  p_prefill_entity_company_id uuid default null,
  p_expires_days int default 90
) returns public.activate_links
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_link public.activate_links;
  v_token text;
begin
  if not is_admin() then
    raise exception 'admin only';
  end if;
  if coalesce(trim(p_label), '') = '' then
    raise exception 'label is required';
  end if;
  if not exists (
    select 1 from public.activate_org_settings
    where org_id = p_org_id and consent_confirmed_at is not null
  ) then
    raise exception 'consent_required';
  end if;
  if p_audience is not null and p_audience not in ('employee', 'candidate', 'alumni') then
    raise exception 'invalid audience';
  end if;
  if p_prefill_market_code is not null and p_prefill_market_code !~ '^[A-Z]{2}$' then
    raise exception 'invalid market code';
  end if;
  if p_prefill_entity_company_id is not null and not exists (
    select 1 from public.organization_companies
    where organization_id = p_org_id and company_id = p_prefill_entity_company_id
  ) then
    raise exception 'entity does not belong to org';
  end if;

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/', '-_'), '=');

  insert into public.activate_links
    (org_id, token, label, audience, prefill_market_code, prefill_entity_company_id,
     created_by, expires_at)
  values
    (p_org_id, v_token, trim(p_label), p_audience, p_prefill_market_code,
     p_prefill_entity_company_id, auth.uid(),
     now() + make_interval(days => greatest(1, coalesce(p_expires_days, 90))))
  returning * into v_link;

  return v_link;
end $$;

revoke execute on function public.admin_create_activate_link(uuid, text, text, text, uuid, int)
  from public, anon;
grant execute on function public.admin_create_activate_link(uuid, text, text, text, uuid, int)
  to authenticated;

------------------------------------------------------------------------------
-- Admin: per-link funnel. Declaration is the funnel top (opens are bot-soft).
-- k-anonymity floor: below 5 distinct declared sessions a link returns totals
-- only — market/entity/platform breakdowns are suppressed here, not in the UI.
------------------------------------------------------------------------------

create or replace function public.admin_activate_link_stats(p_org_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  k_floor constant int := 5;
begin
  if not is_admin() then
    raise exception 'admin only';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'link_id', l.id,
      'open_sessions', s.open_sessions,
      'declared_sessions', s.declared_sessions,
      'click_sessions', s.click_sessions,
      'clicks_total', s.clicks_total,
      'suppressed', s.declared_sessions < k_floor,
      'markets', case when s.declared_sessions >= k_floor then s.markets end,
      'platforms', case when s.declared_sessions >= k_floor then s.platforms end
    ) order by l.created_at desc)
    from public.activate_links l
    cross join lateral (
      select
        count(distinct e.session_id) filter (where e.event_type = 'open') as open_sessions,
        count(distinct e.session_id) filter (where e.event_type = 'market_declared') as declared_sessions,
        count(distinct e.session_id) filter (where e.event_type = 'platform_click') as click_sessions,
        count(*) filter (where e.event_type = 'platform_click') as clicks_total,
        (select jsonb_object_agg(m.code, m.n) from (
           select e2.declared_market_code as code, count(distinct e2.session_id) as n
           from public.activate_link_events e2
           where e2.link_id = l.id and e2.event_type = 'market_declared'
             and e2.declared_market_code is not null
           group by 1
         ) m) as markets,
        (select jsonb_object_agg(p.platform, p.n) from (
           select e3.platform, count(*) as n
           from public.activate_link_events e3
           where e3.link_id = l.id and e3.event_type = 'platform_click'
             and e3.platform is not null
           group by 1
         ) p) as platforms
      from public.activate_link_events e
      where e.link_id = l.id
    ) s
    where l.org_id = p_org_id
  ), '[]'::jsonb);
end $$;

revoke execute on function public.admin_activate_link_stats(uuid) from public, anon;
grant execute on function public.admin_activate_link_stats(uuid) to authenticated;
