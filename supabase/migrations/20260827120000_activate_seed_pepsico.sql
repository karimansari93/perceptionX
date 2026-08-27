-- Activate seed for PepsiCo, curated from the 2026-07 collection (676
-- responses; one company row measured across three location_contexts —
-- Brazil, India, United States — the CSL shape, not the Ford one).
--
-- Two things this corpus is unusually clear about:
--
--  * It is FUNCTION-TARGETED: the prompts carry job_function_context
--    (Merchandising, Data Science & Analytics, Early Careers), and the cited
--    pages show it — US citations are dominated by Merchandiser-filtered
--    Glassdoor/Indeed pages and r/Pepsi merchandiser threads; India's by
--    data-science interview pages. Stats below are honest for the market but
--    weighted toward those cohorts; re-measure before selling them as
--    whole-company numbers.
--  * People-influenced coverage is the highest of any seeded org (US 93.8%,
--    IN 91.3%, BR 73.5%): AI's picture of working at PepsiCo is almost
--    entirely people-generated content.
--
-- Regional platform mix (coverage = % of that market's answers citing the
-- source, aggregated across domain variants):
--   BR  Instagram 49.6 · Glassdoor 42.7 · YouTube 38.1 · Indeed 21.5 ·
--       Facebook 14.6 · LinkedIn 13.1 · InfoJobs 10.8
--   IN  Glassdoor 56.7 · LinkedIn 44.2 · Reddit 36.5 · Indeed 34.1 ·
--       AmbitionBox 33.2 · YouTube 19.2 · Quora 12.5 · Instagram 11.5
--   US  Indeed 76.9 · Glassdoor 54.8 · Reddit 54.8 · YouTube 29.8 ·
--       LinkedIn 16.8 · Facebook 13.5 · Comparably 9.6 · Quora 6.3 · TikTok 5.3
--
-- Instagram leading Brazil (49.6%) is the sharpest social finding across all
-- five seeded orgs; the US Reddit number (54.8%) is carried by r/Pepsi's
-- merchandiser threads, which are seeded as highlights.
--
-- Deliberate exclusions: Great Place to Work (certification,
-- client-influenced), Built In, levels.fyi, Medium (no review mechanic).
--
-- Verified cited destinations: Glassdoor employer id E522 (glassdoor.com.br
-- Avaliações and the India-filtered profile both cited directly), Indeed cmp
-- slug "PepsiCo" (br + www cited; in.indeed /reviews pattern-derived),
-- infojobs.com.br/pepsico-do-brasil-ltda/availacoes,
-- ambitionbox.com/reviews/pepsico-reviews. Comparably slug pattern-derived
-- (only filtered/locale variants appear in citations).
--
-- Consent seeded PENDING: no real PepsiCo link is mintable until recorded.

do $$
declare
  v_org uuid := '4cba160e-dc70-41b6-9158-b36a336c6874';
  gd_us text := 'https://www.glassdoor.com/Reviews/PepsiCo-Reviews-E522.htm';
  cmp text := 'https://www.comparably.com/companies/pepsico';
  li text := 'https://www.linkedin.com/company/pepsico';
  yt text := 'https://www.youtube.com/results?search_query=working+at+PepsiCo';
begin
  if not exists (select 1 from public.organizations where id = v_org) then
    raise notice 'PepsiCo org % not found; skipping Activate seed', v_org;
    return;
  end if;

  -- Single entity today; the register also guards against benchmark
  -- companies being added to the org later.
  insert into public.activate_org_settings (org_id, consent_note, entity_names)
  values (v_org, 'Pending: client consent conversation not yet held', array['PepsiCo'])
  on conflict (org_id) do update set entity_names = excluded.entity_names;

  insert into public.activate_branding
    (org_id, display_name, tagline, blurb, logo_domain, primary_color, accent_color)
  values
    (v_org, 'PepsiCo', 'PepsiCo · Winning with Purpose',
     'Two questions, and we''ll show you the platforms AI systems actually read about working here.',
     'pepsico.com', '#003087', '#009DDC')
  on conflict (org_id) do nothing;

  insert into public.activate_market_map (org_id, market_code, location_context)
  values
    (v_org, 'BR', 'Brazil'), (v_org, 'IN', 'India'), (v_org, 'US', 'United States')
  on conflict do nothing;

  ---------------------------------------------------------------------------
  -- Tier-1 routes. Local platforms (InfoJobs BR, AmbitionBox IN) sort first.
  ---------------------------------------------------------------------------
  insert into public.activate_routes
    (org_id, entity_company_id, market_code, tier, channel, platform,
     destination_url, rationale_stat, is_local, rank, active, use_direct_link)
  values
    -- Brazil
    (v_org, null, 'BR', 1, 'review', 'infojobs', 'https://www.infojobs.com.br/pepsico-do-brasil-ltda/availacoes',
     'InfoJobs appears in 10.8% of AI answers about working at PepsiCo in Brazil.', true, 1, true, false),
    (v_org, null, 'BR', 1, 'review', 'glassdoor', 'https://www.glassdoor.com.br/Avalia%C3%A7%C3%B5es/PepsiCo-Avalia%C3%A7%C3%B5es-E522.htm',
     'Glassdoor shows up in 42.7% of AI answers about working at PepsiCo in Brazil.', false, 2, true, true),
    (v_org, null, 'BR', 1, 'review', 'indeed', 'https://br.indeed.com/cmp/PepsiCo/reviews',
     'Indeed appears in 21.5% of AI answers about working at PepsiCo in Brazil.', false, 3, true, true),
    (v_org, null, 'BR', 1, 'forum', 'reddit', 'https://www.reddit.com/r/Pepsi/',
     'Reddit appears in 3.5% of AI answers about working at PepsiCo in Brazil.', false, 1, true, false),
    (v_org, null, 'BR', 1, 'social', 'instagram', 'https://www.instagram.com/pepsico/',
     'Instagram shows up in 49.6% of AI answers about working at PepsiCo in Brazil.', false, 1, true, false),
    (v_org, null, 'BR', 1, 'social', 'youtube', yt,
     'YouTube appears in 38.1% of AI answers about working at PepsiCo in Brazil.', false, 2, true, false),
    (v_org, null, 'BR', 1, 'social', 'facebook', 'https://www.facebook.com/PepsiCo',
     'Facebook appears in 14.6% of AI answers about working at PepsiCo in Brazil.', false, 3, true, false),
    (v_org, null, 'BR', 1, 'social', 'linkedin', li,
     'LinkedIn appears in 13.1% of AI answers about working at PepsiCo in Brazil.', false, 4, true, false),

    -- India (the India-filtered Glassdoor profile is what the market's
    -- answers cite, like Cloudera's Budapest page)
    (v_org, null, 'IN', 1, 'review', 'ambitionbox', 'https://www.ambitionbox.com/reviews/pepsico-reviews',
     'AmbitionBox shows up in 33.2% of AI answers about working at PepsiCo in India.', true, 1, true, false),
    (v_org, null, 'IN', 1, 'review', 'glassdoor', 'https://www.glassdoor.co.in/Reviews/PepsiCo-India-Reviews-EI_IE522.0,7_IL.8,13_IN115.htm',
     'Glassdoor shows up in 56.7% of AI answers about working at PepsiCo in India.', false, 2, true, true),
    (v_org, null, 'IN', 1, 'review', 'indeed', 'https://in.indeed.com/cmp/PepsiCo/reviews',
     'Indeed appears in 34.1% of AI answers about working at PepsiCo in India.', false, 3, true, true),
    (v_org, null, 'IN', 1, 'review', 'comparably', cmp,
     'Comparably appears in 6.3% of AI answers about working at PepsiCo in India.', false, 4, true, false),
    (v_org, null, 'IN', 1, 'forum', 'reddit', 'https://www.reddit.com/r/IndiaCareers/',
     'Reddit appears in 36.5% of AI answers about working at PepsiCo in India.', false, 1, true, false),
    (v_org, null, 'IN', 1, 'forum', 'quora', 'https://www.quora.com/topic/PepsiCo',
     'Quora appears in 12.5% of AI answers about working at PepsiCo in India.', false, 2, true, false),
    (v_org, null, 'IN', 1, 'social', 'linkedin', li,
     'LinkedIn shows up in 44.2% of AI answers about working at PepsiCo in India.', false, 1, true, false),
    (v_org, null, 'IN', 1, 'social', 'youtube', yt,
     'YouTube appears in 19.2% of AI answers about working at PepsiCo in India.', false, 2, true, false),
    (v_org, null, 'IN', 1, 'social', 'instagram', 'https://www.instagram.com/pepsico/',
     'Instagram appears in 11.5% of AI answers about working at PepsiCo in India.', false, 3, true, false),

    -- United States
    (v_org, null, 'US', 1, 'review', 'indeed', 'https://www.indeed.com/cmp/PepsiCo/reviews',
     'Indeed shows up in 76.9% of AI answers about working at PepsiCo in the US.', false, 1, true, true),
    (v_org, null, 'US', 1, 'review', 'glassdoor', gd_us,
     'Glassdoor appears in 54.8% of AI answers about working at PepsiCo in the US.', false, 2, true, true),
    (v_org, null, 'US', 1, 'review', 'comparably', cmp,
     'Comparably appears in 9.6% of AI answers about working at PepsiCo in the US.', false, 3, true, false),
    (v_org, null, 'US', 1, 'forum', 'reddit', 'https://www.reddit.com/r/Pepsi/',
     'Reddit shows up in 54.8% of AI answers about working at PepsiCo in the US.', false, 1, true, false),
    (v_org, null, 'US', 1, 'forum', 'quora', 'https://www.quora.com/topic/PepsiCo',
     'Quora appears in 6.3% of AI answers about working at PepsiCo in the US.', false, 2, true, false),
    (v_org, null, 'US', 1, 'social', 'youtube', yt,
     'YouTube appears in 29.8% of AI answers about working at PepsiCo in the US.', false, 1, true, false),
    (v_org, null, 'US', 1, 'social', 'linkedin', li,
     'LinkedIn appears in 16.8% of AI answers about working at PepsiCo in the US.', false, 2, true, false),
    (v_org, null, 'US', 1, 'social', 'facebook', 'https://www.facebook.com/PepsiCo',
     'Facebook appears in 13.5% of AI answers about working at PepsiCo in the US.', false, 3, true, false),
    (v_org, null, 'US', 1, 'social', 'tiktok', 'https://www.tiktok.com/@pepsi',
     'TikTok appears in 5.3% of AI answers about working at PepsiCo in the US.', false, 4, true, false),
    (v_org, null, 'US', 1, 'social', 'instagram', 'https://www.instagram.com/pepsico/',
     'Instagram appears in 3.8% of AI answers about working at PepsiCo in the US.', false, 5, true, false)
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

  -- Tier-3 global review fallback (PepsiCo operates in ~200 countries; three
  -- are measured).
  insert into public.activate_routes
    (org_id, entity_company_id, market_code, tier, channel, platform,
     destination_url, rank, active, use_direct_link)
  values
    (v_org, null, null, 3, 'review', 'glassdoor', gd_us, 1, true, true),
    (v_org, null, null, 3, 'review', 'indeed', 'https://www.indeed.com/cmp/PepsiCo/reviews', 2, true, true)
  on conflict (org_id, coalesce(market_code, '--'), platform,
               coalesce(entity_company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set
    channel = excluded.channel,
    destination_url = excluded.destination_url,
    rank = excluded.rank,
    use_direct_link = excluded.use_direct_link;

  -- Affinity badges ("your world") — never reorders, never hides. The US
  -- Reddit conversation is merchandiser-led, so r/Pepsi carries the
  -- manufacturing-ops tag alongside the usual engineering one.
  update public.activate_routes set
    audience_functions = case when platform in ('reddit','blind','quora')
                              then array['engineering-tech','manufacturing-ops']
                              else audience_functions end,
    audience_seniority = case
      when platform in ('instagram','tiktok') then array['early-career']
      when platform = 'linkedin' then array['mid-level','senior','executive']
      else audience_seniority end
  where org_id = v_org and channel in ('forum','social');

  ---------------------------------------------------------------------------
  -- Per-market theme weights (top 4 attributes by share of the market's
  -- ai_themes). Wellbeing & Balance LEADS the US — the merchandiser cohort's
  -- route-work reality — while Career Opportunities leads BR and IN.
  ---------------------------------------------------------------------------
  insert into public.activate_market_themes (org_id, market_code, theme, rank)
  values
    (v_org,'BR','Career Opportunities',1),(v_org,'BR','Company Culture',2),(v_org,'BR','Wellbeing & Balance',3),(v_org,'BR','Inclusion',4),
    (v_org,'IN','Career Opportunities',1),(v_org,'IN','Company Culture',2),(v_org,'IN','Interview Experience',3),(v_org,'IN','Wellbeing & Balance',4),
    (v_org,'US','Wellbeing & Balance',1),(v_org,'US','Compensation',2),(v_org,'US','Company Culture',3),(v_org,'US','Interview Experience',4)
  on conflict (org_id, coalesce(market_code, '--'), theme) do nothing;

  -- % of the market's answers citing any routed people-influenced platform —
  -- the highest of any seeded org.
  insert into public.activate_market_coverage (org_id, market_code, people_pct)
  values
    (v_org,'BR',73.5),(v_org,'IN',91.3),(v_org,'US',93.8)
  on conflict (org_id, market_code) do update set
    people_pct = excluded.people_pct, computed_at = now();

  -- The pages AI cites most; labels hand-written from the thread titles.
  -- Brazil's loudest pages are individual Instagram posts whose content
  -- cannot be verified from the URL, so none are seeded (the rule).
  insert into public.activate_route_highlights (org_id, market_code, platform, url, label, citations, rank)
  values
    (v_org,'US','reddit','https://www.reddit.com/r/Pepsi/comments/1io8xcl/pepsi_merchandiser_whats_your_opinion/','“Pepsi merchandiser — what''s your opinion?” on r/Pepsi',27,1),
    (v_org,'IN','reddit','https://www.reddit.com/r/DataScienceJobs/comments/1tiwd8l/pepsico_data_science_interview_processquestions/','“PepsiCo data science interview process” on r/DataScienceJobs',38,1),
    (v_org,'IN','quora','https://www.quora.com/What-are-the-best-aspects-of-working-at-PepsiCo','“What are the best aspects of working at PepsiCo?” on Quora',9,1)
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
