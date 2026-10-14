-- Thermo Fisher Scientific, Q3 2026 baseline: report snapshot, four actions,
-- two watch items, and the baseline check row for each.
-- Organization: ThermoFisher Scientific (11ce6833-abe0-496b-8ffb-544a6e0cacc1).
-- Company:      Thermo Fisher Scientific (74179bad-6411-44fc-9c89-e10868472924).
--
-- Every figure was re-run against prompt_responses / ai_themes /
-- company_relevance_scores_mv on 2026-10-14 (collection_cycle 2026-09-01,
-- Germany Operations excluded) and matches the Q3 2026 baseline report.
-- Peer figures merge name variants containing IQVIA, ICON and Parexel.
-- Stored text: percentages only, no em dashes, no other PerceptionX clients.
-- Idempotent: re-running updates the same rows (keys below).
-- Applied 2026-10-14 with Karim's approval, which is also his sign-off on these figures.

-- ─── Snapshot ───────────────────────────────────────────────────────────────
INSERT INTO public.client_report_snapshots
  (organization_id, company_id, cycle, period_label, report_type, scope, headline, metric_status, breakdowns,
   as_of, source_report_name, signed_off_by, signed_off_on, published_at)
VALUES (
  '11ce6833-abe0-496b-8ffb-544a6e0cacc1', '74179bad-6411-44fc-9c89-e10868472924',
  '2026-09-01', 'Q3 2026', 'baseline',
  $j${
    "markets": [
      {"market": "United States", "functions": ["Functional Service Provider", "Sales"]},
      {"market": "Singapore", "functions": ["Research and Development", "Clinical Research"]},
      {"market": "Germany", "functions": ["Clinical Research"]}
    ],
    "excluded": [{"market": "Germany", "function": "Operations", "reason": "Collected but excluded at the client's request."}],
    "assistants": ["ChatGPT", "Perplexity", "Google AI Overviews", "Google AI Mode", "Claude", "DeepSeek"],
    "assistant_notes": "DeepSeek is included for this client only.",
    "brand_aliases": ["PPD", "Patheon", "Fisher Scientific"],
    "brand_alias_note": "Answers naming PPD, Patheon or Fisher Scientific count as Thermo Fisher.",
    "collection": {"cycle": "2026-09-01", "window": "One run, 30 Sep to 1 Oct 2026; DeepSeek added 7 Oct 2026.", "first_cycle": true}
  }$j$::jsonb,
  $j${"overall_score": 68, "sentiment_pct": 62, "visibility_pct": 68, "relevance": 85}$j$::jsonb,
  $j${
    "visibility":    {"status": "final", "since": "2026-10-13", "reason": "Brand aliases applied 13 Oct 2026."},
    "sentiment":     {"status": "provisional", "reason": "Themes are not yet on one classifier version. Final once themes are re-run on a single version."},
    "overall_score": {"status": "provisional", "reason": "Half of the overall score is sentiment, which is provisional."}
  }$j$::jsonb,
  $j${
    "visibility_by_market": [
      {"market": "Germany", "function": "Clinical Research", "pct": 38, "rank": 4,
       "peers_ahead": [{"name": "IQVIA", "pct": 74}, {"name": "ICON", "pct": 54}, {"name": "Parexel", "pct": 46}]},
      {"market": "Singapore", "pct": 71, "rank": 1},
      {"market": "United States", "pct": 81, "rank": 1}
    ],
    "attribute_sentiment": {"scope": "All markets", "rows": [
      {"attribute": "Mission", "pct": 97}, {"attribute": "Innovation", "pct": 86},
      {"attribute": "Interview Experience", "pct": 82}, {"attribute": "Inclusion", "pct": 80},
      {"attribute": "Onboarding", "pct": 75}, {"attribute": "Career Opportunities", "pct": 69},
      {"attribute": "Company Culture", "pct": 59}, {"attribute": "Wellbeing and Balance", "pct": 53},
      {"attribute": "Job Security", "pct": 50}, {"attribute": "Compensation", "pct": 46},
      {"attribute": "Application and Communication", "pct": 44}, {"attribute": "Leadership", "pct": 29}
    ]},
    "sources": {"measure": "Share of answers citing the source at least once", "rows": [
      {"market": "All markets", "source": "Glassdoor", "pct": 54},
      {"market": "All markets", "source": "Indeed", "pct": 45},
      {"market": "All markets", "source": "Thermo Fisher careers site", "pct": 43},
      {"market": "Germany", "source": "Thermo Fisher careers site", "pct": 50},
      {"market": "Germany", "source": "kununu", "pct": 46},
      {"market": "Singapore", "source": "Glassdoor", "pct": 62},
      {"market": "Singapore", "source": "Indeed", "pct": 53},
      {"market": "Singapore", "source": "Thermo Fisher careers site", "pct": 40},
      {"market": "Singapore", "source": "JobStreet", "pct": 25},
      {"market": "United States", "source": "Comparably", "pct": 17},
      {"market": "United States", "source": "Reddit", "pct": 12}
    ]}
  }$j$::jsonb,
  '2026-10-13', 'Thermo Fisher Scientific, Q3 2026 baseline report', 'Karim Al Ansari', '2026-10-14', now()
)
ON CONFLICT (organization_id, cycle, report_type) DO UPDATE SET
  scope = EXCLUDED.scope, headline = EXCLUDED.headline, metric_status = EXCLUDED.metric_status,
  breakdowns = EXCLUDED.breakdowns, as_of = EXCLUDED.as_of, source_report_name = EXCLUDED.source_report_name,
  signed_off_by = EXCLUDED.signed_off_by, signed_off_on = EXCLUDED.signed_off_on,
  published_at = COALESCE(client_report_snapshots.published_at, EXCLUDED.published_at);

-- ─── Actions and watch items ────────────────────────────────────────────────
INSERT INTO public.company_actions
  (organization_id, company_id, key, period_label, register, editorial_status, work_kind, title,
   cycle_raised, action_number, problem, ai_says, ai_reads, urls, recommendation, lanes, timing, lifts,
   proof_status, verified_facts, owner_name, tracking_status, markets, functions,
   source_name, source_domain, notes, published_at)
VALUES
(
  '11ce6833-abe0-496b-8ffb-544a6e0cacc1', '74179bad-6411-44fc-9c89-e10868472924',
  '2026-09-01:01', 'Q3 2026', 'act_now', 'new', 'owned_content',
  'Add response times and a feedback promise to the German interview guide page',
  '2026-09-01', 1,
  'Application and communication is 24% positive in Germany (76% negative), against 56% in Singapore and 46% in the United States.',
  'Candidates are ghosted, get no feedback, and HR is slow.',
  $j$[{"source": "kununu candidate reviews", "market": "Germany", "coverage_pct": 65, "url": "https://www.kununu.com/de/thermo-fisher-scientific/bewerbung"},
      {"source": "Thermo Fisher careers site", "market": "Germany", "coverage_pct": 41, "url": "https://jobs.thermofisher.com/de/de/interview-resources"}]$j$::jsonb,
  ARRAY['https://jobs.thermofisher.com/de/de/interview-resources', 'https://www.kununu.com/de/thermo-fisher-scientific/bewerbung'],
  'HR sets a response time for each hiring stage and publishes it in German on the interview guide page. The talent team replies to candidate reviews on kununu.',
  ARRAY['business', 'owned', 'people'], 'act_next',
  $j$[{"metric": "Sentiment", "attribute": "Application and Communication", "market": "Germany"}]$j$::jsonb,
  NULL,
  $j$[{"fact": "The German interview guide page lists four hiring stages and gives no response times.", "checked_on": "2026-10-12"},
      {"fact": "The kununu profile is claimed by Thermo Fisher and has no employer comments.", "checked_on": "2026-10-12"}]$j$::jsonb,
  NULL, 'open', ARRAY['Germany'], ARRAY['Clinical Research'],
  'kununu', 'kununu.com',
  'Coverage figures are the share of German answers with negative application and communication themes that cite the source.',
  now()
),
(
  '11ce6833-abe0-496b-8ffb-544a6e0cacc1', '74179bad-6411-44fc-9c89-e10868472924',
  '2026-09-01:02', 'Q3 2026', 'act_now', 'new', 'owned_content',
  'Put Singapore pay facts where AI reads them, and reply to pay reviews',
  '2026-09-01', 2,
  'Compensation is 33% positive in Singapore (67% negative), against 57% in the United States. The markets cover different functions, so the comparison is directional.',
  'Base pay is below market and increments are slow, mostly from R&D engineers; benefits are praised.',
  $j$[{"source": "Glassdoor reviews", "market": "Singapore", "coverage_pct": 83},
      {"source": "Indeed reviews", "market": "Singapore", "coverage_pct": 78},
      {"source": "JobStreet", "market": "Singapore", "coverage_pct": 52}]$j$::jsonb,
  '{}',
  'Add salary ranges and a benefits line to Singapore R&D and clinical ads on jobs.thermofisher.com. On the JobStreet Life and Culture page, replace "Competitive salary" with pay cycle, bonus and increment specifics, and make the JobStreet About page specific to Singapore. Reply to pay reviews on Glassdoor and Indeed. If pay is below market, a reward review is the real fix.',
  ARRAY['owned', 'people', 'business'], 'act_next',
  $j$[{"metric": "Sentiment", "attribute": "Compensation", "market": "Singapore"}]$j$::jsonb,
  NULL,
  $j$[{"fact": "There are no employer replies on Glassdoor, Indeed or JobStreet.", "checked_on": "2026-10-12"},
      {"fact": "The Indeed page is claimed.", "checked_on": "2026-10-12"},
      {"fact": "Glassdoor replies are free with an employer account.", "checked_on": "2026-10-12"},
      {"fact": "JobStreet has no reply function, but the About and Life and Culture pages are editable.", "checked_on": "2026-10-12"},
      {"fact": "Singapore R&D and clinical ads show no pay.", "checked_on": "2026-10-12"},
      {"fact": "Thermo Fisher manufacturing ads on MyCareersFuture show salary ranges.", "checked_on": "2026-10-12"}]$j$::jsonb,
  NULL, 'open', ARRAY['Singapore'], ARRAY['Research and Development', 'Clinical Research'],
  'Glassdoor', 'glassdoor.com',
  'Coverage figures are the share of Singapore answers with negative compensation themes that cite the source.',
  now()
),
(
  '11ce6833-abe0-496b-8ffb-544a6e0cacc1', '74179bad-6411-44fc-9c89-e10868472924',
  '2026-09-01:03', 'Q3 2026', 'act_now', 'new', 'owned_content',
  'Publish how Thermo Fisher develops and measures its managers on the careers pages AI already reads',
  '2026-09-01', 3,
  'Leadership is 29% positive in Germany (71% negative) and 30% in the United States (70% negative).',
  'Experience depends on your manager, promotions depend on who you know, and senior leadership is distant. AI repeats Indeed''s published management rating of 2.9 out of 5.',
  $j$[{"source": "kununu", "market": "Germany", "coverage_pct": 67},
      {"source": "Thermo Fisher careers site", "market": "Germany", "coverage_pct": 53, "url": "https://jobs.thermofisher.com/de/de/germany"},
      {"source": "Indeed reviews", "market": "United States", "coverage_pct": 76},
      {"source": "Thermo Fisher careers site", "market": "United States", "coverage_pct": 35}]$j$::jsonb,
  ARRAY['https://jobs.thermofisher.com/de/de/germany',
        'https://jobs.thermofisher.com/global/en/functional-service-partnership-solutions',
        'https://jobs.thermofisher.com/global/en/sales',
        'https://www.repvue.com/companies/ThermoFisherScientific'],
  'Add a "How we lead" section to those careers pages, reply to management reviews, and claim the free RepVue profile to reply to sales reps. If no manager programme exists, build it first.',
  ARRAY['owned', 'people', 'business'], 'act_next',
  $j$[{"metric": "Sentiment", "attribute": "Leadership", "market": "Germany"},
      {"metric": "Sentiment", "attribute": "Leadership", "market": "United States"}]$j$::jsonb,
  NULL,
  $j$[{"fact": "The RepVue profile is unclaimed.", "checked_on": "2026-10-12"},
      {"fact": "The Germany and FSP careers pages say nothing about managers.", "checked_on": "2026-10-12"}]$j$::jsonb,
  NULL, 'open', ARRAY['Germany', 'United States'], ARRAY['Clinical Research', 'Functional Service Provider', 'Sales'],
  'Thermo Fisher careers site', 'jobs.thermofisher.com',
  'Coverage figures are the share of answers with negative leadership themes in that market that cite the source. The careers site is cited in these answers but is silent on management.',
  now()
),
(
  '11ce6833-abe0-496b-8ffb-544a6e0cacc1', '74179bad-6411-44fc-9c89-e10868472924',
  '2026-09-01:04', 'Q3 2026', 'act_now', 'new', 'owned_content',
  'Explain what happens when an FSP sponsor contract ends, on the FSP careers page',
  '2026-09-01', 4,
  'Job security is 48% positive in the United States (52% negative).',
  'Layoffs and restructuring, the PPD integration, and FSP roles tied to a single sponsor.',
  $j$[{"source": "Indeed", "market": "United States", "coverage_pct": 66},
      {"source": "Thermo Fisher careers site", "market": "United States", "coverage_pct": 35},
      {"source": "SEC filings (not editable by the client)", "market": "United States", "coverage_pct": 20}]$j$::jsonb,
  ARRAY['https://jobs.thermofisher.com/global/en/functional-service-partnership-solutions'],
  'Publish the redeployment process on the FSP careers page after HR and legal review in each country. If no redeployment process exists, design one first.',
  ARRAY['owned', 'business'], 'act_next',
  $j$[{"metric": "Sentiment", "attribute": "Job Security", "market": "United States"}]$j$::jsonb,
  NULL, '[]'::jsonb,
  NULL, 'open', ARRAY['United States'], ARRAY['Functional Service Provider'],
  'Thermo Fisher careers site', 'jobs.thermofisher.com',
  'Coverage figures are the share of US answers with negative job security themes that cite the source.',
  now()
),
(
  '11ce6833-abe0-496b-8ffb-544a6e0cacc1', '74179bad-6411-44fc-9c89-e10868472924',
  '2026-09-01:watch-qa-site', 'Q3 2026', 'watch', 'new', 'owned_content',
  'Take the QA test site out of AI''s reach',
  '2026-09-01', NULL,
  'The QA test site qa1-corporate.thermofisher.com is readable by AI, and AI cites pages from it.',
  NULL, '[]'::jsonb,
  ARRAY['https://qa1-corporate.thermofisher.com/csr/csr-report/inclusive-culture',
        'https://qa1-corporate.thermofisher.com/csr/csr-report/working-in-partnership',
        'https://qa1-corporate.thermofisher.com/us/en/index/corporate-social-responsibility/colleagues/talent.html',
        'https://qa1-corporate.thermofisher.com/us/en/index/corporate-social-responsibility/csr-commitment/corporate-governance.html'],
  'Put the site behind a login or mark it noindex, and request removal in Google and Bing.',
  ARRAY['owned'], NULL, '[]'::jsonb, NULL, '[]'::jsonb,
  NULL, 'open', '{}', '{}', NULL, 'qa1-corporate.thermofisher.com', NULL, now()
),
(
  '11ce6833-abe0-496b-8ffb-544a6e0cacc1', '74179bad-6411-44fc-9c89-e10868472924',
  '2026-09-01:watch-test-reqs', 'Q3 2026', 'watch', 'new', 'owned_content',
  'Stop test requisitions publishing on the public careers site',
  '2026-09-01', NULL,
  '"DO NOT APPLY - TEST REQ" postings appear on the public careers site: one was cited by AI and has since expired, and one is live on the Singapore jobs page.',
  NULL, '[]'::jsonb, '{}',
  'Remove the live test posting and stop test requisitions publishing to the public careers site.',
  ARRAY['owned'], NULL, '[]'::jsonb, NULL, '[]'::jsonb,
  NULL, 'open', ARRAY['Singapore'], '{}', 'Thermo Fisher careers site', 'jobs.thermofisher.com', NULL, now()
)
ON CONFLICT (organization_id, key) DO UPDATE SET
  title = EXCLUDED.title, register = EXCLUDED.register, work_kind = EXCLUDED.work_kind,
  cycle_raised = EXCLUDED.cycle_raised, action_number = EXCLUDED.action_number,
  problem = EXCLUDED.problem, ai_says = EXCLUDED.ai_says, ai_reads = EXCLUDED.ai_reads, urls = EXCLUDED.urls,
  recommendation = EXCLUDED.recommendation, lanes = EXCLUDED.lanes, timing = EXCLUDED.timing,
  lifts = EXCLUDED.lifts, verified_facts = EXCLUDED.verified_facts, markets = EXCLUDED.markets,
  functions = EXCLUDED.functions, source_name = EXCLUDED.source_name, source_domain = EXCLUDED.source_domain,
  notes = EXCLUDED.notes;

-- ─── Baseline checks (cycle 2026-09-01) ─────────────────────────────────────
INSERT INTO public.company_action_checks (action_id, organization_id, cycle, checked_on, status, metric_readings, verified_facts, note)
SELECT a.id, a.organization_id, '2026-09-01', '2026-10-14', 'open', r.readings, a.verified_facts, 'Baseline.'
  FROM public.company_actions a
  JOIN (VALUES
    ('2026-09-01:01', $j$[{"metric": "Sentiment", "attribute": "Application and Communication", "market": "Germany", "value_pct": 24, "metric_status": "provisional"}]$j$::jsonb),
    ('2026-09-01:02', $j$[{"metric": "Sentiment", "attribute": "Compensation", "market": "Singapore", "value_pct": 33, "metric_status": "provisional"}]$j$::jsonb),
    ('2026-09-01:03', $j$[{"metric": "Sentiment", "attribute": "Leadership", "market": "Germany", "value_pct": 29, "metric_status": "provisional"},
                          {"metric": "Sentiment", "attribute": "Leadership", "market": "United States", "value_pct": 30, "metric_status": "provisional"}]$j$::jsonb),
    ('2026-09-01:04', $j$[{"metric": "Sentiment", "attribute": "Job Security", "market": "United States", "value_pct": 48, "metric_status": "provisional"}]$j$::jsonb),
    ('2026-09-01:watch-qa-site', '[]'::jsonb),
    ('2026-09-01:watch-test-reqs', '[]'::jsonb)
  ) AS r(key, readings) ON r.key = a.key
 WHERE a.organization_id = '11ce6833-abe0-496b-8ffb-544a6e0cacc1'
ON CONFLICT (action_id, cycle) DO UPDATE SET
  metric_readings = EXCLUDED.metric_readings, verified_facts = EXCLUDED.verified_facts;
