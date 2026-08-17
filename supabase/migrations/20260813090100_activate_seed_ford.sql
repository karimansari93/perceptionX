-- Activate seed for Ford Motor Company, curated by hand from the 2026-07-01
-- collection cycle (24,990 responses across 18 markets).
--
-- Coverage = % of that market's AI answers citing the source. Routes include
-- only people-influenced platforms at roughly >=10% coverage, max 3 per market,
-- in coverage order. Deliberate exclusions:
--   * Computrabajo (LatAm, 1.6-6.6%): the cited pages are dealer listings and
--     job ads, not Ford review pages. Routing people there achieves nothing.
--   * AmbitionBox outside India (1-4% in AR/BE/FR/ES/VE): cross-market noise;
--     it is an India platform. Comparably shows the same pattern below ~13%.
--   This is the "curate manually, never auto-generate from citation counts"
--   rule doing real work — most-cited != best place for this person to post.
--
-- Destination URLs are taken from URLs that actually appear in the citation
-- data, which surfaced market-specific Glassdoor entities worth preserving:
--   Ford Motor Company E263 (global) · Ford Motor Co of Canada E8205 ·
--   Ford Motor Company UK E152869 · Ford India E152871 ·
--   Ford Argentina E3123922 · Ford Credit E7223 (entity-specific routes).
-- A few locale URLs are pattern-derived from a verified employer id on a
-- verified domain (marked below); spot-check before real distribution.
--
-- Unlike CSL, Ford's German kununu presence is consolidated on a single
-- profile (kununu.com/de/ford-werke, the most-cited German source at 50.0%),
-- so DE ships active rather than gated on profile consolidation.
--
-- Consent is seeded PENDING: no link is mintable for Ford until recorded.

do $$
declare
  v_org uuid := '0af791f6-db6e-4063-95c4-71cd31f8779a';
  -- Ford Credit, per market (entity-specific Glassdoor E7223 routes)
  fc_gb uuid := 'c59dd9af-2b72-4178-8300-d5bb7e005ff2';
  fc_de uuid := '47a71d16-9127-4b85-9b68-a9e4be8ff84b';
  fc_es uuid := 'd3720b35-626b-4293-abd4-1a44d1df7150';
  fc_fr uuid := '7deebd16-7bdd-45cc-a6e6-bb65ba65d019';
  gd_global text := 'https://www.glassdoor.com/Reviews/Ford-Motor-Company-Reviews-E263.htm';
begin
  if not exists (select 1 from public.organizations where id = v_org) then
    raise notice 'Ford org % not found; skipping Activate seed', v_org;
    return;
  end if;

  insert into public.activate_org_settings (org_id, consent_note)
  values (v_org, 'Pending: client consent conversation not yet held')
  on conflict (org_id) do nothing;

  insert into public.activate_branding
    (org_id, display_name, tagline, blurb, logo_domain, primary_color, accent_color)
  values
    (v_org, 'Ford', 'Ford Motor Company · 170,000 people · 6 continents',
     'Two questions, and we''ll show you the platforms AI systems actually read about working here.',
     'ford.com', '#00095B', '#1B7FD3')
  on conflict (org_id) do nothing;

  -- ISO market code <-> confirmed_prompts.location_context. Ford Energy is
  -- measured at sub-national granularity, so two extra rows fold into US.
  insert into public.activate_market_map (org_id, market_code, location_context)
  values
    (v_org, 'AR', 'Argentina'), (v_org, 'AU', 'Australia'), (v_org, 'BE', 'Belgium'),
    (v_org, 'BR', 'Brazil'), (v_org, 'CA', 'Canada'), (v_org, 'CL', 'Chile'),
    (v_org, 'CO', 'Colombia'), (v_org, 'FR', 'France'), (v_org, 'DE', 'Germany'),
    (v_org, 'HU', 'Hungary'), (v_org, 'IN', 'India'), (v_org, 'MX', 'Mexico'),
    (v_org, 'PE', 'Peru'), (v_org, 'RO', 'Romania'), (v_org, 'ES', 'Spain'),
    (v_org, 'GB', 'United Kingdom'), (v_org, 'US', 'United States'),
    (v_org, 'VE', 'Venezuela'),
    (v_org, 'US', 'Dearborn, Michigan'), (v_org, 'US', 'Kentucky')
  on conflict do nothing;

  ---------------------------------------------------------------------------
  -- Review routes (tier 1, measured)
  ---------------------------------------------------------------------------
  insert into public.activate_routes
    (org_id, entity_company_id, market_code, tier, channel, platform,
     destination_url, rationale_stat, rank, active, use_direct_link)
  values
    -- Argentina: Glassdoor 30.3 · Indeed 22.6 (both on Ford Argentina entities)
    (v_org, null, 'AR', 1, 'review', 'glassdoor', 'https://www.glassdoor.com.ar/Evaluaciones/Ford-Argentina-Evaluaciones-E3123922.htm',
     'Glassdoor shows up in 30.3% of AI answers about working at Ford in Argentina.', 1, true, true),
    (v_org, null, 'AR', 1, 'review', 'indeed', 'https://ar.indeed.com/cmp/Ford-Argentina/reviews',
     'Indeed appears in 22.6% of AI answers about working at Ford in Argentina.', 2, true, true),

    -- Australia: Glassdoor 29.4 · Indeed 29.0 · Seek 25.1
    (v_org, null, 'AU', 1, 'review', 'glassdoor', 'https://www.glassdoor.com.au/Reviews/Ford-Motor-Company-Reviews-E263.htm',
     'Glassdoor shows up in 29.4% of AI answers about working at Ford in Australia.', 1, true, true),
    (v_org, null, 'AU', 1, 'review', 'indeed', 'https://au.indeed.com/cmp/Ford-Australia/reviews',
     'Indeed appears in 29.0% of AI answers about working at Ford in Australia.', 2, true, true),
    (v_org, null, 'AU', 1, 'review', 'seek', 'https://www.seek.com.au/companies/ford-motor-company-432621/reviews',
     'Seek appears in 25.1% of AI answers about working at Ford in Australia.', 3, true, false),

    -- Belgium: Glassdoor 28.5 · Indeed 20.4  (glassdoor.be URL pattern-derived)
    (v_org, null, 'BE', 1, 'review', 'glassdoor', 'https://www.glassdoor.be/Reviews/Ford-Motor-Company-Reviews-E263.htm',
     'Glassdoor shows up in 28.5% of AI answers about working at Ford in Belgium.', 1, true, true),
    (v_org, null, 'BE', 1, 'review', 'indeed', 'https://be.indeed.com/cmp/Ford-Motor-Company/reviews',
     'Indeed appears in 20.4% of AI answers about working at Ford in Belgium.', 2, true, true),

    -- Brazil: Glassdoor 31.2 · Indeed 18.6 · InfoJobs 9.9
    (v_org, null, 'BR', 1, 'review', 'glassdoor', 'https://www.glassdoor.com.br/Avalia%C3%A7%C3%B5es/Ford-Motor-Company-Brasil-Avalia%C3%A7%C3%B5es-EI_IE263.0%2C18_IL.19%2C25_IN36.htm',
     'Glassdoor shows up in 31.2% of AI answers about working at Ford in Brazil.', 1, true, true),
    (v_org, null, 'BR', 1, 'review', 'indeed', 'https://br.indeed.com/cmp/Ford-Motor-Company/reviews',
     'Indeed appears in 18.6% of AI answers about working at Ford in Brazil.', 2, true, true),
    (v_org, null, 'BR', 1, 'review', 'infojobs', 'https://www.infojobs.com.br/ford-motor-company/availacoes',
     'InfoJobs appears in 9.9% of AI answers about working at Ford in Brazil.', 3, true, false),

    -- Canada: Indeed 36.3 · Glassdoor 28.8 (Ford Motor Co of Canada, E8205)
    (v_org, null, 'CA', 1, 'review', 'indeed', 'https://ca.indeed.com/cmp/Ford-Motor-Company/reviews',
     'Indeed shows up in 36.3% of AI answers about working at Ford in Canada.', 1, true, true),
    (v_org, null, 'CA', 1, 'review', 'glassdoor', 'https://www.glassdoor.ca/Reviews/Ford-Motor-Co-of-Canada-Reviews-E8205.htm',
     'Glassdoor appears in 28.8% of AI answers about working at Ford in Canada.', 2, true, true),

    -- Chile: Indeed 37.3 · Glassdoor 24.8
    (v_org, null, 'CL', 1, 'review', 'indeed', 'https://cl.indeed.com/cmp/Ford-Motor-Company/reviews',
     'Indeed shows up in 37.3% of AI answers about working at Ford in Chile.', 1, true, true),
    (v_org, null, 'CL', 1, 'review', 'glassdoor', gd_global,
     'Glassdoor appears in 24.8% of AI answers about working at Ford in Chile.', 2, true, true),

    -- Colombia: Indeed 33.9 · Glassdoor 26.2
    (v_org, null, 'CO', 1, 'review', 'indeed', 'https://co.indeed.com/cmp/Ford-Motor-Company/reviews',
     'Indeed shows up in 33.9% of AI answers about working at Ford in Colombia.', 1, true, true),
    (v_org, null, 'CO', 1, 'review', 'glassdoor', gd_global,
     'Glassdoor appears in 26.2% of AI answers about working at Ford in Colombia.', 2, true, true),

    -- France: Glassdoor 32.5 · Indeed 22.1
    (v_org, null, 'FR', 1, 'review', 'glassdoor', 'https://www.glassdoor.fr/Avis/Ford-Motor-Company-Avis-E263.htm',
     'Glassdoor shows up in 32.5% of AI answers about working at Ford in France.', 1, true, true),
    (v_org, null, 'FR', 1, 'review', 'indeed', 'https://fr.indeed.com/cmp/Ford-Motor-Company/reviews',
     'Indeed appears in 22.1% of AI answers about working at Ford in France.', 2, true, true),

    -- Germany: kununu 50.0 · Glassdoor 21.9 · Indeed 15.1
    (v_org, null, 'DE', 1, 'review', 'kununu', 'https://www.kununu.com/de/ford-werke',
     'kununu shows up in 50.0% of AI answers about working at Ford in Germany.', 1, true, false),
    (v_org, null, 'DE', 1, 'review', 'glassdoor', 'https://www.glassdoor.de/Bewertungen/Ford-Motor-Company-Bewertungen-E263.htm',
     'Glassdoor appears in 21.9% of AI answers about working at Ford in Germany.', 2, true, true),
    (v_org, null, 'DE', 1, 'review', 'indeed', 'https://de.indeed.com/cmp/Ford-Motor-Company/reviews',
     'Indeed appears in 15.1% of AI answers about working at Ford in Germany.', 3, true, true),

    -- Hungary: Glassdoor 26.4 · Indeed 18.7 · profession.hu 9.8
    (v_org, null, 'HU', 1, 'review', 'glassdoor', gd_global,
     'Glassdoor shows up in 26.4% of AI answers about working at Ford in Hungary.', 1, true, true),
    (v_org, null, 'HU', 1, 'review', 'indeed', 'https://hu.indeed.com/cmp/Ford-Motor-Company',
     'Indeed appears in 18.7% of AI answers about working at Ford in Hungary.', 2, true, true),
    (v_org, null, 'HU', 1, 'review', 'profession', 'https://www.profession.hu/cegek/ford-kozep-es-kelet-europai-kft/velemenyek',
     'Profession.hu appears in 9.8% of AI answers about working at Ford in Hungary.', 3, true, false),

    -- India: Glassdoor 36.9 · AmbitionBox 34.4 · Indeed 20.3 (Ford India E152871)
    (v_org, null, 'IN', 1, 'review', 'glassdoor', 'https://www.glassdoor.co.in/Reviews/Ford-India-Reviews-E152871.htm',
     'Glassdoor shows up in 36.9% of AI answers about working at Ford in India.', 1, true, true),
    (v_org, null, 'IN', 1, 'review', 'ambitionbox', 'https://www.ambitionbox.com/reviews/ford-motor-reviews',
     'AmbitionBox appears in 34.4% of AI answers about working at Ford in India.', 2, true, false),
    (v_org, null, 'IN', 1, 'review', 'indeed', 'https://in.indeed.com/cmp/Ford-Motor-Company/reviews',
     'Indeed appears in 20.3% of AI answers about working at Ford in India.', 3, true, true),

    -- Mexico: Indeed 32.0 · Glassdoor 29.6
    (v_org, null, 'MX', 1, 'review', 'indeed', 'https://mx.indeed.com/cmp/Ford-Motor-Company/reviews',
     'Indeed shows up in 32.0% of AI answers about working at Ford in Mexico.', 1, true, true),
    (v_org, null, 'MX', 1, 'review', 'glassdoor', 'https://www.glassdoor.com.mx/Evaluaciones/Ford-Motor-Company-Evaluaciones-E263.htm',
     'Glassdoor appears in 29.6% of AI answers about working at Ford in Mexico.', 2, true, true),

    -- Peru: Indeed 30.5 · Glassdoor 22.8
    (v_org, null, 'PE', 1, 'review', 'indeed', 'https://pe.indeed.com/cmp/Ford-Motor-Company/reviews',
     'Indeed shows up in 30.5% of AI answers about working at Ford in Peru.', 1, true, true),
    (v_org, null, 'PE', 1, 'review', 'glassdoor', gd_global,
     'Glassdoor appears in 22.8% of AI answers about working at Ford in Peru.', 2, true, true),

    -- Romania: Glassdoor 24.8 · undelucram.ro 21.9 · Indeed 16.4
    (v_org, null, 'RO', 1, 'review', 'glassdoor', gd_global,
     'Glassdoor shows up in 24.8% of AI answers about working at Ford in Romania.', 1, true, true),
    (v_org, null, 'RO', 1, 'review', 'undelucram', 'https://www.undelucram.ro/ro/evaluari-ford-romania-totul-despre-mediul-de-lucru-interviu-1056',
     'Undelucram.ro appears in 21.9% of AI answers about working at Ford in Romania.', 2, true, false),
    (v_org, null, 'RO', 1, 'review', 'indeed', 'https://ro.indeed.com/cmp/Ford-Motor-Company/reviews',
     'Indeed appears in 16.4% of AI answers about working at Ford in Romania.', 3, true, true),

    -- Spain: Glassdoor 29.1 · Indeed 24.8
    (v_org, null, 'ES', 1, 'review', 'glassdoor', 'https://www.glassdoor.es/Opiniones/Ford-Motor-Company-Opiniones-E263.htm',
     'Glassdoor shows up in 29.1% of AI answers about working at Ford in Spain.', 1, true, true),
    (v_org, null, 'ES', 1, 'review', 'indeed', 'https://es.indeed.com/cmp/Ford-Motor-Company/reviews',
     'Indeed appears in 24.8% of AI answers about working at Ford in Spain.', 2, true, true),

    -- United Kingdom: Glassdoor 42.5 · Indeed 29.0 (Ford Motor Company UK E152869)
    (v_org, null, 'GB', 1, 'review', 'glassdoor', 'https://www.glassdoor.co.uk/Reviews/Ford-Motor-Company-UK-Reviews-E152869.htm',
     'Glassdoor shows up in 42.5% of AI answers about working at Ford in the UK.', 1, true, true),
    (v_org, null, 'GB', 1, 'review', 'indeed', 'https://uk.indeed.com/cmp/Ford-Motor-Company/reviews',
     'Indeed appears in 29.0% of AI answers about working at Ford in the UK.', 2, true, true),

    -- United States: Glassdoor 31.3 · Indeed 29.6 · Comparably 13.4
    (v_org, null, 'US', 1, 'review', 'glassdoor', gd_global,
     'Glassdoor shows up in 31.3% of AI answers about working at Ford in the US.', 1, true, true),
    (v_org, null, 'US', 1, 'review', 'indeed', 'https://www.indeed.com/cmp/Ford-Motor-Company/reviews',
     'Indeed appears in 29.6% of AI answers about working at Ford in the US.', 2, true, true),
    (v_org, null, 'US', 1, 'review', 'comparably', 'https://www.comparably.com/companies/ford-motor-company',
     'Comparably appears in 13.4% of AI answers about working at Ford in the US.', 3, true, false),

    -- Venezuela: Indeed 33.8 · Glassdoor 27.8
    (v_org, null, 'VE', 1, 'review', 'indeed', 'https://ve.indeed.com/cmp/Ford-Motor-Company/reviews',
     'Indeed shows up in 33.8% of AI answers about working at Ford in Venezuela.', 1, true, true),
    (v_org, null, 'VE', 1, 'review', 'glassdoor', gd_global,
     'Glassdoor appears in 27.8% of AI answers about working at Ford in Venezuela.', 2, true, true),

    -- Ford Credit has its own Glassdoor employer (E7223) cited in these
    -- markets, so a Ford Credit recipient is routed to their own reviews
    -- rather than the parent company's. ES/FR URLs verified in citations;
    -- DE/GB pattern-derived from the verified employer id.
    (v_org, fc_es, 'ES', 1, 'review', 'glassdoor', 'https://www.glassdoor.es/Opiniones/Ford-Credit-Opiniones-E7223.htm',
     'Glassdoor shows up in 29.1% of AI answers about working at Ford in Spain.', 1, true, true),
    (v_org, fc_fr, 'FR', 1, 'review', 'glassdoor', 'https://www.glassdoor.fr/Avis/Ford-Credit-Avis-E7223.htm',
     'Glassdoor shows up in 32.5% of AI answers about working at Ford in France.', 1, true, true),
    (v_org, fc_de, 'DE', 1, 'review', 'glassdoor', 'https://www.glassdoor.de/Bewertungen/Ford-Credit-Bewertungen-E7223.htm',
     'Glassdoor appears in 21.9% of AI answers about working at Ford in Germany.', 2, true, true),
    (v_org, fc_gb, 'GB', 1, 'review', 'glassdoor', 'https://www.glassdoor.co.uk/Reviews/Ford-Credit-Reviews-E7223.htm',
     'Glassdoor shows up in 42.5% of AI answers about working at Ford in the UK.', 1, true, true)
  on conflict (org_id, coalesce(market_code, '--'), platform,
               coalesce(entity_company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set
    destination_url = excluded.destination_url,
    rationale_stat = excluded.rationale_stat,
    tier = excluded.tier,
    channel = excluded.channel,
    rank = excluded.rank,
    use_direct_link = excluded.use_direct_link;

  ---------------------------------------------------------------------------
  -- Tier-3 global review fallback. Without these, a recipient in a market we
  -- do not measure (Ford's footprint is far wider than the 18 measured here)
  -- reaches the routes screen with the generic heading and no platforms.
  ---------------------------------------------------------------------------
  insert into public.activate_routes
    (org_id, entity_company_id, market_code, tier, channel, platform,
     destination_url, rank, active, use_direct_link)
  values
    (v_org, null, null, 3, 'review', 'glassdoor', gd_global, 1, true, true),
    (v_org, null, null, 3, 'review', 'indeed', 'https://www.indeed.com/cmp/Ford-Motor-Company/reviews', 2, true, true)
  on conflict (org_id, coalesce(market_code, '--'), platform,
               coalesce(entity_company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set
    channel = excluded.channel,
    destination_url = excluded.destination_url,
    rank = excluded.rank,
    use_direct_link = excluded.use_direct_link;

  ---------------------------------------------------------------------------
  -- Social routes (tier 3, global). Blind carries an engineering affinity —
  -- Ford's technical population is large and Blind is cited at 2.3% in the US.
  ---------------------------------------------------------------------------
  insert into public.activate_routes
    (org_id, entity_company_id, market_code, tier, channel, platform, destination_url,
     fit_note, audience_functions, audience_seniority, rank, active, use_direct_link)
  values
    (v_org, null, null, 3, 'social', 'linkedin', 'https://www.linkedin.com',
     'Public posts from people at a company shape how AI describes it.',
     null, array['mid-level','senior','executive'], 1, true, false),
    (v_org, null, null, 3, 'social', 'reddit', 'https://www.reddit.com',
     'Where employees and candidates compare notes in the open.',
     array['engineering-tech','manufacturing-ops'], null, 2, true, false),
    (v_org, null, null, 3, 'social', 'blind', 'https://www.teamblind.com',
     'Verified-employee discussion, heavily technical.',
     array['engineering-tech'], null, 3, true, false),
    (v_org, null, null, 3, 'social', 'instagram', 'https://www.instagram.com',
     'Everyday culture content AI increasingly reads.',
     null, array['early-career'], 4, true, false),
    (v_org, null, null, 3, 'social', 'tiktok', 'https://www.tiktok.com',
     'Where younger candidates ask what jobs are really like.',
     null, array['early-career'], 5, true, false)
  on conflict (org_id, coalesce(market_code, '--'), platform,
               coalesce(entity_company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set
    channel = excluded.channel,
    destination_url = excluded.destination_url,
    fit_note = excluded.fit_note,
    audience_functions = excluded.audience_functions,
    audience_seniority = excluded.audience_seniority,
    rank = excluded.rank;

  ---------------------------------------------------------------------------
  -- Per-market theme weights (top 4 attributes by share of that market's
  -- themes, 2026-07-01). Topic visibility only — never sentiment direction.
  -- Regional variation is real: Job Security ranks 2nd in Germany, Career
  -- Opportunities leads Romania, Compensation ranks 2nd in the US.
  ---------------------------------------------------------------------------
  insert into public.activate_market_themes (org_id, market_code, theme, rank)
  values
    (v_org,'AR','Company Culture',1),(v_org,'AR','Career Opportunities',2),(v_org,'AR','Mission, Purpose & Impact',3),(v_org,'AR','Innovation',4),
    (v_org,'AU','Company Culture',1),(v_org,'AU','Mission, Purpose & Impact',2),(v_org,'AU','Career Opportunities',3),(v_org,'AU','Wellbeing & Balance',4),
    (v_org,'BE','Company Culture',1),(v_org,'BE','Career Opportunities',2),(v_org,'BE','Wellbeing & Balance',3),(v_org,'BE','Compensation',4),
    (v_org,'BR','Company Culture',1),(v_org,'BR','Career Opportunities',2),(v_org,'BR','Mission, Purpose & Impact',3),(v_org,'BR','Innovation',4),
    (v_org,'CA','Company Culture',1),(v_org,'CA','Career Opportunities',2),(v_org,'CA','Mission, Purpose & Impact',3),(v_org,'CA','Wellbeing & Balance',4),
    (v_org,'CL','Company Culture',1),(v_org,'CL','Career Opportunities',2),(v_org,'CL','Mission, Purpose & Impact',3),(v_org,'CL','Interview Experience',4),
    (v_org,'CO','Company Culture',1),(v_org,'CO','Career Opportunities',2),(v_org,'CO','Mission, Purpose & Impact',3),(v_org,'CO','Compensation',4),
    (v_org,'FR','Company Culture',1),(v_org,'FR','Career Opportunities',2),(v_org,'FR','Wellbeing & Balance',3),(v_org,'FR','Mission, Purpose & Impact',4),
    (v_org,'DE','Company Culture',1),(v_org,'DE','Job Security',2),(v_org,'DE','Compensation',3),(v_org,'DE','Mission, Purpose & Impact',4),
    (v_org,'HU','Company Culture',1),(v_org,'HU','Career Opportunities',2),(v_org,'HU','Wellbeing & Balance',3),(v_org,'HU','Mission, Purpose & Impact',4),
    (v_org,'IN','Company Culture',1),(v_org,'IN','Career Opportunities',2),(v_org,'IN','Wellbeing & Balance',3),(v_org,'IN','Mission, Purpose & Impact',4),
    (v_org,'MX','Company Culture',1),(v_org,'MX','Career Opportunities',2),(v_org,'MX','Mission, Purpose & Impact',3),(v_org,'MX','Wellbeing & Balance',4),
    (v_org,'PE','Company Culture',1),(v_org,'PE','Mission, Purpose & Impact',2),(v_org,'PE','Career Opportunities',3),(v_org,'PE','Interview Experience',4),
    (v_org,'RO','Career Opportunities',1),(v_org,'RO','Mission, Purpose & Impact',2),(v_org,'RO','Company Culture',3),(v_org,'RO','Compensation',4),
    (v_org,'ES','Company Culture',1),(v_org,'ES','Career Opportunities',2),(v_org,'ES','Compensation',3),(v_org,'ES','Wellbeing & Balance',4),
    (v_org,'GB','Company Culture',1),(v_org,'GB','Career Opportunities',2),(v_org,'GB','Wellbeing & Balance',3),(v_org,'GB','Compensation',4),
    (v_org,'US','Company Culture',1),(v_org,'US','Compensation',2),(v_org,'US','Mission, Purpose & Impact',3),(v_org,'US','Wellbeing & Balance',4),
    (v_org,'VE','Company Culture',1),(v_org,'VE','Mission, Purpose & Impact',2),(v_org,'VE','Career Opportunities',3),(v_org,'VE','Interview Experience',4)
  on conflict (org_id, coalesce(market_code, '--'), theme) do nothing;
end $$;
