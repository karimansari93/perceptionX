-- Ford: show every place candidates actually discover what it's like to work
-- here — "go where you're comfortable" — instead of a hand-picked top three.
--
-- Rows are generated from measured coverage (2026-07-01 cycle) with curation
-- encoded as explicit rules rather than a citation ranking:
--   * floor of 3% of that market's answers
--   * a market's own platform is offered only in its own market: AmbitionBox
--     shows in India, never in Argentina where it is citation noise
--   * Computrabajo excluded entirely — its cited pages are dealer listings and
--     job ads, not Ford review pages
--   * destination URLs come from the verified registry below; per-market URLs
--     already seeded (localized Glassdoor employer ids, local LinkedIn pages)
--     are preserved, never overwritten
--
-- This replaced a hardcoded, client-agnostic social list that was wrong in
-- both directions: YouTube is the loudest social source in 10 of 18 Ford
-- markets and was absent entirely, while TikTok and Blind — which shipped
-- globally — never clear 12.4% and 2.3%.

do $$
declare
  v_org uuid := '0af791f6-db6e-4063-95c4-71cd31f8779a';
begin
  if not exists (select 1 from public.organizations where id = v_org) then
    raise notice 'Ford org % not found; skipping', v_org;
    return;
  end if;

  with cov as (
    select amm.market_code, pr.id, lower(c->>'domain') as domain
    from prompt_responses pr
    join confirmed_prompts cp on cp.id = pr.confirmed_prompt_id
    join activate_market_map amm
      on amm.org_id = v_org and amm.location_context = cp.location_context
    cross join lateral jsonb_array_elements(coalesce(pr.canonical_citations,'[]'::jsonb)) c
    where pr.company_id in (select company_id from organization_companies where organization_id = v_org)
      and pr.collection_cycle = '2026-07-01'
      and amm.location_context not in ('Dearborn, Michigan','Kentucky')
  ),
  tot as (
    select amm.market_code, count(*)::numeric n
    from prompt_responses pr
    join confirmed_prompts cp on cp.id = pr.confirmed_prompt_id
    join activate_market_map amm
      on amm.org_id = v_org and amm.location_context = cp.location_context
    where pr.company_id in (select company_id from organization_companies where organization_id = v_org)
      and pr.collection_cycle = '2026-07-01'
      and amm.location_context not in ('Dearborn, Michigan','Kentucky')
    group by 1
  ),
  plat as (
    select market_code, id,
      case
        when domain like '%glassdoor%'     then 'glassdoor'
        when domain like '%indeed%'        then 'indeed'
        when domain like '%kununu%'        then 'kununu'
        when domain like '%seek.com%'      then 'seek'
        when domain like '%ambitionbox%'   then 'ambitionbox'
        when domain like '%undelucram%'    then 'undelucram'
        when domain like '%profession.hu%' then 'profession'
        when domain like '%infojobs%'      then 'infojobs'
        when domain like '%comparably%'    then 'comparably'
        when domain like '%reddit%'        then 'reddit'
        when domain like '%quora%'         then 'quora'
        when domain like '%teamblind%'     then 'blind'
        when domain like '%linkedin%'      then 'linkedin'
        when domain like '%youtube%' or domain like '%youtu.be%' then 'youtube'
        when domain like '%instagram%'     then 'instagram'
        when domain like '%facebook%'      then 'facebook'
        when domain like '%tiktok%'        then 'tiktok'
      end as platform
    from cov
  ),
  agg as (
    select p.market_code, p.platform, round(100.0*count(distinct p.id)/t.n, 1) as pct
    from plat p join tot t on t.market_code = p.market_code
    where p.platform is not null
    group by 1,2,t.n
  ),
  reg as (
    select * from (values
      ('glassdoor','review','https://www.glassdoor.com/Reviews/Ford-Motor-Company-Reviews-E263.htm',true,null::text,'Glassdoor'),
      ('indeed','review','https://www.indeed.com/cmp/Ford-Motor-Company/reviews',true,null,'Indeed'),
      ('comparably','review','https://www.comparably.com/companies/ford-motor-company',false,null,'Comparably'),
      ('kununu','review','https://www.kununu.com/de/ford-werke',false,'DE','kununu'),
      ('ambitionbox','review','https://www.ambitionbox.com/reviews/ford-motor-reviews',false,'IN','AmbitionBox'),
      ('undelucram','review','https://www.undelucram.ro/ro/evaluari-ford-romania-totul-despre-mediul-de-lucru-interviu-1056',false,'RO','Undelucram.ro'),
      ('profession','review','https://www.profession.hu/cegek/ford-kozep-es-kelet-europai-kft/velemenyek',false,'HU','Profession.hu'),
      ('infojobs','review','https://www.infojobs.com.br/ford-motor-company/availacoes',false,'BR','InfoJobs'),
      ('seek','review','https://www.seek.com.au/companies/ford-motor-company-432621/reviews',false,'AU','Seek'),
      ('reddit','forum','https://www.reddit.com/r/Ford/',false,null,'Reddit'),
      ('quora','forum','https://www.quora.com/topic/Ford-Motor-Company',false,null,'Quora'),
      ('blind','forum','https://www.teamblind.com',false,null,'Blind'),
      ('linkedin','social','https://www.linkedin.com/company/ford-motor-company',false,null,'LinkedIn'),
      ('youtube','social','https://www.youtube.com/results?search_query=working+at+Ford',false,null,'YouTube'),
      ('instagram','social','https://www.instagram.com/ford/',false,null,'Instagram'),
      ('facebook','social','https://www.facebook.com/FordMotorCompanyCareers',false,null,'Facebook'),
      ('tiktok','social','https://www.tiktok.com',false,null,'TikTok')
    ) as t(platform, channel, url, direct, home_market, display)
  ),
  final as (
    select a.market_code, a.platform, a.pct, r.channel, r.url, r.direct, r.display,
           (r.home_market is not null and r.home_market = a.market_code) as is_local
    from agg a join reg r on r.platform = a.platform
    where a.pct >= 3.0
      and (r.home_market is null or r.home_market = a.market_code)
  )
  insert into activate_routes
    (org_id, entity_company_id, market_code, tier, channel, platform, destination_url,
     rationale_stat, is_local, rank, active, use_direct_link)
  select v_org, null, f.market_code, 1, f.channel, f.platform, f.url,
         f.display || ' appears in ' || f.pct || '% of AI answers about working at Ford in '
           || case f.market_code when 'US' then 'the US' when 'GB' then 'the UK'
                else (select min(location_context) from activate_market_map
                       where org_id = v_org and market_code = f.market_code
                         and location_context not in ('Dearborn, Michigan','Kentucky')) end
           || '.',
         f.is_local,
         case when f.is_local then 0
              else row_number() over (partition by f.market_code, f.channel
                                      order by f.is_local desc, f.pct desc) end,
         true, f.direct
  from final f
  on conflict (org_id, coalesce(market_code,'--'), platform,
               coalesce(entity_company_id,'00000000-0000-0000-0000-000000000000'::uuid))
  do update set
    channel = excluded.channel,
    rationale_stat = excluded.rationale_stat,
    is_local = excluded.is_local,
    rank = excluded.rank,
    active = true;
    -- destination_url deliberately untouched: verified per-market URLs win

  -- Affinity badges the card ("your world") for a declared profile. It never
  -- reorders: order is local first, then measured coverage.
  update activate_routes set
    audience_functions = case when platform in ('reddit','blind')
                              then array['engineering-tech','manufacturing-ops']
                              else audience_functions end,
    audience_seniority = case
      when platform in ('instagram','tiktok') then array['early-career']
      when platform = 'linkedin' then array['mid-level','senior','executive']
      else audience_seniority end
  where org_id = v_org and channel in ('forum','social');

  -- The pages AI cites most. Labels are written by hand from descriptive URL
  -- slugs; pages whose content cannot be verified from the URL are not seeded.
  -- One r/Ford thread is the top-cited social page in the US, UK and India.
  insert into public.activate_route_highlights (org_id, market_code, platform, url, label, citations, rank)
  values
    (v_org,'US','reddit','https://www.reddit.com/r/Ford/comments/1ndhvti/whats_it_like_working_at_ford/','“What''s it like working at Ford” on r/Ford',74,1),
    (v_org,'US','quora','https://www.quora.com/What-is-the-corporate-culture-like-at-Ford-How-is-the-culture-different-than-other-companies','“What is the corporate culture like at Ford?”',52,1),
    (v_org,'GB','reddit','https://www.reddit.com/r/Ford/comments/1ndhvti/whats_it_like_working_at_ford/','“What''s it like working at Ford” on r/Ford',44,1),
    (v_org,'GB','quora','https://www.quora.com/What-is-the-corporate-culture-like-at-Ford-How-is-the-culture-different-than-other-companies','“What is the corporate culture like at Ford?”',25,1),
    (v_org,'IN','reddit','https://www.reddit.com/r/Ford/comments/1ndhvti/whats_it_like_working_at_ford/','“What''s it like working at Ford” on r/Ford',59,1),
    (v_org,'IN','quora','https://www.quora.com/What-is-the-interview-process-at-Ford-India-What-are-the-rounds','“What is the interview process at Ford India?”',77,1),
    (v_org,'DE','reddit','https://www.reddit.com/r/Ford/comments/1ndhvti/whats_it_like_working_at_ford/','“What''s it like working at Ford” on r/Ford',5,1),
    (v_org,'RO','reddit','https://www.reddit.com/r/Romania/comments/zqinqg/companii_industria_automotive_in_ro_cine_e_cel/','“Automotive companies in Romania — which is best?” on r/Romania',10,1),
    (v_org,'BR','reddit','https://www.reddit.com/r/Ford/comments/1ndhvti/whats_it_like_working_at_ford/','“What''s it like working at Ford” on r/Ford',7,1)
  on conflict (org_id, coalesce(market_code,'--'), platform, url) do update
    set label = excluded.label, citations = excluded.citations, rank = excluded.rank;
end $$;
