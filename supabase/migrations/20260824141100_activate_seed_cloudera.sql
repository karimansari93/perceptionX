-- Activate seed for Cloudera, curated from the measured corpus of
-- 2025-11 → 2026-03 (2,655 responses; collection_cycle is NULL for this org,
-- so the whole window is the baseline).
--
-- Cloudera is brand × market keyed on companies.country (CZ, ES, HU, IN, and
-- two duplicate US rows whose responses are aggregated as one US market).
-- confirmed_prompts.location_context is NULL throughout, so the market map is
-- seeded for future cohort joins and the single "Cloudera" entity shows in
-- every market. organization_companies carries two benchmark companies
-- (Databricks, Snowflake); the entity register keeps them out of the picker.
--
-- Regional platform mix (coverage = % of that market's answers citing the
-- source, aggregated across domain variants):
--   CZ  Glassdoor 17.3 · Indeed 16.1 · Comparably 3.7 · LinkedIn 3.4
--   ES  Glassdoor 16.2 · Indeed 9.6 · YouTube 6.4 · LinkedIn 6.1 · Comparably 3.2
--   HU  Glassdoor 33.8 · Indeed 13.0 · Comparably 9.3 · Reddit 5.3 · Blind 4.0
--   IN  Glassdoor 28.2 · AmbitionBox 21.7 · Indeed 18.2 · LinkedIn 8.4 · Blind 4.9
--   US  Glassdoor 25.3 · Indeed 18.9 · Comparably 16.9 · Blind 3.5
--
-- Glassdoor is consolidated on employer id E360671 everywhere, and Budapest —
-- Cloudera's engineering hub — has its own heavily-cited city-filtered
-- profile, which is the HU destination (the city page IS what AI reads for
-- Hungary; a Hungarian recipient's review lands where their market's answers
-- come from).
--
-- Deliberate exclusions (the no-auto-generation rule doing work):
--   * Atmoskop (6.8% CZ): the only cited profile is "The Cloud Provider
--     s.r.o." — a DIFFERENT Czech company that AI conflates with Cloudera.
--     Routing Cloudera people onto another employer's review page would be
--     worse than routing them nowhere. Same shape as Ford's Computrabajo.
--   * Built In (9.4% US), Great Place to Work, GoodFirms/Clutch (B2B service
--     directories) — client-influenced profiles, nothing to write.
--   * Medium (5.1% US), levels.fyi, jointaro.com — no review mechanic.
--   * AmbitionBox outside India (4.5% US, 2.6% HU) — cross-market noise;
--     inside India it is the market's own platform and sorts first.
--
-- Verified cited destinations: Glassdoor E360671 (global + co.in + the
-- Budapest page), indeed.com/cmp/Cloudera (www / in / cz / es cited; /reviews
-- paths pattern-derived from the verified slug where not directly cited),
-- ambitionbox.com/reviews/cloudera-reviews,
-- teamblind.com/company/Cloudera/reviews, comparably.com/companies/cloudera.
-- The loudest forum pages: r/programmingHungary's "Cloudera fizu" salary
-- thread (21) and Quora's "pros and cons of working at Cloudera instead of
-- Google" (30).
--
-- Consent seeded PENDING: no Cloudera link is mintable until recorded.

do $$
declare
  v_org uuid := 'a00a9f88-84f2-45f7-8139-4e6da7f708d2';
  gd_global text := 'https://www.glassdoor.com/Reviews/Cloudera-Reviews-E360671.htm';
  gd_budapest text := 'https://www.glassdoor.com/Reviews/Cloudera-Budapest-Reviews-EI_IE360671.0,8_IL.9,17_IM1115.htm';
  cmp text := 'https://www.comparably.com/companies/cloudera';
  blind text := 'https://www.teamblind.com/company/Cloudera/reviews';
begin
  if not exists (select 1 from public.organizations where id = v_org) then
    raise notice 'Cloudera org % not found; skipping Activate seed', v_org;
    return;
  end if;

  insert into public.activate_org_settings (org_id, consent_note, entity_names)
  values (v_org, 'Pending: client consent conversation not yet held', array['Cloudera'])
  on conflict (org_id) do update set entity_names = excluded.entity_names;

  insert into public.activate_branding
    (org_id, display_name, tagline, blurb, logo_domain, primary_color, accent_color)
  values
    (v_org, 'Cloudera', 'Cloudera · The hybrid data company',
     'Two questions, and we''ll show you the platforms AI systems actually read about working here.',
     'cloudera.com', '#16232B', '#F96702')
  on conflict (org_id) do nothing;

  -- location_context is NULL on this org's prompts today; rows anticipate the
  -- standard plain-country-name convention for cohort-analytics joins.
  insert into public.activate_market_map (org_id, market_code, location_context)
  values
    (v_org, 'CZ', 'Czech Republic'), (v_org, 'ES', 'Spain'), (v_org, 'HU', 'Hungary'),
    (v_org, 'IN', 'India'), (v_org, 'US', 'United States')
  on conflict do nothing;

  ---------------------------------------------------------------------------
  -- Tier-1 routes
  ---------------------------------------------------------------------------
  insert into public.activate_routes
    (org_id, entity_company_id, market_code, tier, channel, platform,
     destination_url, rationale_stat, is_local, rank, active, use_direct_link)
  values
    -- Czechia (Atmoskop excluded — see header)
    (v_org, null, 'CZ', 1, 'review', 'glassdoor', gd_global,
     'Glassdoor shows up in 17.3% of AI answers about working at Cloudera in Czechia.', false, 1, true, true),
    (v_org, null, 'CZ', 1, 'review', 'indeed', 'https://cz.indeed.com/cmp/Cloudera/reviews',
     'Indeed appears in 16.1% of AI answers about working at Cloudera in Czechia.', false, 2, true, true),
    (v_org, null, 'CZ', 1, 'review', 'comparably', cmp,
     'Comparably appears in 3.7% of AI answers about working at Cloudera in Czechia.', false, 3, true, false),
    (v_org, null, 'CZ', 1, 'social', 'linkedin', 'https://www.linkedin.com/company/cloudera',
     'LinkedIn appears in 3.4% of AI answers about working at Cloudera in Czechia.', false, 1, true, false),

    -- Spain (glassdoor.es URL pattern-derived from E360671)
    (v_org, null, 'ES', 1, 'review', 'glassdoor', 'https://www.glassdoor.es/Opiniones/Cloudera-Opiniones-E360671.htm',
     'Glassdoor shows up in 16.2% of AI answers about working at Cloudera in Spain.', false, 1, true, true),
    (v_org, null, 'ES', 1, 'review', 'indeed', 'https://es.indeed.com/cmp/Cloudera/reviews',
     'Indeed appears in 9.6% of AI answers about working at Cloudera in Spain.', false, 2, true, true),
    (v_org, null, 'ES', 1, 'review', 'comparably', cmp,
     'Comparably appears in 3.2% of AI answers about working at Cloudera in Spain.', false, 3, true, false),
    (v_org, null, 'ES', 1, 'social', 'youtube', 'https://www.youtube.com/results?search_query=working+at+Cloudera',
     'YouTube appears in 6.4% of AI answers about working at Cloudera in Spain.', false, 1, true, false),
    (v_org, null, 'ES', 1, 'social', 'linkedin', 'https://www.linkedin.com/company/cloudera',
     'LinkedIn appears in 6.1% of AI answers about working at Cloudera in Spain.', false, 2, true, false),

    -- Hungary — Budapest is the engineering hub and Glassdoor's Budapest page
    -- is what the market's answers actually cite.
    (v_org, null, 'HU', 1, 'review', 'glassdoor', gd_budapest,
     'Glassdoor shows up in 33.8% of AI answers about working at Cloudera in Hungary.', false, 1, true, true),
    (v_org, null, 'HU', 1, 'review', 'indeed', 'https://www.indeed.com/cmp/Cloudera/reviews',
     'Indeed appears in 13.0% of AI answers about working at Cloudera in Hungary.', false, 2, true, true),
    (v_org, null, 'HU', 1, 'review', 'comparably', cmp,
     'Comparably appears in 9.3% of AI answers about working at Cloudera in Hungary.', false, 3, true, false),
    (v_org, null, 'HU', 1, 'forum', 'reddit', 'https://www.reddit.com/r/programmingHungary/',
     'Reddit appears in 5.3% of AI answers about working at Cloudera in Hungary.', false, 1, true, false),
    (v_org, null, 'HU', 1, 'forum', 'blind', blind,
     'Blind appears in 4.0% of AI answers about working at Cloudera in Hungary.', false, 2, true, false),
    (v_org, null, 'HU', 1, 'social', 'linkedin', 'https://www.linkedin.com/company/cloudera',
     'LinkedIn appears in 5.1% of AI answers about working at Cloudera in Hungary.', false, 1, true, false),
    (v_org, null, 'HU', 1, 'social', 'youtube', 'https://www.youtube.com/results?search_query=working+at+Cloudera',
     'YouTube appears in 3.8% of AI answers about working at Cloudera in Hungary.', false, 2, true, false),

    -- India — AmbitionBox is the market's own platform: badged and sorted
    -- first even though Glassdoor's coverage is higher (the Ford convention).
    (v_org, null, 'IN', 1, 'review', 'ambitionbox', 'https://www.ambitionbox.com/reviews/cloudera-reviews',
     'AmbitionBox shows up in 21.7% of AI answers about working at Cloudera in India.', true, 1, true, false),
    (v_org, null, 'IN', 1, 'review', 'glassdoor', 'https://www.glassdoor.co.in/Reviews/Cloudera-Reviews-E360671.htm',
     'Glassdoor shows up in 28.2% of AI answers about working at Cloudera in India.', false, 2, true, true),
    (v_org, null, 'IN', 1, 'review', 'indeed', 'https://in.indeed.com/cmp/Cloudera/reviews',
     'Indeed appears in 18.2% of AI answers about working at Cloudera in India.', false, 3, true, true),
    (v_org, null, 'IN', 1, 'review', 'comparably', cmp,
     'Comparably appears in 5.3% of AI answers about working at Cloudera in India.', false, 4, true, false),
    (v_org, null, 'IN', 1, 'forum', 'blind', blind,
     'Blind appears in 4.9% of AI answers about working at Cloudera in India.', false, 1, true, false),
    (v_org, null, 'IN', 1, 'forum', 'quora', 'https://www.quora.com/topic/Cloudera',
     'Quora appears in 3.1% of AI answers about working at Cloudera in India.', false, 2, true, false),
    (v_org, null, 'IN', 1, 'social', 'linkedin', 'https://www.linkedin.com/company/cloudera',
     'LinkedIn appears in 8.4% of AI answers about working at Cloudera in India.', false, 1, true, false),
    (v_org, null, 'IN', 1, 'social', 'youtube', 'https://www.youtube.com/results?search_query=working+at+Cloudera',
     'YouTube appears in 6.9% of AI answers about working at Cloudera in India.', false, 2, true, false),

    -- United States (both US company rows aggregated)
    (v_org, null, 'US', 1, 'review', 'glassdoor', gd_global,
     'Glassdoor shows up in 25.3% of AI answers about working at Cloudera in the US.', false, 1, true, true),
    (v_org, null, 'US', 1, 'review', 'indeed', 'https://www.indeed.com/cmp/Cloudera/reviews',
     'Indeed appears in 18.9% of AI answers about working at Cloudera in the US.', false, 2, true, true),
    (v_org, null, 'US', 1, 'review', 'comparably', cmp,
     'Comparably appears in 16.9% of AI answers about working at Cloudera in the US.', false, 3, true, false),
    (v_org, null, 'US', 1, 'forum', 'blind', blind,
     'Blind appears in 3.5% of AI answers about working at Cloudera in the US.', false, 1, true, false),
    (v_org, null, 'US', 1, 'social', 'linkedin', 'https://www.linkedin.com/company/cloudera',
     'LinkedIn appears in 4.5% of AI answers about working at Cloudera in the US.', false, 1, true, false),
    (v_org, null, 'US', 1, 'social', 'youtube', 'https://www.youtube.com/results?search_query=working+at+Cloudera',
     'YouTube appears in 3.8% of AI answers about working at Cloudera in the US.', false, 2, true, false)
  on conflict (org_id, coalesce(market_code, '--'), platform,
               coalesce(entity_company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set
    destination_url = excluded.destination_url,
    rationale_stat = excluded.rationale_stat,
    tier = excluded.tier,
    channel = excluded.channel,
    is_local = excluded.is_local,
    rank = excluded.rank,
    use_direct_link = excluded.use_direct_link;

  -- Tier-3 global review fallback.
  insert into public.activate_routes
    (org_id, entity_company_id, market_code, tier, channel, platform,
     destination_url, rank, active, use_direct_link)
  values
    (v_org, null, null, 3, 'review', 'glassdoor', gd_global, 1, true, true),
    (v_org, null, null, 3, 'review', 'indeed', 'https://www.indeed.com/cmp/Cloudera/reviews', 2, true, true)
  on conflict (org_id, coalesce(market_code, '--'), platform,
               coalesce(entity_company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set
    channel = excluded.channel,
    destination_url = excluded.destination_url,
    rank = excluded.rank,
    use_direct_link = excluded.use_direct_link;

  -- Affinity badges ("your world") — never reorders, never hides.
  update public.activate_routes set
    audience_functions = case when platform in ('reddit','blind','quora')
                              then array['engineering-tech'] else audience_functions end,
    audience_seniority = case when platform = 'linkedin'
                              then array['mid-level','senior','executive']
                              else audience_seniority end
  where org_id = v_org and channel in ('forum','social');

  ---------------------------------------------------------------------------
  -- Per-market theme weights (top 4 attributes by share of the market's
  -- ai_themes). Career Opportunities leads India; Leadership makes the US
  -- top four; Innovation is top-three in both EU engineering markets.
  ---------------------------------------------------------------------------
  insert into public.activate_market_themes (org_id, market_code, theme, rank)
  values
    (v_org,'CZ','Company Culture',1),(v_org,'CZ','Career Opportunities',2),(v_org,'CZ','Innovation',3),(v_org,'CZ','Wellbeing & Balance',4),
    (v_org,'ES','Company Culture',1),(v_org,'ES','Career Opportunities',2),(v_org,'ES','Innovation',3),(v_org,'ES','Wellbeing & Balance',4),
    (v_org,'HU','Company Culture',1),(v_org,'HU','Career Opportunities',2),(v_org,'HU','Rewards & Recognition',3),(v_org,'HU','Wellbeing & Balance',4),
    (v_org,'IN','Career Opportunities',1),(v_org,'IN','Company Culture',2),(v_org,'IN','Wellbeing & Balance',3),(v_org,'IN','Innovation',4),
    (v_org,'US','Company Culture',1),(v_org,'US','Career Opportunities',2),(v_org,'US','Wellbeing & Balance',3),(v_org,'US','Leadership',4)
  on conflict (org_id, coalesce(market_code, '--'), theme) do nothing;

  -- % of the market's answers citing any routed people-influenced platform.
  insert into public.activate_market_coverage (org_id, market_code, people_pct)
  values
    (v_org,'CZ',30.2),(v_org,'ES',27.5),(v_org,'HU',45.0),(v_org,'IN',47.5),(v_org,'US',38.7)
  on conflict (org_id, market_code) do update set
    people_pct = excluded.people_pct, computed_at = now();

  -- The pages AI cites most; labels hand-written from the thread titles.
  insert into public.activate_route_highlights (org_id, market_code, platform, url, label, citations, rank)
  values
    (v_org,'HU','reddit','https://www.reddit.com/r/programmingHungary/comments/1n9utn0/cloudera_fizu/','“Cloudera fizu” — salary talk on r/programmingHungary',21,1),
    (v_org,'IN','quora','https://www.quora.com/What-are-the-pros-and-cons-of-working-at-Cloudera-instead-of-Google','“Pros and cons of working at Cloudera instead of Google” on Quora',30,1)
  on conflict (org_id, coalesce(market_code,'--'), platform, url) do update
    set label = excluded.label, citations = excluded.citations, rank = excluded.rank;

  -- Internal verification link, matching the other seeded orgs. The consent
  -- gate still blocks minting real links from the UI.
  if not exists (select 1 from public.activate_links where org_id = v_org) then
    insert into public.activate_links (org_id, token, label)
    values (v_org,
            rtrim(translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/', '-_'), '='),
            'Internal build verification (delete me)');
  end if;
end $$;
