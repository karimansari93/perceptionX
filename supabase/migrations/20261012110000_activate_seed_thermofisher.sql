-- Activate seed for Thermo Fisher Scientific, curated from the 2026-09-30 to
-- 2026-10-07 collection (1,760 responses; one company row measured across
-- three location_contexts: Germany 572, Singapore 613, United States 575).
--
-- Regional platform mix (coverage = % of that market's answers citing the
-- source, aggregated across domain variants, e.g. glassdoor.de/.sg/.com):
--   DE  Kununu 50.5 · Glassdoor 38.6 · Indeed 26.7 · Reddit 7.5 ·
--       Comparably 6.3 · Xing 3.7 · LinkedIn 3.1
--   SG  Glassdoor 62.2 · Indeed 52.9 · JobStreet 24.8 · LinkedIn 18.3 ·
--       Reddit 6.5 · Comparably 2.8
--   US  Glassdoor 52.3 · Indeed 46.6 · Comparably 17.2 · Reddit 11.8 ·
--       LinkedIn 8.9 · RepVue 4.3 · AmbitionBox 4.2 · Levels.fyi 2.3 ·
--       Blind 2.1
-- Any routed platform: DE 73.1 · SG 81.6 · US 74.1.
--
-- Deliberate exclusions:
--   * jobs.thermofisher.com, corporate.thermofisher.com, ir.thermofisher.com,
--     thermofisher.com, ppd.com: Thermo Fisher's own properties.
--   * Built In, ZipRecruiter, Xing (DE): employer-managed profiles or job
--     listings, nothing for a recipient to write.
--   * AmbitionBox in the US (4.2%): an India review site; the cited pages are
--     not where a US recipient would write.
--   * Comparably in SG (2.8%), Levels.fyi and Blind in the US (2.3%, 2.1%):
--     under the 3% floor.
--
-- Included on purpose: RepVue (US), a review site for sales teams; Thermo
-- Fisher's US answers lean on sales-rep pages on Glassdoor and Comparably too.
-- JobStreet is Singapore's local review platform.
--
-- Every destination below is a page cited in that market's answers, except:
--   * LinkedIn /company/thermo-fisher-scientific/life is cited in the US only;
--     DE and SG cite job listings and Pulse articles, so they reuse it.
--   * The Reddit thread (r/biotech "anyone here work for Thermo Fisher") is
--     the most-cited thread in all three markets. It dates from 2024: check it
--     still takes replies before a link goes out.
--
-- Rationale copy uses the 20260827130000 phrasing; the measured decimals are
-- in the coverage comment above.

do $$
declare
  v_org uuid := '11ce6833-abe0-496b-8ffb-544a6e0cacc1';
  gd_us text := 'https://www.glassdoor.com/Reviews/Thermo-Fisher-Scientific-Reviews-E658.htm';
  gd_de text := 'https://www.glassdoor.de/Bewertungen/Thermo-Fisher-Scientific-Bewertungen-E658.htm';
  gd_sg text := 'https://www.glassdoor.sg/Reviews/Thermo-Fisher-Scientific-Singapore-Reviews-EI_IE658.0,24_IL.25,34_IM1123.htm';
  li text := 'https://www.linkedin.com/company/thermo-fisher-scientific/life';
  rd text := 'https://www.reddit.com/r/biotech/comments/1bayiug/anyone_here_work_for_thermo_fisher_opinions/';
begin
  if not exists (select 1 from public.organizations where id = v_org) then
    raise notice 'Thermo Fisher org % not found; skipping Activate seed', v_org;
    return;
  end if;

  insert into public.activate_org_settings (org_id, entity_names)
  values (v_org, array['Thermo Fisher Scientific'])
  on conflict (org_id) do update set entity_names = excluded.entity_names;

  -- Branding row already exists (logo, colours from 20261012100000).
  update public.activate_branding set logo_domain = coalesce(logo_domain, 'thermofisher.com')
  where org_id = v_org;

  insert into public.activate_market_map (org_id, market_code, location_context)
  values
    (v_org, 'DE', 'Germany'), (v_org, 'SG', 'Singapore'), (v_org, 'US', 'United States')
  on conflict do nothing;

  ---------------------------------------------------------------------------
  -- Tier-1 routes. Local platforms (Kununu DE, JobStreet SG) are flagged.
  ---------------------------------------------------------------------------
  insert into public.activate_routes
    (org_id, entity_company_id, market_code, tier, channel, platform,
     destination_url, rationale_stat, is_local, rank, active, use_direct_link)
  values
    -- Germany
    (v_org, null, 'DE', 1, 'review', 'kununu', 'https://www.kununu.com/de/thermo-fisher-scientific',
     'Kununu appears in over 50% of AI answers about working at Thermo Fisher Scientific in Germany.', true, 1, true, true),
    (v_org, null, 'DE', 1, 'review', 'glassdoor', gd_de,
     'Glassdoor shows up in nearly 40% of AI answers about working at Thermo Fisher Scientific in Germany.', false, 2, true, true),
    (v_org, null, 'DE', 1, 'review', 'indeed', 'https://de.indeed.com/cmp/Thermo-Fisher-Scientific/reviews',
     'Indeed appears in over 25% of AI answers about working at Thermo Fisher Scientific in Germany.', false, 3, true, true),
    (v_org, null, 'DE', 1, 'review', 'comparably', 'https://www.comparably.com/de-DE/companies/thermo-fisher-scientific',
     'Comparably appears in around 6% of AI answers about working at Thermo Fisher Scientific in Germany.', false, 4, true, false),
    (v_org, null, 'DE', 1, 'forum', 'reddit', rd,
     'Reddit appears in around 8% of AI answers about working at Thermo Fisher Scientific in Germany.', false, 1, true, false),
    (v_org, null, 'DE', 1, 'social', 'linkedin', li,
     'LinkedIn appears in around 3% of AI answers about working at Thermo Fisher Scientific in Germany.', false, 1, true, false),

    -- Singapore
    (v_org, null, 'SG', 1, 'review', 'glassdoor', gd_sg,
     'Glassdoor shows up in over 60% of AI answers about working at Thermo Fisher Scientific in Singapore.', false, 1, true, true),
    (v_org, null, 'SG', 1, 'review', 'indeed', 'https://sg.indeed.com/cmp/Thermo-Fisher-Scientific/reviews',
     'Indeed appears in over 50% of AI answers about working at Thermo Fisher Scientific in Singapore.', false, 2, true, true),
    (v_org, null, 'SG', 1, 'review', 'jobstreet', 'https://sg.jobstreet.com/companies/thermo-fisher-scientific-168556380088252/reviews',
     'JobStreet appears in nearly 25% of AI answers about working at Thermo Fisher Scientific in Singapore.', true, 3, true, true),
    (v_org, null, 'SG', 1, 'forum', 'reddit', rd,
     'Reddit appears in around 7% of AI answers about working at Thermo Fisher Scientific in Singapore.', false, 1, true, false),
    (v_org, null, 'SG', 1, 'social', 'linkedin', li,
     'LinkedIn appears in over 15% of AI answers about working at Thermo Fisher Scientific in Singapore.', false, 1, true, false),

    -- United States
    (v_org, null, 'US', 1, 'review', 'glassdoor', gd_us,
     'Glassdoor shows up in over 50% of AI answers about working at Thermo Fisher Scientific in the US.', false, 1, true, true),
    (v_org, null, 'US', 1, 'review', 'indeed', 'https://www.indeed.com/cmp/Thermo-Fisher-Scientific/reviews',
     'Indeed appears in over 45% of AI answers about working at Thermo Fisher Scientific in the US.', false, 2, true, true),
    (v_org, null, 'US', 1, 'review', 'comparably', 'https://www.comparably.com/companies/thermo-fisher-scientific/reviews',
     'Comparably appears in over 15% of AI answers about working at Thermo Fisher Scientific in the US.', false, 3, true, false),
    (v_org, null, 'US', 1, 'review', 'repvue', 'https://www.repvue.com/companies/ThermoFisherScientific',
     'RepVue appears in around 4% of AI answers about working at Thermo Fisher Scientific in the US.', false, 4, true, false),
    (v_org, null, 'US', 1, 'forum', 'reddit', rd,
     'Reddit shows up in over 10% of AI answers about working at Thermo Fisher Scientific in the US.', false, 1, true, false),
    (v_org, null, 'US', 1, 'social', 'linkedin', li,
     'LinkedIn appears in around 9% of AI answers about working at Thermo Fisher Scientific in the US.', false, 1, true, false)
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

  -- Tier-3 global review fallback for every market Thermo Fisher does not measure.
  insert into public.activate_routes
    (org_id, entity_company_id, market_code, tier, channel, platform,
     destination_url, rank, active, use_direct_link)
  values
    (v_org, null, null, 3, 'review', 'glassdoor', gd_us, 1, true, true),
    (v_org, null, null, 3, 'review', 'indeed', 'https://www.indeed.com/cmp/Thermo-Fisher-Scientific/reviews', 2, true, true)
  on conflict (org_id, coalesce(market_code, '--'), platform,
               coalesce(entity_company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set
    channel = excluded.channel,
    destination_url = excluded.destination_url,
    rank = excluded.rank,
    use_direct_link = excluded.use_direct_link;

  ---------------------------------------------------------------------------
  -- Per-market theme weights (top 4 attributes by share of the market's
  -- responses).
  ---------------------------------------------------------------------------
  insert into public.activate_market_themes (org_id, market_code, theme, rank)
  values
    (v_org,'DE','Company Culture',1),(v_org,'DE','Career Opportunities',2),(v_org,'DE','Wellbeing & Balance',3),(v_org,'DE','Leadership',4),
    (v_org,'SG','Career Opportunities',1),(v_org,'SG','Company Culture',2),(v_org,'SG','Wellbeing & Balance',3),(v_org,'SG','Compensation',4),
    (v_org,'US','Career Opportunities',1),(v_org,'US','Company Culture',2),(v_org,'US','Compensation',3),(v_org,'US','Job Security',4)
  on conflict (org_id, coalesce(market_code, '--'), theme) do nothing;

  -- % of the market's answers citing any routed platform.
  insert into public.activate_market_coverage (org_id, market_code, people_pct)
  values
    (v_org,'DE',73.1),(v_org,'SG',81.6),(v_org,'US',74.1)
  on conflict (org_id, market_code) do update set
    people_pct = excluded.people_pct, computed_at = now();
end $$;
