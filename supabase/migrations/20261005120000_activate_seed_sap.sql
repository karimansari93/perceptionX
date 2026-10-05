-- Activate seed for SAP, curated from the 2026-09-28 collection (1,458
-- responses; one company row measured across three location_contexts —
-- Germany, Japan, United States — the CSL / PepsiCo shape; 5 models,
-- 2 job functions per market).
--
-- Regional platform mix (coverage = % of that market's answers citing the
-- source, aggregated across domain variants):
--   DE  Kununu 41.9 · Glassdoor 34.7 · Indeed 15.3 · LinkedIn 10.0 ·
--       Reddit 9.6 · Comparably 5.3 · Levels.fyi 4.9 · Blind 3.6
--   JP  OpenWork 30.9 · Glassdoor 16.6 · note 14.7 · Indeed 12.7 ·
--       JobTalk 12.5 · Syukatsu Kaigi 12.3 · YouTube 10.0 · OneCareer 9.8 ·
--       OpenMoney 9.2 · LinkedIn 4.5 · Reddit 2.9
--   US  Glassdoor 48.3 · Indeed 28.1 · Comparably 14.0 · LinkedIn 13.4 ·
--       Reddit 12.8 · Blind 6.8 · Levels.fyi 5.8 · YouTube 5.6
-- Any routed platform: DE 72.1 · JP 69.7 · US 76.2.
--
-- Deliberate exclusions:
--   * sap.com, jobs.sap.com, news.sap.com, learning.sap.com,
--     community.sap.com — SAP's own properties (client-influenced).
--   * Built In, Great Place to Work — employer-managed profiles /
--     certification: client-influenced, nothing for a recipient to write.
--   * ZipRecruiter (US) and Xing (DE) — the cited pages are job listings,
--     not somewhere a recipient can write about working here.
--   * Handelsblatt, Computerwoche and the other editorial / recruiter
--     sites — publisher-written, no contribution mechanic.
--
-- Included on purpose: Levels.fyi (a recipient can add a salary or company
-- benefits) and note (a recipient can publish a post). Both go beyond
-- reviews; the rule is "somewhere a person can write about working here".
-- Levels.fyi is left out of Japan (0.6%).
--
-- Verified cited destinations: Kununu /de/sap; Glassdoor employer id E10471
-- (Germany, Tokyo and United States pages cited directly); Indeed de + www
-- cited; OpenWork, JobTalk, Syukatsu Kaigi, OneCareer, OpenMoney company
-- pages cited; Levels.fyi germany / united-states salary pages cited;
-- Comparably, Blind and the LinkedIn company page cited.
-- Pattern-derived (NOT cited as-is, check before a real link goes out):
--   * jp.indeed.com /reviews (the cited page is /interviews)
--   * note.com search URL (the cited pages are other people's posts)
--   * YouTube search URLs (same convention as the other seeded orgs)
--   * subreddit roots (r/cscareerquestionsEU, r/japanlife, r/SAP are the
--     subreddits of cited threads, not the threads themselves)
--
-- Branding: SAP blue #0070F2 and navy #1D2D3E are SAP's published design
-- colours, NOT yet checked against sap.com (the site blocks automated
-- requests). Confirm before a real link goes out.
--
-- Rationale copy uses the 20260827130000 phrasing directly (rounded on the
-- honest side); the measured decimals are in the coverage comment above.
--
-- Consent seeded PENDING: no real SAP link is mintable until recorded.

do $$
declare
  v_org uuid := '0ae9ddfb-bfca-4624-a0e9-2338fa894fbd';
  gd_us text := 'https://www.glassdoor.com/Reviews/SAP-United-States-Reviews-EI_IE10471.0,3_IL.4,17_IN1.htm';
  gd_de text := 'https://www.glassdoor.com/Reviews/SAP-Germany-Reviews-EI_IE10471.0,3_IL.4,11_IN96.htm';
  gd_jp text := 'https://www.glassdoor.com/Reviews/SAP-Tokyo-Reviews-EI_IE10471.0,3_IL.4,9_IM1071.htm';
  li text := 'https://www.linkedin.com/company/sap';
  blind text := 'https://www.teamblind.com/company/SAP/reviews';
  yt text := 'https://www.youtube.com/results?search_query=working+at+SAP';
begin
  if not exists (select 1 from public.organizations where id = v_org) then
    raise notice 'SAP org % not found; skipping Activate seed', v_org;
    return;
  end if;

  -- Single entity today.
  insert into public.activate_org_settings (org_id, consent_note, entity_names)
  values (v_org, 'Pending: client consent conversation not yet held', array['SAP'])
  on conflict (org_id) do update set entity_names = excluded.entity_names;

  insert into public.activate_branding
    (org_id, display_name, tagline, blurb, logo_domain, primary_color, accent_color)
  values
    (v_org, 'SAP', 'SAP · Run simple',
     'Two questions, and we''ll show you the platforms AI systems actually read about working here.',
     'sap.com', '#1D2D3E', '#0070F2')
  on conflict (org_id) do nothing;

  insert into public.activate_market_map (org_id, market_code, location_context)
  values
    (v_org, 'DE', 'Germany'), (v_org, 'JP', 'Japan'), (v_org, 'US', 'United States')
  on conflict do nothing;

  ---------------------------------------------------------------------------
  -- Tier-1 routes. Local platforms (Kununu DE, OpenWork JP) sort first.
  ---------------------------------------------------------------------------
  insert into public.activate_routes
    (org_id, entity_company_id, market_code, tier, channel, platform,
     destination_url, rationale_stat, is_local, rank, active, use_direct_link)
  values
    -- Germany
    (v_org, null, 'DE', 1, 'review', 'kununu', 'https://www.kununu.com/de/sap',
     'Kununu appears in over 40% of AI answers about working at SAP in Germany.', true, 1, true, true),
    (v_org, null, 'DE', 1, 'review', 'glassdoor', gd_de,
     'Glassdoor shows up in nearly 35% of AI answers about working at SAP in Germany.', false, 2, true, true),
    (v_org, null, 'DE', 1, 'review', 'indeed', 'https://de.indeed.com/cmp/SAP/reviews',
     'Indeed appears in over 15% of AI answers about working at SAP in Germany.', false, 3, true, true),
    (v_org, null, 'DE', 1, 'review', 'comparably', 'https://www.comparably.com/de-DE/companies/sap',
     'Comparably appears in around 5% of AI answers about working at SAP in Germany.', false, 4, true, false),
    (v_org, null, 'DE', 1, 'review', 'levels', 'https://www.levels.fyi/companies/sap/salaries/software-engineer/locations/germany',
     'Levels.fyi appears in around 5% of AI answers about working at SAP in Germany.', false, 5, true, false),
    (v_org, null, 'DE', 1, 'forum', 'reddit', 'https://www.reddit.com/r/cscareerquestionsEU/',
     'Reddit appears in around 10% of AI answers about working at SAP in Germany.', false, 1, true, false),
    (v_org, null, 'DE', 1, 'forum', 'blind', blind,
     'Blind appears in around 4% of AI answers about working at SAP in Germany.', false, 2, true, false),
    (v_org, null, 'DE', 1, 'social', 'linkedin', li,
     'LinkedIn appears in 10% of AI answers about working at SAP in Germany.', false, 1, true, false),

    -- Japan (the Tokyo-filtered Glassdoor page is what the market's answers cite)
    (v_org, null, 'JP', 1, 'review', 'openwork', 'https://www.openwork.jp/company_answer.php?m_id=a0910000000G8cX&q_no=2',
     'OpenWork shows up in over 30% of AI answers about working at SAP in Japan.', true, 1, true, true),
    (v_org, null, 'JP', 1, 'review', 'glassdoor', gd_jp,
     'Glassdoor shows up in over 15% of AI answers about working at SAP in Japan.', false, 2, true, true),
    (v_org, null, 'JP', 1, 'review', 'indeed', 'https://jp.indeed.com/cmp/Sap%E3%82%B8%E3%83%A3%E3%83%91%E3%83%B3%E6%A0%AA%E5%BC%8F%E4%BC%9A%E7%A4%BE/reviews',
     'Indeed appears in over 10% of AI answers about working at SAP in Japan.', false, 3, true, true),
    (v_org, null, 'JP', 1, 'review', 'jobtalk', 'https://jobtalk.jp/companies/36695/answers',
     'JobTalk appears in over 10% of AI answers about working at SAP in Japan.', true, 4, true, false),
    (v_org, null, 'JP', 1, 'review', 'syukatsu', 'https://syukatsu-kaigi.jp/companies/123282',
     'Syukatsu Kaigi appears in over 10% of AI answers about working at SAP in Japan.', true, 5, true, false),
    (v_org, null, 'JP', 1, 'review', 'onecareer', 'https://www.onecareer.jp/experiences/companies/727/middle_categories/interview',
     'ONE CAREER appears in around 10% of AI answers about working at SAP in Japan.', true, 6, true, false),
    (v_org, null, 'JP', 1, 'review', 'openmoney', 'https://openmoney.jp/corporations/476',
     'OpenMoney appears in around 9% of AI answers about working at SAP in Japan.', true, 7, true, false),
    (v_org, null, 'JP', 1, 'forum', 'reddit', 'https://www.reddit.com/r/japanlife/',
     'Reddit appears in around 3% of AI answers about working at SAP in Japan.', false, 1, true, false),
    (v_org, null, 'JP', 1, 'social', 'note', 'https://note.com/search?q=SAP&context=note',
     'note shows up in nearly 15% of AI answers about working at SAP in Japan.', true, 1, true, false),
    (v_org, null, 'JP', 1, 'social', 'youtube', yt,
     'YouTube appears in 10% of AI answers about working at SAP in Japan.', false, 2, true, false),
    (v_org, null, 'JP', 1, 'social', 'linkedin', li,
     'LinkedIn appears in around 5% of AI answers about working at SAP in Japan.', false, 3, true, false),

    -- United States
    (v_org, null, 'US', 1, 'review', 'glassdoor', gd_us,
     'Glassdoor shows up in over 45% of AI answers about working at SAP in the US.', false, 1, true, true),
    (v_org, null, 'US', 1, 'review', 'indeed', 'https://www.indeed.com/cmp/SAP/reviews',
     'Indeed appears in over 25% of AI answers about working at SAP in the US.', false, 2, true, true),
    (v_org, null, 'US', 1, 'review', 'comparably', 'https://www.comparably.com/companies/sap/reviews',
     'Comparably appears in nearly 15% of AI answers about working at SAP in the US.', false, 3, true, false),
    (v_org, null, 'US', 1, 'review', 'levels', 'https://www.levels.fyi/companies/sap/salaries/software-engineer/locations/united-states',
     'Levels.fyi appears in around 6% of AI answers about working at SAP in the US.', false, 4, true, false),
    (v_org, null, 'US', 1, 'forum', 'reddit', 'https://www.reddit.com/r/SAP/',
     'Reddit shows up in over 10% of AI answers about working at SAP in the US.', false, 1, true, false),
    (v_org, null, 'US', 1, 'forum', 'blind', blind,
     'Blind appears in around 7% of AI answers about working at SAP in the US.', false, 2, true, false),
    (v_org, null, 'US', 1, 'social', 'linkedin', li,
     'LinkedIn appears in over 10% of AI answers about working at SAP in the US.', false, 1, true, false),
    (v_org, null, 'US', 1, 'social', 'youtube', yt,
     'YouTube appears in around 6% of AI answers about working at SAP in the US.', false, 2, true, false)
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

  -- Tier-3 global review fallback for every market SAP does not measure.
  insert into public.activate_routes
    (org_id, entity_company_id, market_code, tier, channel, platform,
     destination_url, rank, active, use_direct_link)
  values
    (v_org, null, null, 3, 'review', 'glassdoor', gd_us, 1, true, true),
    (v_org, null, null, 3, 'review', 'indeed', 'https://www.indeed.com/cmp/SAP/reviews', 2, true, true)
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
  -- responses). The same four lead all three markets: Company Culture,
  -- Career Opportunities, Wellbeing & Balance, Compensation.
  ---------------------------------------------------------------------------
  insert into public.activate_market_themes (org_id, market_code, theme, rank)
  values
    (v_org,'DE','Company Culture',1),(v_org,'DE','Career Opportunities',2),(v_org,'DE','Wellbeing & Balance',3),(v_org,'DE','Compensation',4),
    (v_org,'JP','Company Culture',1),(v_org,'JP','Career Opportunities',2),(v_org,'JP','Wellbeing & Balance',3),(v_org,'JP','Compensation',4),
    (v_org,'US','Company Culture',1),(v_org,'US','Career Opportunities',2),(v_org,'US','Wellbeing & Balance',3),(v_org,'US','Compensation',4)
  on conflict (org_id, coalesce(market_code, '--'), theme) do nothing;

  -- % of the market's answers citing any routed platform.
  insert into public.activate_market_coverage (org_id, market_code, people_pct)
  values
    (v_org,'DE',72.1),(v_org,'JP',69.7),(v_org,'US',76.2)
  on conflict (org_id, market_code) do update set
    people_pct = excluded.people_pct, computed_at = now();

  -- Internal verification link, matching the other seeded orgs. The consent
  -- gate still blocks minting real links from the UI.
  if not exists (select 1 from public.activate_links where org_id = v_org) then
    insert into public.activate_links (org_id, token, label)
    values (v_org,
            rtrim(translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/', '-_'), '='),
            'Internal build verification (delete me)');
  end if;
end $$;
