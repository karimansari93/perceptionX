# Prospect list: large employers (US HQ focus)

Builds `output/10k-companies-master.xlsx`. Rerun quarterly, in this order:

```
python3 1_wikidata.py       # Wikidata: entities with 5,000+ employees (~5 min)
python3 2_sec.py            # SEC: headcount from latest 10-K / 20-F text (~1-1.5 h first run; cached after)
python3 2b_sec_revenue.py   # SEC: revenue, used to catch large companies whose headcount wasn't read
python3 2c_forbes.py        # Forbes America's Largest Private Companies (newest published year)
python3 3_build.py          # merge, roll up, flag, write the Excel file
```

Optional inputs in `inputs/` (not committed: they hold client and contact data):
`companies_supabase.csv` (AI-mentioned), `clients_exclude.csv` (CURRENT CLIENT),
`andy_linkedin.csv` (LinkedIn connections export), `andy_hubspot.csv` (HubSpot contacts export).

Thresholds live in `common.py` (`MIN_EMPLOYEES`, `MAIN_THRESHOLD`). SEC requests use the
contact email in `common.py` as the User-Agent, as SEC requires.

Known limits: Wikidata is incomplete and often stale, especially for private companies.
SEC headcounts are read from report text; the "SEC evidence" tab shows the sentence each
number came from, and "Check headcount (US HQ)" lists large US filers where none was found.

## Talent and employer-brand leaders (optional)

```
python3 5_ai_people.py --limit 25   # pilot: asks Google AI Overviews via ScrapingDog, 2 requests per company
python3 5_ai_people.py              # all of targets/us_hq_10k.csv (or --targets your.csv)
python3 5_ai_people.py --fallback-only   # send AI Overviews gaps to Google AI Mode, nothing else
```

Questions go through our read-only edge functions `test-prompt-google-ai-overviews` and, for
companies with no AI Overview, `test-prompt-google-ai-mode` (keys stay in Supabase). Needs the
project's public anon key in `SUPABASE_ANON_KEY` or `cache/.supabase_anon`. Writes
`output/ai-people.xlsx` with every cited link kept. Every name is AI-stated and must be checked
(LinkedIn) before outreach.
