-- Amplify outcome tracking.
--
-- We can never see whether a recipient wrote anything: no platform calls back,
-- and the page promises "We don't see what you write, or whether you write at
-- all." This migration adds the two honest substitutes:
--
-- 1. Page signals, aggregate only (amplify_page_events):
--      routes_shown       which platforms a recipient was shown
--      platform_expanded  they opened a platform card to read the how-to
--      platform_return    they came back to the page after a click, and how long
--                         they were away (a rough proxy, reported in buckets)
--      page_shared        they shared or copied the page link
--    Kept in their own table, joined to activate_link_events on session_id, so
--    the existing event table, its check constraint and activate_log_event are
--    untouched. Same session model: a random id per pageview, never a person.
--
-- 2. Platform-side review counts (activate_review_snapshots): the public
--    review total on each destination profile, entered by hand by an admin
--    every week or two. Growth before vs after a link went out, by market, is
--    the outcome measure. Never scraped (Glassdoor and Indeed forbid it).
--
-- Stats RPCs keep the k-anonymity floor: below 5 sessions that picked a
-- country, a link (or an org, for the weekly series) shows totals only.
-- Load: one small insert per recipient action, no triggers, no schedules.

------------------------------------------------------------------------------
-- 1. Page signals
------------------------------------------------------------------------------

create table if not exists public.amplify_page_events (
  id bigint generated always as identity primary key,
  link_id uuid not null references public.activate_links(id) on delete cascade,
  session_id uuid not null,
  event_type text not null
    check (event_type in ('routes_shown', 'platform_expanded', 'platform_return', 'page_shared')),
  market_code text check (market_code ~ '^[A-Z]{2}$'),
  platform text check (length(platform) <= 60),
  shown_platforms text[],
  away_seconds integer check (away_seconds between 0 and 86400),
  occurred_at timestamptz not null default now()
);

create index if not exists amplify_page_events_link_time_idx
  on public.amplify_page_events (link_id, occurred_at desc);
create index if not exists amplify_page_events_link_session_idx
  on public.amplify_page_events (link_id, session_id);

alter table public.amplify_page_events enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'amplify_page_events'
                 and policyname = 'amplify_page_events_admin_read') then
    create policy amplify_page_events_admin_read on public.amplify_page_events
      for select using (is_admin());
  end if;
end $$;

comment on table public.amplify_page_events is
  'Aggregate-only page signals from Amplify recipients. session_id is a random '
  'per-pageview id, never a person. Written only via amplify_log_event.';

create or replace function public.amplify_log_event(
  p_token text,
  p_session_id uuid,
  p_event_type text,
  p_market_code text default null,
  p_platform text default null,
  p_shown_platforms text[] default null,
  p_away_seconds integer default null
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_link public.activate_links;
begin
  -- Same predicate as the other token RPCs: a switched-off link is dead for
  -- writes too.
  select * into v_link from public.activate_links
  where token = p_token and revoked_at is null and (expires_at is null or expires_at > now());
  if v_link.id is null then return jsonb_build_object('error','not_found'); end if;

  if p_session_id is null
     or p_event_type not in ('routes_shown','platform_expanded','platform_return','page_shared') then
    return jsonb_build_object('error','invalid_event');
  end if;
  if p_market_code is not null and p_market_code !~ '^[A-Z]{2}$' then
    return jsonb_build_object('error','invalid_market');
  end if;
  if length(coalesce(p_platform,'')) > 60 then
    return jsonb_build_object('error','invalid_platform');
  end if;
  if p_event_type in ('platform_expanded','platform_return') and coalesce(trim(p_platform),'') = '' then
    return jsonb_build_object('error','missing_platform');
  end if;
  if p_event_type = 'page_shared' and coalesce(p_platform,'') not in ('native','copy') then
    return jsonb_build_object('error','invalid_share');
  end if;
  if p_shown_platforms is not null and (
       coalesce(array_length(p_shown_platforms, 1), 0) > 40
       or exists (select 1 from unnest(p_shown_platforms) s where length(s) > 60)
     ) then
    return jsonb_build_object('error','invalid_shown');
  end if;
  if p_away_seconds is not null and (p_away_seconds < 0 or p_away_seconds > 86400) then
    return jsonb_build_object('error','invalid_away');
  end if;

  if (select count(*) from public.amplify_page_events
      where link_id = v_link.id and session_id = p_session_id) >= 200
     or (select count(*) from public.amplify_page_events
         where link_id = v_link.id and occurred_at > now() - interval '1 hour') >= 5000
  then
    return jsonb_build_object('error','rate_limited');
  end if;

  insert into public.amplify_page_events
    (link_id, session_id, event_type, market_code, platform, shown_platforms, away_seconds)
  values
    (v_link.id, p_session_id, p_event_type, p_market_code,
     nullif(trim(p_platform),''),
     case when p_event_type = 'routes_shown' then p_shown_platforms end,
     case when p_event_type = 'platform_return' then p_away_seconds end);

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.amplify_log_event(text, uuid, text, text, text, text[], integer) from public;
grant execute on function public.amplify_log_event(text, uuid, text, text, text, text[], integer) to anon, authenticated;

------------------------------------------------------------------------------
-- Per-link insights: the funnel step by step, platform shown -> opened ->
-- clicked -> returned, time away in buckets, shares. Breakdowns withheld below
-- the floor, enforced here rather than in the UI.
------------------------------------------------------------------------------

create or replace function public.admin_amplify_link_insights(p_org_id uuid)
returns jsonb
language plpgsql security definer stable
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
      'funnel', f.funnel,
      'shares', f.shares,
      'suppressed', (f.funnel->>'market_declared')::int < k_floor,
      'platforms', case when (f.funnel->>'market_declared')::int >= k_floor then p.platforms end,
      'away', case when (f.funnel->>'market_declared')::int >= k_floor then a.away end
    ) order by l.created_at desc)
    from public.activate_links l
    cross join lateral (
      select
        jsonb_build_object(
          'open',             (select count(distinct session_id) from activate_link_events where link_id = l.id and event_type = 'open'),
          'market_declared',  (select count(distinct session_id) from activate_link_events where link_id = l.id and event_type = 'market_declared'),
          'entity_declared',  (select count(distinct session_id) from activate_link_events where link_id = l.id and event_type = 'entity_declared'),
          'profile_declared', (select count(distinct session_id) from activate_link_events where link_id = l.id and event_type = 'profile_declared'),
          'routes_shown',     (select count(distinct session_id) from amplify_page_events  where link_id = l.id and event_type = 'routes_shown'),
          'platform_expanded',(select count(distinct session_id) from amplify_page_events  where link_id = l.id and event_type = 'platform_expanded'),
          'platform_click',   (select count(distinct session_id) from activate_link_events where link_id = l.id and event_type = 'platform_click'),
          'platform_return',  (select count(distinct session_id) from amplify_page_events  where link_id = l.id and event_type = 'platform_return')
        ) as funnel,
        jsonb_build_object(
          'sessions', (select count(distinct session_id) from amplify_page_events where link_id = l.id and event_type = 'page_shared'),
          'native',   (select count(*) from amplify_page_events where link_id = l.id and event_type = 'page_shared' and platform = 'native'),
          'copy',     (select count(*) from amplify_page_events where link_id = l.id and event_type = 'page_shared' and platform = 'copy')
        ) as shares
    ) f
    cross join lateral (
      -- Per platform: sessions shown it, opened its card, clicked it, came back.
      select jsonb_object_agg(x.platform, jsonb_build_object(
               'shown', x.shown, 'expanded', x.expanded, 'clicked', x.clicked, 'returned', x.returned)) as platforms
      from (
        select s.platform,
          count(distinct s.session_id) filter (where s.kind = 'shown')    as shown,
          count(distinct s.session_id) filter (where s.kind = 'expanded') as expanded,
          count(distinct s.session_id) filter (where s.kind = 'clicked')  as clicked,
          count(distinct s.session_id) filter (where s.kind = 'returned') as returned
        from (
          select e.session_id, unnest(e.shown_platforms) as platform, 'shown' as kind
            from amplify_page_events e where e.link_id = l.id and e.event_type = 'routes_shown'
          union all
          select e.session_id, e.platform, 'expanded'
            from amplify_page_events e where e.link_id = l.id and e.event_type = 'platform_expanded'
          union all
          select e.session_id, e.platform, 'clicked'
            from activate_link_events e where e.link_id = l.id and e.event_type = 'platform_click'
          union all
          select e.session_id, e.platform, 'returned'
            from amplify_page_events e where e.link_id = l.id and e.event_type = 'platform_return'
        ) s
        where s.platform is not null
        group by s.platform
      ) x
    ) p
    cross join lateral (
      select jsonb_build_object(
        'under_30s',  count(*) filter (where away_seconds < 30),
        '30s_to_2m',  count(*) filter (where away_seconds >= 30 and away_seconds < 120),
        '2m_to_10m',  count(*) filter (where away_seconds >= 120 and away_seconds < 600),
        'over_10m',   count(*) filter (where away_seconds >= 600)
      ) as away
      from amplify_page_events
      where link_id = l.id and event_type = 'platform_return' and away_seconds is not null
    ) a
    where l.org_id = p_org_id
  ), '[]'::jsonb);
end $$;

revoke all on function public.admin_amplify_link_insights(uuid) from public, anon;
grant execute on function public.admin_amplify_link_insights(uuid) to authenticated;

------------------------------------------------------------------------------
-- Weekly click-through sessions per market x platform, org-wide, for the
-- review-count chart. Withheld entirely below the floor.
------------------------------------------------------------------------------

create or replace function public.admin_amplify_weekly_clicks(p_org_id uuid)
returns jsonb
language plpgsql security definer stable
set search_path = public
as $$
declare
  k_floor constant int := 5;
  v_declared int;
begin
  if not is_admin() then
    raise exception 'admin only';
  end if;

  select count(distinct e.session_id) into v_declared
  from activate_link_events e join activate_links l on l.id = e.link_id
  where l.org_id = p_org_id and e.event_type = 'market_declared';

  if v_declared < k_floor then
    return jsonb_build_object('suppressed', true, 'rows', '[]'::jsonb);
  end if;

  return jsonb_build_object('suppressed', false, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'week', w.week, 'market_code', w.market_code, 'platform', w.platform, 'sessions', w.sessions)
      order by w.week)
    from (
      select date_trunc('week', e.occurred_at)::date as week,
             e.declared_market_code as market_code,
             e.platform,
             count(distinct e.session_id) as sessions
      from activate_link_events e join activate_links l on l.id = e.link_id
      where l.org_id = p_org_id and e.event_type = 'platform_click' and e.platform is not null
      group by 1, 2, 3
    ) w
  ), '[]'::jsonb));
end $$;

revoke all on function public.admin_amplify_weekly_clicks(uuid) from public, anon;
grant execute on function public.admin_amplify_weekly_clicks(uuid) to authenticated;

------------------------------------------------------------------------------
-- 2. Platform-side review counts
------------------------------------------------------------------------------

create table if not exists public.activate_review_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  platform text not null,
  -- NULL = the global (tier 3) profile, same convention as activate_routes.
  market_code text check (market_code ~ '^[A-Z]{2}$'),
  profile_url text not null,
  review_count integer not null check (review_count >= 0),
  rating numeric(3,2) check (rating between 0 and 5),
  captured_on date not null default current_date,
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (org_id, profile_url, captured_on)
);

create index if not exists activate_review_snapshots_org_idx
  on public.activate_review_snapshots (org_id, profile_url, captured_on);

alter table public.activate_review_snapshots enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'activate_review_snapshots'
                 and policyname = 'activate_review_snapshots_admin_all') then
    create policy activate_review_snapshots_admin_all on public.activate_review_snapshots
      for all using (is_admin()) with check (is_admin());
  end if;
end $$;

comment on table public.activate_review_snapshots is
  'Public review total on each Amplify destination profile, entered by hand '
  'every week or two. Growth before vs after a link went out is the outcome '
  'measure. Never scraped.';
