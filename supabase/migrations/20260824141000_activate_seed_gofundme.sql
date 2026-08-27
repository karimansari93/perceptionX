-- Activate seed for GoFundMe, curated from the measured corpus of
-- 2025-11 → 2026-03 (3,458 responses across five market-keyed company rows;
-- collection_cycle is NULL for this org, so the whole window is the baseline).
--
-- GoFundMe is brand × market like Ford, with two differences worth recording:
--
--  * Market lives on companies.country as an ISO code (AR, GB, IE, MX) —
--    confirmed_prompts.location_context is NULL for almost all prompts, so
--    activate_market_map cannot attach markets to the entity. The single
--    "GoFundMe" entity therefore has an empty markets map and shows
--    everywhere, which is exactly right for a single-brand org.
--  * organization_companies includes four BENCHMARK companies (Google,
--    HubSpot, Kickstarter, Salesforce). The entity register
--    (activate_org_settings.entity_names, 20260824140000) keeps them out of
--    the picker.
--
-- The GLOBAL company row (942 location-less responses, the org's largest) is
-- seeded as the US market: GoFundMe is US-headquartered and most of its
-- employees are, and location-less "what's it like to work at GoFundMe"
-- answers are what a US recipient's AI actually returns. The honesty line
-- holds in the wording: US rationale stats deliberately DROP the market
-- clause ("…of AI answers about working at GoFundMe.", not "…in the US"),
-- because the number is measured on the global corpus. The GLOBAL row's small
-- India discovery batch (96 responses) is not folded anywhere.
--
-- Regional platform mix (coverage = % of that market's answers citing the
-- source, aggregated across domain variants):
--   AR  Glassdoor 19.5 · Indeed 8.8 · Reddit 8.4 · YouTube 8.1 · Comparably 5.5
--   GB  Glassdoor 26.9 · Indeed 19.3 · Comparably 15.1 · Blind 9.2
--   IE  Glassdoor 27.3 · Indeed 22.9 · Comparably 12.1 · Blind 5.7 · LinkedIn 5.3
--   MX  YouTube 15.3 · Glassdoor 11.7 · Comparably 5.6 · Indeed 4.3 · Facebook 3.8
--   US  Glassdoor 23.5 · Comparably 14.5 · Indeed 14.3 · LinkedIn 8.3 · Blind 7.9
--
-- Deliberate exclusions (the no-auto-generation rule doing work):
--   * Built In (9.8% US) and Great Place to Work — employer-managed profiles /
--     certification: client-influenced, nothing for a recipient to write.
--   * levels.fyi (4.3% US) — people-generated comp data, but no review
--     mechanic; not a routing destination.
--   * m2crowd (19.6% MX), thecrowdspace, crowdinform etc. — crowdfunding-
--     industry listicles citing GoFundMe the product, not employer pages.
--   * Medium (5.8% US) — individual blog posts, no stable destination.
--
-- Verified cited destinations: Glassdoor employer id E796048 (global, with
-- localized profiles cited on glassdoor.ie / .co.uk / .com.ar), Indeed cmp
-- slug "Gofundme" (www / ie / ar / uk cited; the MX /reviews path is
-- pattern-derived from the verified slug), comparably.com/companies/gofundme
-- (es-MX locale variant cited in Mexico), teamblind.com/company/GoFundMe/reviews.
-- The loudest people-page in the corpus is an r/empleos_AR thread asking
-- "does anyone here work for GoFundMe in Argentina?" (80 citations).
--
-- Consent seeded PENDING: no GoFundMe link is mintable until recorded.

do $$
declare
  v_org uuid := '10dcd559-2f84-4ac6-9f2c-b3661414ae00';
  gd_us text := 'https://www.glassdoor.com/Reviews/GoFundMe-Reviews-E796048.htm';
  cmp text := 'https://www.comparably.com/companies/gofundme';
begin
  if not exists (select 1 from public.organizations where id = v_org) then
    raise notice 'GoFundMe org % not found; skipping Activate seed', v_org;
    return;
  end if;

  insert into public.activate_org_settings (org_id, consent_note, entity_names)
  values (v_org, 'Pending: client consent conversation not yet held', array['GoFundMe'])
  on conflict (org_id) do update set entity_names = excluded.entity_names;

  insert into public.activate_branding
    (org_id, display_name, tagline, blurb, logo_domain, primary_color, accent_color)
  values
    (v_org, 'GoFundMe', 'GoFundMe · Help changes everything',
     'Two questions, and we''ll show you the platforms AI systems actually read about working here.',
     'gofundme.com', '#012D19', '#02A95C')
  on conflict (org_id) do nothing;

  -- ISO code <-> location_context. Prompts for this org mostly carry NULL
  -- location_context (market is the company row), so these rows exist for
  -- cohort-analytics joins and match the plain country names the org's few
  -- located prompts already use ('Argentina', 'United States'). The GLOBAL
  -- row's India batch is deliberately NOT mapped.
  insert into public.activate_market_map (org_id, market_code, location_context)
  values
    (v_org, 'AR', 'Argentina'), (v_org, 'GB', 'United Kingdom'),
    (v_org, 'IE', 'Ireland'), (v_org, 'MX', 'Mexico'), (v_org, 'US', 'United States')
  on conflict do nothing;

  ---------------------------------------------------------------------------
  -- Tier-1 routes. US wording carries no market clause (global corpus stats).
  ---------------------------------------------------------------------------
  insert into public.activate_routes
    (org_id, entity_company_id, market_code, tier, channel, platform,
     destination_url, rationale_stat, rank, active, use_direct_link)
  values
    -- Argentina
    (v_org, null, 'AR', 1, 'review', 'glassdoor', 'https://www.glassdoor.com.ar/Evaluaciones/GoFundMe-Evaluaciones-E796048.htm',
     'Glassdoor shows up in 19.5% of AI answers about working at GoFundMe in Argentina.', 1, true, true),
    (v_org, null, 'AR', 1, 'review', 'indeed', 'https://ar.indeed.com/cmp/Gofundme/reviews',
     'Indeed appears in 8.8% of AI answers about working at GoFundMe in Argentina.', 2, true, true),
    (v_org, null, 'AR', 1, 'review', 'comparably', cmp,
     'Comparably appears in 5.5% of AI answers about working at GoFundMe in Argentina.', 3, true, false),
    (v_org, null, 'AR', 1, 'forum', 'reddit', 'https://www.reddit.com/r/gofundme/',
     'Reddit appears in 8.4% of AI answers about working at GoFundMe in Argentina.', 1, true, false),
    (v_org, null, 'AR', 1, 'social', 'youtube', 'https://www.youtube.com/results?search_query=working+at+GoFundMe',
     'YouTube appears in 8.1% of AI answers about working at GoFundMe in Argentina.', 1, true, false),
    (v_org, null, 'AR', 1, 'social', 'linkedin', 'https://www.linkedin.com/company/gofundme',
     'LinkedIn appears in 4.4% of AI answers about working at GoFundMe in Argentina.', 2, true, false),

    -- United Kingdom
    (v_org, null, 'GB', 1, 'review', 'glassdoor', 'https://www.glassdoor.co.uk/Reviews/GoFundMe-Reviews-E796048.htm',
     'Glassdoor shows up in 26.9% of AI answers about working at GoFundMe in the UK.', 1, true, true),
    (v_org, null, 'GB', 1, 'review', 'indeed', 'https://uk.indeed.com/cmp/Gofundme/reviews',
     'Indeed appears in 19.3% of AI answers about working at GoFundMe in the UK.', 2, true, true),
    (v_org, null, 'GB', 1, 'review', 'comparably', cmp,
     'Comparably appears in 15.1% of AI answers about working at GoFundMe in the UK.', 3, true, false),
    (v_org, null, 'GB', 1, 'forum', 'blind', 'https://www.teamblind.com/company/GoFundMe/reviews',
     'Blind appears in 9.2% of AI answers about working at GoFundMe in the UK.', 1, true, false),
    (v_org, null, 'GB', 1, 'social', 'youtube', 'https://www.youtube.com/results?search_query=working+at+GoFundMe',
     'YouTube appears in 4.4% of AI answers about working at GoFundMe in the UK.', 1, true, false),

    -- Ireland (Dublin is GoFundMe's European base; the Dublin-filtered
    -- Glassdoor page is itself cited 47 times, but the country profile is the
    -- canonical destination)
    (v_org, null, 'IE', 1, 'review', 'glassdoor', 'https://www.glassdoor.ie/Reviews/GoFundMe-Reviews-E796048.htm',
     'Glassdoor shows up in 27.3% of AI answers about working at GoFundMe in Ireland.', 1, true, true),
    (v_org, null, 'IE', 1, 'review', 'indeed', 'https://ie.indeed.com/cmp/Gofundme/reviews',
     'Indeed appears in 22.9% of AI answers about working at GoFundMe in Ireland.', 2, true, true),
    (v_org, null, 'IE', 1, 'review', 'comparably', cmp,
     'Comparably appears in 12.1% of AI answers about working at GoFundMe in Ireland.', 3, true, false),
    (v_org, null, 'IE', 1, 'forum', 'blind', 'https://www.teamblind.com/company/GoFundMe/reviews',
     'Blind appears in 5.7% of AI answers about working at GoFundMe in Ireland.', 1, true, false),
    (v_org, null, 'IE', 1, 'forum', 'reddit', 'https://www.reddit.com/r/gofundme/',
     'Reddit appears in 3.1% of AI answers about working at GoFundMe in Ireland.', 2, true, false),
    (v_org, null, 'IE', 1, 'social', 'linkedin', 'https://www.linkedin.com/company/gofundme',
     'LinkedIn appears in 5.3% of AI answers about working at GoFundMe in Ireland.', 1, true, false),

    -- Mexico (YouTube is the loudest people source in the market;
    -- Glassdoor/Indeed MX paths pattern-derived from the verified E796048 /
    -- "Gofundme" identifiers; the es-MX Comparably locale page is cited)
    (v_org, null, 'MX', 1, 'review', 'glassdoor', 'https://www.glassdoor.com.mx/Evaluaciones/GoFundMe-Evaluaciones-E796048.htm',
     'Glassdoor shows up in 11.7% of AI answers about working at GoFundMe in Mexico.', 1, true, true),
    (v_org, null, 'MX', 1, 'review', 'comparably', 'https://www.comparably.com/es-MX/companies/gofundme',
     'Comparably appears in 5.6% of AI answers about working at GoFundMe in Mexico.', 2, true, false),
    (v_org, null, 'MX', 1, 'review', 'indeed', 'https://mx.indeed.com/cmp/Gofundme/reviews',
     'Indeed appears in 4.3% of AI answers about working at GoFundMe in Mexico.', 3, true, true),
    (v_org, null, 'MX', 1, 'social', 'youtube', 'https://www.youtube.com/results?search_query=working+at+GoFundMe',
     'YouTube shows up in 15.3% of AI answers about working at GoFundMe in Mexico.', 1, true, false),
    (v_org, null, 'MX', 1, 'social', 'facebook', 'https://www.facebook.com/gofundme',
     'Facebook appears in 3.8% of AI answers about working at GoFundMe in Mexico.', 2, true, false),

    -- United States — measured on the org's location-less global corpus, so
    -- every stat sentence deliberately omits "in the US".
    (v_org, null, 'US', 1, 'review', 'glassdoor', gd_us,
     'Glassdoor shows up in 23.5% of AI answers about working at GoFundMe.', 1, true, true),
    (v_org, null, 'US', 1, 'review', 'comparably', cmp,
     'Comparably appears in 14.5% of AI answers about working at GoFundMe.', 2, true, false),
    (v_org, null, 'US', 1, 'review', 'indeed', 'https://www.indeed.com/cmp/Gofundme/reviews',
     'Indeed appears in 14.3% of AI answers about working at GoFundMe.', 3, true, true),
    (v_org, null, 'US', 1, 'forum', 'blind', 'https://www.teamblind.com/company/GoFundMe/reviews',
     'Blind appears in 7.9% of AI answers about working at GoFundMe.', 1, true, false),
    (v_org, null, 'US', 1, 'forum', 'reddit', 'https://www.reddit.com/r/gofundme/',
     'Reddit appears in 6.1% of AI answers about working at GoFundMe.', 2, true, false),
    (v_org, null, 'US', 1, 'social', 'linkedin', 'https://www.linkedin.com/company/gofundme',
     'LinkedIn appears in 8.3% of AI answers about working at GoFundMe.', 1, true, false),
    (v_org, null, 'US', 1, 'social', 'youtube', 'https://www.youtube.com/results?search_query=working+at+GoFundMe',
     'YouTube appears in 6.0% of AI answers about working at GoFundMe.', 2, true, false)
  on conflict (org_id, coalesce(market_code, '--'), platform,
               coalesce(entity_company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set
    destination_url = excluded.destination_url,
    rationale_stat = excluded.rationale_stat,
    tier = excluded.tier,
    channel = excluded.channel,
    rank = excluded.rank,
    use_direct_link = excluded.use_direct_link;

  -- Tier-3 global review fallback (GoFundMe's audience is far wider than the
  -- five measured markets).
  insert into public.activate_routes
    (org_id, entity_company_id, market_code, tier, channel, platform,
     destination_url, rank, active, use_direct_link)
  values
    (v_org, null, null, 3, 'review', 'glassdoor', gd_us, 1, true, true),
    (v_org, null, null, 3, 'review', 'indeed', 'https://www.indeed.com/cmp/Gofundme/reviews', 2, true, true)
  on conflict (org_id, coalesce(market_code, '--'), platform,
               coalesce(entity_company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set
    channel = excluded.channel,
    destination_url = excluded.destination_url,
    rank = excluded.rank,
    use_direct_link = excluded.use_direct_link;

  -- Affinity badges ("your world") — never reorders, never hides.
  update public.activate_routes set
    audience_functions = case when platform in ('reddit','blind')
                              then array['engineering-tech'] else audience_functions end,
    audience_seniority = case when platform = 'linkedin'
                              then array['mid-level','senior','executive']
                              else audience_seniority end
  where org_id = v_org and channel in ('forum','social');

  ---------------------------------------------------------------------------
  -- Per-market theme weights (top 4 attributes by share of the market's
  -- ai_themes). Mission & Purpose and Social Impact carry real weight for
  -- GoFundMe everywhere — Social Impact leads Mexico outright.
  ---------------------------------------------------------------------------
  insert into public.activate_market_themes (org_id, market_code, theme, rank)
  values
    (v_org,'AR','Company Culture',1),(v_org,'AR','Mission & Purpose',2),(v_org,'AR','Rewards & Recognition',3),(v_org,'AR','Social Impact',4),
    (v_org,'GB','Company Culture',1),(v_org,'GB','Mission & Purpose',2),(v_org,'GB','Social Impact',3),(v_org,'GB','Wellbeing & Balance',4),
    (v_org,'IE','Company Culture',1),(v_org,'IE','Mission & Purpose',2),(v_org,'IE','Rewards & Recognition',3),(v_org,'IE','Wellbeing & Balance',4),
    (v_org,'MX','Social Impact',1),(v_org,'MX','Company Culture',2),(v_org,'MX','Mission & Purpose',3),(v_org,'MX','Rewards & Recognition',4),
    (v_org,'US','Mission & Purpose',1),(v_org,'US','Company Culture',2),(v_org,'US','Social Impact',3),(v_org,'US','Rewards & Recognition',4)
  on conflict (org_id, coalesce(market_code, '--'), theme) do nothing;

  -- % of the market's answers citing any routed people-influenced platform.
  insert into public.activate_market_coverage (org_id, market_code, people_pct)
  values
    (v_org,'AR',31.9),(v_org,'GB',40.9),(v_org,'IE',41.0),(v_org,'MX',28.9),(v_org,'US',39.6)
  on conflict (org_id, market_code) do update set
    people_pct = excluded.people_pct, computed_at = now();

  -- The pages AI cites most; labels hand-written from the thread titles.
  insert into public.activate_route_highlights (org_id, market_code, platform, url, label, citations, rank)
  values
    (v_org,'AR','reddit','https://www.reddit.com/r/empleos_AR/comments/1nor5mh/hola_alguien_que_trabaje_para_gofundme_ac%C3%A1_en/','“Does anyone here work for GoFundMe in Argentina?” on r/empleos_AR',80,1),
    (v_org,'US','reddit','https://www.reddit.com/r/csMajors/comments/1piqhot/gofundme_technical_interview/','“GoFundMe technical interview” on r/csMajors',16,1)
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
