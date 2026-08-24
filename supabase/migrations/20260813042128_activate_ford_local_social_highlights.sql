-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260813042128; this file was
-- back-filled afterwards and therefore post-dates the deployment.

do $$
declare
  v_ford uuid := '0af791f6-db6e-4063-95c4-71cd31f8779a';
  v_csl  uuid := 'ebbe52ed-0c8e-4d5b-9526-67496e09c6b4';
  li_generic text := 'https://www.linkedin.com/company/ford-motor-company';
  yt text := 'https://www.youtube.com/results?search_query=working+at+Ford';
  rd text := 'https://www.reddit.com/r/Ford/';
  ig text := 'https://www.instagram.com/ford/';
  fb text := 'https://www.facebook.com/FordMotorCompanyCareers';
  qa text := 'https://www.quora.com/topic/Ford-Motor-Company';
begin
  -- 1. Mark each market's own platform. Global platforms (Glassdoor, Indeed,
  --    Comparably) are never local.
  update public.activate_routes
  set is_local = true
  where org_id in (v_ford, v_csl)
    and channel = 'review'
    and market_code is not null
    and (
      (platform = 'kununu'      and market_code in ('DE','CH')) or
      (platform = 'ambitionbox' and market_code = 'IN') or
      (platform = 'undelucram'  and market_code = 'RO') or
      (platform = 'profession'  and market_code = 'HU') or
      (platform = 'infojobs'    and market_code = 'BR') or
      (platform = 'seek'        and market_code = 'AU')
    );

  -- 2. Local page sorts first, ahead of higher-coverage global platforms.
  update public.activate_routes set rank = 0
  where org_id in (v_ford, v_csl) and is_local and channel = 'review';

  -- 3. Per-market social routes from measured coverage, replacing the
  --    one-size-fits-all global list. YouTube is the loudest social source in
  --    10 of 18 Ford markets and was previously absent entirely; TikTok and
  --    Blind, which were shipped globally, never clear 12.4% and 2.3%.
  insert into public.activate_routes
    (org_id, entity_company_id, market_code, tier, channel, platform,
     destination_url, rationale_stat, rank, active, use_direct_link)
  values
    (v_ford,null,'AR',1,'social','linkedin',li_generic,'LinkedIn appears in 31.6% of AI answers about working at Ford in Argentina.',1,true,false),
    (v_ford,null,'AR',1,'social','youtube',yt,'YouTube appears in 28.3% of AI answers about working at Ford in Argentina.',2,true,false),
    (v_ford,null,'AR',1,'social','instagram',ig,'Instagram appears in 26.8% of AI answers about working at Ford in Argentina.',3,true,false),

    (v_ford,null,'AU',1,'social','linkedin',li_generic,'LinkedIn appears in 28.8% of AI answers about working at Ford in Australia.',1,true,false),
    (v_ford,null,'AU',1,'social','youtube',yt,'YouTube appears in 15.0% of AI answers about working at Ford in Australia.',2,true,false),
    (v_ford,null,'AU',1,'social','reddit',rd,'Reddit appears in 10.5% of AI answers about working at Ford in Australia.',3,true,false),

    (v_ford,null,'BE',1,'social','linkedin',li_generic,'LinkedIn appears in 25.6% of AI answers about working at Ford in Belgium.',1,true,false),
    (v_ford,null,'BE',1,'social','youtube',yt,'YouTube appears in 11.0% of AI answers about working at Ford in Belgium.',2,true,false),

    (v_ford,null,'BR',1,'social','youtube',yt,'YouTube appears in 44.0% of AI answers about working at Ford in Brazil.',1,true,false),
    (v_ford,null,'BR',1,'social','instagram',ig,'Instagram appears in 29.8% of AI answers about working at Ford in Brazil.',2,true,false),
    (v_ford,null,'BR',1,'social','linkedin','https://br.linkedin.com/company/ford-brasil','LinkedIn appears in 23.7% of AI answers about working at Ford in Brazil.',3,true,false),

    (v_ford,null,'CA',1,'social','linkedin',li_generic,'LinkedIn appears in 19.7% of AI answers about working at Ford in Canada.',1,true,false),
    (v_ford,null,'CA',1,'social','youtube',yt,'YouTube appears in 12.1% of AI answers about working at Ford in Canada.',2,true,false),
    (v_ford,null,'CA',1,'social','reddit',rd,'Reddit appears in 9.9% of AI answers about working at Ford in Canada.',3,true,false),

    (v_ford,null,'CL',1,'social','linkedin',li_generic,'LinkedIn appears in 27.9% of AI answers about working at Ford in Chile.',1,true,false),
    (v_ford,null,'CL',1,'social','youtube',yt,'YouTube appears in 26.3% of AI answers about working at Ford in Chile.',2,true,false),
    (v_ford,null,'CL',1,'social','instagram',ig,'Instagram appears in 19.9% of AI answers about working at Ford in Chile.',3,true,false),

    (v_ford,null,'CO',1,'social','youtube',yt,'YouTube appears in 33.2% of AI answers about working at Ford in Colombia.',1,true,false),
    (v_ford,null,'CO',1,'social','instagram',ig,'Instagram appears in 22.5% of AI answers about working at Ford in Colombia.',2,true,false),
    (v_ford,null,'CO',1,'social','linkedin',li_generic,'LinkedIn appears in 19.9% of AI answers about working at Ford in Colombia.',3,true,false),

    (v_ford,null,'FR',1,'social','youtube',yt,'YouTube appears in 21.4% of AI answers about working at Ford in France.',1,true,false),
    (v_ford,null,'FR',1,'social','linkedin',li_generic,'LinkedIn appears in 15.3% of AI answers about working at Ford in France.',2,true,false),
    (v_ford,null,'FR',1,'social','instagram',ig,'Instagram appears in 11.8% of AI answers about working at Ford in France.',3,true,false),

    (v_ford,null,'DE',1,'social','youtube',yt,'YouTube appears in 19.4% of AI answers about working at Ford in Germany.',1,true,false),
    (v_ford,null,'DE',1,'social','linkedin','https://www.linkedin.com/showcase/ford-werke-gmbh','LinkedIn appears in 11.2% of AI answers about working at Ford in Germany.',2,true,false),
    (v_ford,null,'DE',1,'social','reddit',rd,'Reddit appears in 2.9% of AI answers about working at Ford in Germany.',3,true,false),

    (v_ford,null,'HU',1,'social','linkedin',li_generic,'LinkedIn appears in 23.8% of AI answers about working at Ford in Hungary.',1,true,false),
    (v_ford,null,'HU',1,'social','facebook',fb,'Facebook appears in 8.3% of AI answers about working at Ford in Hungary.',2,true,false),
    (v_ford,null,'HU',1,'social','reddit',rd,'Reddit appears in 7.1% of AI answers about working at Ford in Hungary.',3,true,false),

    (v_ford,null,'IN',1,'social','linkedin','https://in.linkedin.com/showcase/ford-india/','LinkedIn appears in 38.8% of AI answers about working at Ford in India.',1,true,false),
    (v_ford,null,'IN',1,'social','youtube',yt,'YouTube appears in 22.9% of AI answers about working at Ford in India.',2,true,false),
    (v_ford,null,'IN',1,'social','facebook',fb,'Facebook appears in 14.6% of AI answers about working at Ford in India.',3,true,false),
    (v_ford,null,'IN',1,'social','quora',qa,'Quora appears in 11.3% of AI answers about working at Ford in India.',4,true,false),

    (v_ford,null,'MX',1,'social','youtube',yt,'YouTube appears in 30.9% of AI answers about working at Ford in Mexico.',1,true,false),
    (v_ford,null,'MX',1,'social','linkedin',li_generic,'LinkedIn appears in 21.9% of AI answers about working at Ford in Mexico.',2,true,false),
    (v_ford,null,'MX',1,'social','instagram',ig,'Instagram appears in 19.5% of AI answers about working at Ford in Mexico.',3,true,false),

    (v_ford,null,'PE',1,'social','youtube',yt,'YouTube appears in 37.1% of AI answers about working at Ford in Peru.',1,true,false),
    (v_ford,null,'PE',1,'social','linkedin',li_generic,'LinkedIn appears in 26.8% of AI answers about working at Ford in Peru.',2,true,false),
    (v_ford,null,'PE',1,'social','facebook',fb,'Facebook appears in 20.4% of AI answers about working at Ford in Peru.',3,true,false),

    (v_ford,null,'RO',1,'social','linkedin','https://ro.linkedin.com/company/ford-otosan-romania','LinkedIn appears in 18.0% of AI answers about working at Ford in Romania.',1,true,false),
    (v_ford,null,'RO',1,'social','youtube',yt,'YouTube appears in 14.2% of AI answers about working at Ford in Romania.',2,true,false),
    (v_ford,null,'RO',1,'social','reddit',rd,'Reddit appears in 5.0% of AI answers about working at Ford in Romania.',3,true,false),

    (v_ford,null,'ES',1,'social','youtube',yt,'YouTube appears in 25.7% of AI answers about working at Ford in Spain.',1,true,false),
    (v_ford,null,'ES',1,'social','linkedin',li_generic,'LinkedIn appears in 11.5% of AI answers about working at Ford in Spain.',2,true,false),

    (v_ford,null,'GB',1,'social','linkedin',li_generic,'LinkedIn appears in 24.0% of AI answers about working at Ford in the UK.',1,true,false),
    (v_ford,null,'GB',1,'social','youtube',yt,'YouTube appears in 12.5% of AI answers about working at Ford in the UK.',2,true,false),
    (v_ford,null,'GB',1,'social','reddit',rd,'Reddit appears in 8.2% of AI answers about working at Ford in the UK.',3,true,false),

    (v_ford,null,'US',1,'social','linkedin',li_generic,'LinkedIn appears in 22.0% of AI answers about working at Ford in the US.',1,true,false),
    (v_ford,null,'US',1,'social','youtube',yt,'YouTube appears in 14.1% of AI answers about working at Ford in the US.',2,true,false),
    (v_ford,null,'US',1,'social','reddit',rd,'Reddit appears in 12.1% of AI answers about working at Ford in the US.',3,true,false),

    (v_ford,null,'VE',1,'social','linkedin',li_generic,'LinkedIn appears in 26.5% of AI answers about working at Ford in Venezuela.',1,true,false),
    (v_ford,null,'VE',1,'social','youtube',yt,'YouTube appears in 23.4% of AI answers about working at Ford in Venezuela.',2,true,false),
    (v_ford,null,'VE',1,'social','instagram',ig,'Instagram appears in 10.0% of AI answers about working at Ford in Venezuela.',3,true,false)
  on conflict (org_id, coalesce(market_code,'--'), platform,
               coalesce(entity_company_id,'00000000-0000-0000-0000-000000000000'::uuid))
  do update set channel = excluded.channel, destination_url = excluded.destination_url,
                rationale_stat = excluded.rationale_stat, rank = excluded.rank,
                tier = excluded.tier, active = true;

  -- Retire the global TikTok/Blind rows for Ford: measured coverage does not
  -- support them, and the per-market rows above now cover every measured market.
  update public.activate_routes set active = false
  where org_id = v_ford and channel = 'social' and market_code is null
    and platform in ('tiktok','blind','instagram');

  -- 4. The pages AI cites most. Labels written from descriptive URL slugs;
  --    pages whose content cannot be verified from the URL are not seeded.
  insert into public.activate_route_highlights (org_id, market_code, platform, url, label, citations, rank)
  values
    (v_ford,'US','reddit','https://www.reddit.com/r/Ford/comments/1ndhvti/whats_it_like_working_at_ford/','“What''s it like working at Ford” on r/Ford',74,1),
    (v_ford,'US','quora','https://www.quora.com/What-is-the-corporate-culture-like-at-Ford-How-is-the-culture-different-than-other-companies','“What is the corporate culture like at Ford?”',52,1),
    (v_ford,'GB','reddit','https://www.reddit.com/r/Ford/comments/1ndhvti/whats_it_like_working_at_ford/','“What''s it like working at Ford” on r/Ford',44,1),
    (v_ford,'IN','reddit','https://www.reddit.com/r/Ford/comments/1ndhvti/whats_it_like_working_at_ford/','“What''s it like working at Ford” on r/Ford',59,1),
    (v_ford,'IN','quora','https://www.quora.com/What-is-the-interview-process-at-Ford-India-What-are-the-rounds','“What is the interview process at Ford India?”',77,1),
    (v_ford,'DE','reddit','https://www.reddit.com/r/Ford/comments/1ndhvti/whats_it_like_working_at_ford/','“What''s it like working at Ford” on r/Ford',5,1),
    (v_ford,'RO','reddit','https://www.reddit.com/r/Romania/comments/zqinqg/companii_industria_automotive_in_ro_cine_e_cel/','“Automotive companies in Romania — which is best?” on r/Romania',10,1),
    (v_ford,'BR','reddit','https://www.reddit.com/r/Ford/comments/1ndhvti/whats_it_like_working_at_ford/','“What''s it like working at Ford” on r/Ford',7,1)
  on conflict (org_id, coalesce(market_code,'--'), platform, url) do update
    set label = excluded.label, citations = excluded.citations, rank = excluded.rank;
end $$;
