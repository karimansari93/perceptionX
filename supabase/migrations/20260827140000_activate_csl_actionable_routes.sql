-- CSL: every platform directly actionable.
--
-- CSL was the first org seeded, before the measured forum/social treatment
-- (20260813100100) and the most-cited highlights existed. Its forum and social
-- rows were the original placeholder set — tier-3 rows pointing at bare
-- homepages (reddit.com, linkedin.com, instagram.com, tiktok.com) — and its
-- Glassdoor/Indeed rows pointed at overview pages rather than the review
-- pages a "Write a review" act should land on. Netflix and Ford got real
-- destinations and threads; CSL, presented to the client, did not.
--
-- Rebuilt from the 2026-07-01 cycle (14,687 responses across the five
-- measured markets), destinations taken from URLs that appear in the
-- citation data:
--
--   * Review pages per market: glassdoor.com.au/Reviews/CSL-Reviews-E27527
--     (399 citations), glassdoor.co.uk (223), glassdoor.de Bewertungen (93),
--     the Swiss-filtered profile (130). Indeed's real slug is Csl-a4a8c9ee,
--     with au/uk/de/ch/www variants all cited. Comparably added where it
--     clears the floor (AU 6.5, GB 4.8, US 14.1).
--   * Entity pages: CSL Behring's own Glassdoor employer E10691035 (171 US
--     citations) and CSL Seqirus's own Indeed profile in the UK (176).
--   * Forum: r/biotech hosts nearly every cited thread — the destination is
--     the community itself, not a search page. Blind's CSL Behring reviews
--     page is the most-cited people page in the US corpus (75) and is kept
--     at ~2% as an engineering-affinity row, per the Ford precedent; the
--     same for Quora in the US, whose single most-cited thread has 62.
--   * Social: LinkedIn leads every market (16-24%); linkedin.com/company/
--     csl-vifor is the single most-cited social page anywhere (523), so CSL
--     Vifor people route to their own page. YouTube is listen-only. Facebook
--     uses the cited corporate page. Instagram and TikTok placeholders are
--     removed: Instagram clears the floor only in AU and no official handle
--     appears in the citations; TikTok never clears 1%.
--   * Highlights: "What's the best biotech company you've worked for?" on
--     r/biotech (79, US), the biotech/pharma "best company" Quora question
--     (62, US), the r/biotech work-life-balance thread (27, GB) and the
--     Aussie/Kiwi job-market thread (25, AU).
--
-- Review-channel rationale stats are left on the earlier baseline the client
-- has seen (already in rounded phrasing); the new rows use 2026-07-01
-- figures. The two cycles differ (Seek AU 34.5 -> 53.4, kununu DE 55.1 ->
-- 60.2); re-baseline the review rows deliberately, with the client.

do $$
declare
  v_org uuid := 'ebbe52ed-0c8e-4d5b-9526-67496e09c6b4';
  v_behring uuid := '0c335544-e9a0-4713-897b-3fd28f315d37';
  v_seqirus uuid := '55cd3939-7ae2-4c8e-8488-c98f47482746';
  v_vifor uuid := '53d125b2-9f1a-4cac-aa85-da1b660306c8';
  gd_global text := 'https://www.glassdoor.com/Reviews/CSL-Reviews-E27527.htm';
  in_global text := 'https://www.indeed.com/cmp/Csl-a4a8c9ee/reviews';
  cmp text := 'https://www.comparably.com/companies/csl-behring/reviews';
  blind text := 'https://www.teamblind.com/company/CSL-Behring/reviews';
  li text := 'https://www.linkedin.com/company/csl';
  li_vifor text := 'https://www.linkedin.com/company/csl-vifor';
  yt text := 'https://www.youtube.com/results?search_query=working+at+CSL';
  fb text := 'https://www.facebook.com/CSLBiopharma';
  rd text := 'https://www.reddit.com/r/biotech/';
begin
  if not exists (select 1 from public.organizations where id = v_org) then
    raise notice 'CSL org % not found; skipping', v_org;
    return;
  end if;

  -- 1. Review pages, not overview pages.
  update public.activate_routes set destination_url = case market_code
      when 'AU' then 'https://www.glassdoor.com.au/Reviews/CSL-Reviews-E27527.htm'
      when 'GB' then 'https://www.glassdoor.co.uk/Reviews/CSL-Reviews-E27527.htm'
      when 'DE' then 'https://www.glassdoor.de/Bewertungen/CSL-Bewertungen-E27527.htm'
      when 'CH' then 'https://www.glassdoor.com/Reviews/CSL-Schweiz-Reviews-EI_IE27527.0,3_IL.4,11_IN226.htm'
      else gd_global end,
    action_label = coalesce(action_label, 'Write a review')
  where org_id = v_org and platform = 'glassdoor' and entity_company_id is null;

  update public.activate_routes set destination_url = case market_code
      when 'AU' then 'https://au.indeed.com/cmp/Csl-a4a8c9ee/reviews'
      when 'GB' then 'https://uk.indeed.com/cmp/Csl-a4a8c9ee/reviews'
      when 'DE' then 'https://de.indeed.com/cmp/Csl-a4a8c9ee/reviews'
      else in_global end,
    action_label = coalesce(action_label, 'Write a review')
  where org_id = v_org and platform = 'indeed' and entity_company_id is null;

  update public.activate_routes set action_label = coalesce(action_label, 'Write a review')
  where org_id = v_org and channel = 'review';

  -- 2. Placeholders out: homepage-only forum/social rows have no act behind them.
  delete from public.activate_routes
  where org_id = v_org and market_code is null and channel in ('forum','social');

  -- 3. Measured review additions and entity-specific pages.
  insert into public.activate_routes
    (org_id, entity_company_id, market_code, tier, channel, platform, destination_url,
     rationale_stat, action_label, rank, active, use_direct_link)
  values
    (v_org, null, 'CH', 1, 'review', 'indeed', 'https://ch.indeed.com/cmp/Csl-a4a8c9ee/reviews',
     'Indeed appears in over 20% of AI answers about working at CSL in Switzerland.', 'Write a review', 3, true, true),
    (v_org, null, 'AU', 1, 'review', 'comparably', cmp,
     'Comparably appears in around 7% of AI answers about working at CSL in Australia.', 'Write a review', 4, true, false),
    (v_org, null, 'GB', 1, 'review', 'comparably', cmp,
     'Comparably appears in around 5% of AI answers about working at CSL in the UK.', 'Write a review', 3, true, false),
    (v_org, null, 'US', 1, 'review', 'comparably', cmp,
     'Comparably appears in over 10% of AI answers about working at CSL in the US.', 'Write a review', 3, true, false),
    (v_org, v_behring, 'US', 1, 'review', 'glassdoor', 'https://www.glassdoor.com/Reviews/CSL-Behring-Reviews-E10691035.htm',
     'Glassdoor appears in 48% of AI answers about working at CSL in the US.', 'Write a review', 2, true, true),
    (v_org, v_seqirus, 'GB', 1, 'review', 'indeed', 'https://uk.indeed.com/cmp/Seqirus-UK/reviews',
     'Indeed appears in over 45% of AI answers about working at CSL in the UK.', 'Write a review', 2, true, true)
  on conflict (org_id, coalesce(market_code,'--'), platform, coalesce(entity_company_id,'00000000-0000-0000-0000-000000000000'::uuid))
  do update set destination_url = excluded.destination_url, rationale_stat = excluded.rationale_stat,
    action_label = excluded.action_label, rank = excluded.rank, use_direct_link = excluded.use_direct_link;

  -- 4. Forum.
  insert into public.activate_routes
    (org_id, entity_company_id, market_code, tier, channel, platform, destination_url,
     rationale_stat, action_label, audience_functions, rank, active, use_direct_link)
  values
    (v_org, null, 'US', 1, 'forum', 'reddit', rd,
     'Reddit appears in nearly 20% of AI answers about working at CSL in the US.', 'Answer a question people are asking', array['engineering-tech','science-rd'], 1, true, false),
    (v_org, null, 'US', 1, 'forum', 'quora', 'https://www.quora.com/search?q=working+at+CSL',
     'Quora appears in around 3% of AI answers about working at CSL in the US.', 'Answer a question about working here', null, 2, true, false),
    (v_org, null, 'US', 1, 'forum', 'blind', blind,
     'Blind appears in around 2% of AI answers about working at CSL in the US.', 'Post as a verified employee', array['engineering-tech'], 3, true, false),
    (v_org, null, 'AU', 1, 'forum', 'reddit', rd,
     'Reddit appears in around 8% of AI answers about working at CSL in Australia.', 'Answer a question people are asking', array['engineering-tech','science-rd'], 1, true, false),
    (v_org, null, 'AU', 1, 'forum', 'blind', blind,
     'Blind appears in around 2% of AI answers about working at CSL in Australia.', 'Post as a verified employee', array['engineering-tech'], 2, true, false),
    (v_org, null, 'GB', 1, 'forum', 'reddit', rd,
     'Reddit appears in around 7% of AI answers about working at CSL in the UK.', 'Answer a question people are asking', array['engineering-tech','science-rd'], 1, true, false)
  on conflict (org_id, coalesce(market_code,'--'), platform, coalesce(entity_company_id,'00000000-0000-0000-0000-000000000000'::uuid))
  do update set destination_url = excluded.destination_url, rationale_stat = excluded.rationale_stat,
    action_label = excluded.action_label, audience_functions = excluded.audience_functions, rank = excluded.rank;

  -- 5. Social, measured per market.
  insert into public.activate_routes
    (org_id, entity_company_id, market_code, tier, channel, platform, destination_url,
     rationale_stat, action_label, is_listen_only, audience_seniority, rank, active, use_direct_link)
  values
    (v_org, null, 'AU', 1, 'social', 'linkedin', li, 'LinkedIn appears in nearly 20% of AI answers about working at CSL in Australia.', 'Post about your work', false, array['mid-level','senior','executive'], 1, true, false),
    (v_org, v_vifor, 'AU', 1, 'social', 'linkedin', li_vifor, 'LinkedIn appears in nearly 20% of AI answers about working at CSL in Australia.', 'Post about your work', false, array['mid-level','senior','executive'], 1, true, false),
    (v_org, null, 'AU', 1, 'social', 'youtube', yt, 'YouTube appears in around 6% of AI answers about working at CSL in Australia.', null, true, null, 2, true, false),
    (v_org, null, 'AU', 1, 'social', 'facebook', fb, 'Facebook appears in around 4% of AI answers about working at CSL in Australia.', 'Post about your work', false, null, 3, true, false),

    (v_org, null, 'CH', 1, 'social', 'linkedin', li, 'LinkedIn appears in over 20% of AI answers about working at CSL in Switzerland.', 'Post about your work', false, array['mid-level','senior','executive'], 1, true, false),
    (v_org, v_vifor, 'CH', 1, 'social', 'linkedin', li_vifor, 'LinkedIn appears in over 20% of AI answers about working at CSL in Switzerland.', 'Post about your work', false, array['mid-level','senior','executive'], 1, true, false),

    (v_org, null, 'DE', 1, 'social', 'linkedin', li, 'LinkedIn appears in over 15% of AI answers about working at CSL in Germany.', 'Post about your work', false, array['mid-level','senior','executive'], 1, true, false),
    (v_org, v_vifor, 'DE', 1, 'social', 'linkedin', li_vifor, 'LinkedIn appears in over 15% of AI answers about working at CSL in Germany.', 'Post about your work', false, array['mid-level','senior','executive'], 1, true, false),
    (v_org, null, 'DE', 1, 'social', 'youtube', yt, 'YouTube appears in over 10% of AI answers about working at CSL in Germany.', null, true, null, 2, true, false),

    (v_org, null, 'GB', 1, 'social', 'linkedin', li, 'LinkedIn appears in nearly 25% of AI answers about working at CSL in the UK.', 'Post about your work', false, array['mid-level','senior','executive'], 1, true, false),
    (v_org, v_vifor, 'GB', 1, 'social', 'linkedin', li_vifor, 'LinkedIn appears in nearly 25% of AI answers about working at CSL in the UK.', 'Post about your work', false, array['mid-level','senior','executive'], 1, true, false),
    (v_org, null, 'GB', 1, 'social', 'youtube', yt, 'YouTube appears in around 6% of AI answers about working at CSL in the UK.', null, true, null, 2, true, false),
    (v_org, null, 'GB', 1, 'social', 'facebook', fb, 'Facebook appears in around 3% of AI answers about working at CSL in the UK.', 'Post about your work', false, null, 3, true, false),

    (v_org, null, 'US', 1, 'social', 'linkedin', li, 'LinkedIn appears in nearly 25% of AI answers about working at CSL in the US.', 'Post about your work', false, array['mid-level','senior','executive'], 1, true, false),
    (v_org, v_vifor, 'US', 1, 'social', 'linkedin', li_vifor, 'LinkedIn appears in nearly 25% of AI answers about working at CSL in the US.', 'Post about your work', false, array['mid-level','senior','executive'], 1, true, false),
    (v_org, null, 'US', 1, 'social', 'youtube', yt, 'YouTube appears in around 9% of AI answers about working at CSL in the US.', null, true, null, 2, true, false),
    (v_org, null, 'US', 1, 'social', 'facebook', fb, 'Facebook appears in around 6% of AI answers about working at CSL in the US.', 'Post about your work', false, null, 3, true, false),

    (v_org, null, null, 3, 'social', 'linkedin', li, null, 'Post about your work', false, array['mid-level','senior','executive'], 1, true, false)
  on conflict (org_id, coalesce(market_code,'--'), platform, coalesce(entity_company_id,'00000000-0000-0000-0000-000000000000'::uuid))
  do update set destination_url = excluded.destination_url, rationale_stat = excluded.rationale_stat,
    action_label = excluded.action_label, is_listen_only = excluded.is_listen_only,
    audience_seniority = excluded.audience_seniority, rank = excluded.rank, tier = excluded.tier, channel = excluded.channel;

  -- 6. The threads AI actually cites — the "Most cited" row on each card.
  insert into public.activate_route_highlights (org_id, market_code, platform, url, label, citations, rank)
  values
    (v_org,'US','reddit','https://www.reddit.com/r/biotech/comments/1gvbpr1/whats_the_best_biotech_company_youve_worked_for/','“What''s the best biotech company you''ve worked for?” on r/biotech',79,1),
    (v_org,'US','quora','https://www.quora.com/Which-is-the-best-company-to-be-an-employee-in-biotech-pharma','“Which is the best company to be an employee in biotech/pharma?” on Quora',62,1),
    (v_org,'GB','reddit','https://www.reddit.com/r/biotech/comments/1ibkhw7/companies_with_good_work_life_balance/','“Companies with good work-life balance” on r/biotech',27,1),
    (v_org,'AU','reddit','https://www.reddit.com/r/biotech/comments/1ljxgmw/to_aussie_and_kiwi_people_how_is_the_current_job/','“Aussies and Kiwis — how is the current job market?” on r/biotech',25,1)
  on conflict (org_id, coalesce(market_code,'--'), platform, url) do update
    set label = excluded.label, citations = excluded.citations, rank = excluded.rank;
end $$;
