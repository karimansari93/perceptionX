# Dashboard data architecture (query-cached, 2026-08)

Why the dashboard no longer lags when switching company / country / job
function, and the contract future changes must keep.

## The problem this replaced

Measured on the Ford org (18 sibling profiles, production, 2026-08-11):

| Action | Requests | Transfer | Mechanism |
|---|---|---|---|
| Initial load | 212 | 91.5 MB | 9 rollup families × 18 profiles × offset pages + full response corpus with the prompt row embedded in every response |
| Country switch | 140 | 74.8 MB | Selecting a country switches to a sibling company row; all state was wiped and the identical scope corpus re-downloaded |
| Switch back | 140 again | 74.8 MB again | 5-min in-memory ref cache keyed by entry company, usually missed |

Server-side, each 1000-row offset page cost ~800 ms–1.9 s (view-level
canonicalization + detoast + offset re-scan + `count: exact`), and
`confirmed_prompts` reads paid a hidden RLS subplan (~550 ms mean).

## The architecture now

**One cache, keyed by brand scope.** Every fetch family is a TanStack Query
keyed by the scope signature (sorted same-name/same-org sibling ids) —
`src/hooks/dashboard/dashboardQueries.ts`. Ford-US and Ford-CA share one
scope, so a country switch never refetches scope data: it is a cache hit plus
(at most) one location-rollup RPC. Switching back to anything seen this
session renders on the same tick; staleness (5 min) revalidates in the
background — content stays on screen (`isRefreshing`), skeletons only exist
for scopes never seen this session.

**Composite RPCs replace per-family fan-out** (`supabase/migrations/20260811*`):

- `get_dashboard_rollups(company_ids)` — all 8 company-wide families
  (sentiment, relevance, top sources, competitors, LLM rankings, attribute
  themes, visibility, location buckets) in one call. Replaces ~112 requests.
- `get_location_rollups(owned_ids, owned_buckets, other_ids, other_buckets)`
  — the 6 by-location families in one call. Replaces ~119 requests per
  country switch.
- `get_scope_prompts(company_ids)` — scope prompts in one call, without the
  `for_index` RLS subplan tax.
- `get_company_responses_page(...)` — slim keyset-paged response stream:
  no embedded prompt row (the client stitches prompts by id — that
  duplication alone was ~40% of the old payload), no OFFSET, no exact count,
  `(tested_at, id)` cursor over the `(company_id, tested_at DESC, id DESC)`
  partial index (~37 ms/page warm vs ~800 ms before), and per-response
  sentiment LEFT JOINed in so the old 90-request
  `company_response_sentiment_mv` family no longer exists.

The rollup RPCs are SECURITY DEFINER with an explicit guard
(`accessible_company_ids`) that intersects requested ids with the caller's
org membership (admins pass through) — same tenant isolation as the RLS
policies they bypass, verified with JWT-simulated tests. The responses RPC is
SECURITY INVOKER: `prompt_responses` RLS applies unchanged.

**Intent prefetch.** Hovering a country in the location filter or a company
in the switcher prefetches that target's rollups (`prefetchLocationRollups` /
`prefetchCompanyRollups`), so by the time the click lands the headline data
is already cached. `prefetchQuery` respects staleTime — hovering something
fresh is a no-op.

**Render layer.** The Dashboard gate no longer unmounts the tab tree when
content exists; visited tabs stay mounted across switches; job-function /
location / period changes are wrapped in `startTransition`; tab-level derived
data is memoized; charts animate only on first mount.

## Measured after (same harness, localhost build against live Supabase)

| Action | Requests | Transfer |
|---|---|---|
| Country switch (first visit) | 1 | ~2 MB |
| Country switch (revisit) | 0 | 0 |
| Company switch (hover-prefetched, different scope) | ~13 | ~12 MB (background stream) |
| Company/country switch back (same scope) | 0 | 0 |

## Contracts to keep

1. **Key by scope, not entry company.** Anything keyed per company re-creates
   the country-switch penalty.
2. **Additive server changes.** The RPCs return the exact shapes the old
   PostgREST reads produced; client aggregation code did not change. Extend
   the RPCs rather than adding new per-company request loops.
3. **Never blank rendered content for a refetch.** Loading states derive from
   "no data for this key yet", not from "a fetch is running".
4. **The response stream is background hydration.** First paint is
   rollup-first; nothing on the critical path may await the stream.

## Incident 2026-08-25: statement-timeout 500s on Overview load

Wide-scope loads (Netflix: 16 profiles, ~86 stream pages of ~3.4 MB) pushed
enough concurrent `get_company_responses_page` calls (observed 74/min with
retries) that Postgres began cancelling statements at the `authenticated`
role's 8s `statement_timeout` — PostgREST surfaces those as 500s, which also
took down `get_dashboard_rollups` calls sharing the database. Two client bugs
amplified it: page retries at 400 ms/1500 ms re-formed the herd against a
still-saturated database, and a single *background* stream failure set
`connectionError`, replacing an already-rendered dashboard with the
full-screen "Connection Issue" state (violating contracts #3/#4).

Mitigations now in place: stream-walk concurrency 2 (first pages stay 4),
page retries back off 2.5 s/6 s with jitter and shrink to 250-row pages
(cost scales with rows, so the retry fits under the timeout), query-level
retry capped at 1 for the stream families, and the full-screen error is
reserved for the critical path (rollups/prompts) failing with nothing cached
to render — stream failures log and leave content on screen.

## Payload diet (2026-08-25, `20260825080000_slim_dashboard_payloads.sql`)

Phase 1 of the post-incident plan, shipped entirely server-side (no client
shape changed, so no client code changed):

- Citation objects in the stream slim to `url`/`domain` (+`title` only when
  it differs from `url`) via `slim_citation_list` — the dropped
  `type`/`confidence`/`canonical_*` keys and url-duplicate titles were read
  by no client code (audited all consumers). Page wire: 3.2 MB → 2.36 MB.
- `get_dashboard_rollups` and `get_location_rollups` sentiment/relevance
  families return typed column lists instead of `to_jsonb` full MV rows —
  only the aggregator-read fields (metrics + `response_month` +
  `job_function_context`, + `location_context` for the location variant).
  Ford scope: those two families went 9.7 MB → 3.9 MB.

## Details-on-demand cleanup (2026-08-25, phase 2 start)

- `fetchHistoricalResponses` and `fetchCollectionDates` were dead exports —
  no caller anywhere in src — whose query shapes (per-company canonical
  selects with embedded prompts; a 60-page tested_at walk per company) were
  among the incident's slowest statements, issued by the stale pre-refactor
  bundle production was still serving. Deleted.
- `AnswerGapsTab` selected `*` (response_text included) for the user's entire
  response history unbounded; now a typed column list, newest-first,
  capped at 500.

## Phase 3: summaries answer every filter (in progress, 2026-08-25)

Goal: no dashboard chart depends on the raw response stream, so phase 4 can
delete the bulk download. Built from a full audit of every raw-row consumer
(chart/card/modal → fields read → filters applied → required aggregate key).

**Slice 1 (shipped, `20260825120000_scope_stats_rollups.sql`):** four small
per-company stats tables — `company_scope_stats_mv` (month × job-function ×
location: responses, mentions, citations, distinct domains/models, theme
counts), `company_scope_daily_stats_mv` (same by `tested_at` day, + distinct
prompt×model pairs), `company_scope_prompt_type_stats_mv` (+ prompt_type),
`company_llm_stats_mv` (+ ai_model). Cardinality is tens-to-low-hundreds of
rows per company, so `get_scope_stats(company_ids)` ships the whole cube
(~4 KB/company) and client filter toggles stay instant — no fetch per
toggle. They cover the Overview scorecard, day-grain trends, period list,
job-function metrics, and the LLM card (audit items A1-A13, A16, B1-B8, C1,
D1, F4, G3, H1). Refreshed by the existing per-company pipeline
(`refresh_company_metrics`), registered in `_refresh_cm_dispatch` and
`mv_refresh_state`; backfill ran through the dirty queue.

Deliberate number changes at client switch time (both are corrections):
- The LLM card's rollup previously included deprecated "overall candidate
  experience" prompts that every other view excludes; `company_llm_stats_mv`
  excludes them (measured: 4,771 → 4,546 mentions on the largest corpus).
- `stitchResponses` duplicates attribute-tagged rows, so raw-row
  `totalResponses` double-counts them today; the stats tables count each
  response once.

**Slice 2 (server side shipped, `20260825160000_domain_stats_rollup.sql`):**
`company_domain_stats_mv` — (company, domain, response_month, job_function,
location) grain, measures responses_citing / mentioned_responses_citing
(deduped per response) and citation_count (occurrences). Too large to ship
whole (~14K rows per large company), so `get_domain_stats` collapses
job-function/location per request and returns month-grain rows for the
top-N domains (measured: Ford scope, top 300 → 568 rows / 79 KB / 248 ms
authenticated). Motivating measurement: job-function pill switches on the
Ford scope block the main thread 0.4–12.4 s (worst: back to "All
functions") because Sources/Competitors/Themes cards aggregate raw rows;
the cube read replaces that with a ~250 ms fetch. Client switch pending.

**Slice 3 (shipped, `20260825200000_competitor_stats_and_fn_domains.sql`):**
`company_competitor_stats_mv` — (company, canonical competitor, month,
job-function, location, prompt_type) grain, responses_mentioning +
co_mentions deduped per response; `get_competitor_stats` collapses location
per request and returns top-N; `get_domain_stats` grew `p_keep_functions`
so domain rows keep the function dimension for client pooling.

**Client switch (shipped, 2026-08-25):** OverviewTab, SourcesTab,
CompetitorsTab, SourcesSummaryCard and CompetitorsSummaryCard pool the
cubes when present, with the raw path kept verbatim as fallback for
un-backfilled scopes. Two rules came out of adversarial review of the
switch and are now contracts:
- **One basis per ratio.** A cube numerator must divide by a cube
  denominator (scope/prompt-type cube totals), never by a raw-stream count
  — the stream loads late and partial, and mixed-basis coverage inflates
  to (or past) the 100% clamp until it finishes. Every component activates
  its cube path only when ALL cubes it reads are present.
- **One name space per lookup.** The cube's variant-collapse map (built
  over top-N server-canonical names) and the raw one (built over every
  parsed name) can pick different anchors for the same competitor; raw
  extras (models, response ids, domains, locations) are resolved through
  both maps, and trend series match responses by id, not by name string.

Measured after the switch (same harness, Ford scope): job-function pill
switches register **zero longtasks** once hydration completes (worst
observed anywhere: 165 ms returning to "All functions" mid-stream),
against 0.4–12.4 s before. The pre-cube visibility/sentiment day-trend
memos turned out to be dead code (no JSX consumer) and were deleted
rather than switched.

**Remaining slices:** theme/attribute stats (the last per-function raw
scans on Overview), page-grain stats, prompt-grain stats. Row-level
surfaces (response lists, quote extraction, text search) stay raw and get
server pagination in phase 4.

## UX layer (2026-08-25)

- **Warm starts:** the small dashboard families (prompts, rollups, scope
  stats, location rollups — never the response stream) persist to IndexedDB
  via `PersistQueryClientProvider` (`px-dashboard-cache-v1`, 24h maxAge,
  version-busted). localStorage was tried first and rejected: a large
  scope's snapshot passes its ~5 MB quota and a failed write silently
  strands a stale partial.
- **First-load gate releases on headlineReady (prompts + rollups), not the
  full stream** — contract #4 applied to the loader. Measured on the Ford
  scope: reveal went from ~45-55 s (stream-bound) to ~6 s cold, and a warm
  reopen paints entirely from the persisted cache (verified with data RPCs
  blocked). The remaining ~6 s is auth/company bootstrap, not data.
- **GlobalFetchIndicator**: 2px top bar for genuinely-async moments —
  appears after 150 ms in-flight, stays ≥300 ms; never a skeleton over
  rendered content.
- **web-vitals → GA**: INP/LCP/CLS report to the existing gtag property.
  INP is the "clicked a filter and it froze" metric (measured 0.4-12.4 s
  main-thread blocks on Ford job-function switches — the number the cube
  switches must drive under 200 ms).

## Known follow-ups (deliberate scope cuts)

- Citations still dominate the stream payload (~1.7 MB/1000 rows after the
  per-object slim). The full cut — domain-only citations in the stream and
  lazy fetches for the surfaces that need URLs (source drilldowns, response
  modals, recency) — needs ~12 consumer components reworked; it belongs with
  the details-on-demand phase.
- The stitch + memo cascade over the full row set still blocks the main
  thread for seconds on 40K-row scopes when the full stream commits — chunk
  it or move it to a worker.
- Persist the rollups/prompts cache to IndexedDB (`persistQueryClient`) for
  Linear-style warm starts across reloads.
- A per-job-function rollup MV would let scorecard function switching drop
  its raw-row dependency entirely.
- The one-per-minute `refresh_metrics_tick` (mean 12.6 s) is the biggest
  background I/O consumer; batching/off-peak scheduling would reduce read
  contention.
