# PerceptionX Dashboard — End-to-End Data Reliability Audit

**Date:** 2026-09-11
**Scope:** Supabase project `ofyjvfmcgtntwamkubui` (Postgres 17.6, eu-west-2), the React/Vite dashboard in this repository, and the data path between them.
**Method:** Read-only. Code reading of the frontend, RPCs and migrations; read-only SQL against production (schema, settings, statistics, data-integrity counts); Supabase API and Postgres logs for 2026-09-10; a deterministic local reproduction (Playwright + mocked PostgREST) whose harness, results and screenshots are committed under `docs/audits/data-reliability-2026-09-11/repro/`.
**Constraints honoured:** No production data was modified or deleted, no migrations were run, no application code was changed. This document and the reproduction harness are the only additions.

---

## A. Executive summary

**The reported symptom ("log in, see sentiment / relevance / themes missing or 0%, visibility present, refresh fixes it") is reproduced, root-caused, and explained by two defects that combine. Neither is a data problem. The data in the database is structurally sound.**

1. **The first dashboard load fires a burst of heavy database calls that the production instance cannot always answer inside its 8-second statement timeout.** A cold load issues six composite RPCs plus one response page per company in the scope, concurrently, against a Postgres instance with 60 connections, 256 MB of shared buffers and a 3.5 MB `work_mem`, which is simultaneously running background materialized-view refreshes that take 33–98 seconds. When the burst lands in a slow window the heavy calls are cancelled by Postgres (SQLSTATE `57014`) and PostgREST returns HTTP 500. Production logs for 2026-09-10 show this exactly: at 13:44:25 UTC `get_dashboard_rollups`, four `get_company_responses_page` calls and `get_domain_stats` all returned 500 after 10.4–10.6 s, while the two light calls in the same burst succeeded; the same pattern recurs at 14:13:36 UTC (all 500s at 8.2–8.5 s, i.e. the timeout).

2. **When one of those calls fails, the dashboard does not know it failed.** The location-scoped rollups query (`locRollupsQuery`, which supplies sentiment, relevance and attribute themes whenever a location is selected — which it always is on entry, because the profile's default location is applied) is excluded from the dashboard's error handling. On error its loading flag drops to `false`, its data stays `undefined`, and the metric code coalesces "no data" to `0`. The result is a scorecard that renders **Sentiment 0%, Relevance 0%, Visibility 70%** (visibility comes from a different, successful call), an EPS computed from the zeros, and a Themes card that says "No attribute mentions found yet." No error, no retry button, no skeleton. The response stream has the same defect with a different face: on failure it logs to the console and leaves the Prompts tab in a skeleton indefinitely.

**Why a refresh fixes it:** successful query results are persisted to IndexedDB and rehydrated on reload, so a refresh re-issues only the one or two families that failed (the failed ones are never persisted). One or two requests against a now-quieter database succeed; the persisted families never refetch-fail visibly because errors on a query that already has data are invisible by design. The reproduction shows the first load issuing 8 RPCs (2 failing) and the refresh issuing 2.

**Frequency:** in the 13:00 UTC hour of 2026-09-10 the API served 306 dashboard RPC calls with 10 non-2xx responses and a slowest call of 10.6 s; in the 14:00 hour 185 calls with 9 non-2xx. Hours with no failures still had slowest calls of 7.0–7.1 s, i.e. within a second of the cliff. The failure is therefore not rare and not random: it is load-dependent and clustered around the busiest hours and background refresh windows.

**The systemic root cause** is architectural, not a single bug: the dashboard's data delivery has no contract for *failure* or *freshness*. Every query family independently decides what "loading", "empty" and "error" look like; three of the six families treat error as empty; there is no client-side error reporting in production (`logger` is a no-op); and the database is shared between the dashboard, a public website (anon role), the MCP server (service role) and a per-minute refresh tick with no isolation or admission control. Fixing the two defects above removes the reported symptom. Fixing the contract is what stops the next variant of it.

**Recommended first moves (all small, all safe):**
- Treat `locRollupsQuery` errors as errors: include them in the dashboard's error/loading model and render an inline retry, never `0%`.
- Treat stream errors as errors: stop the Prompts tab and cards from waiting forever on a stream that already failed.
- Retry with backoff that clears the 8-second window (and `refetchOnReconnect`/focus for errored queries only), instead of one retry after ~1 s.
- Ship client error reporting (Sentry or equivalent) with user, company, scope key and request timing attached, so the question "why did this user see no sentiment at 10:42?" becomes answerable.
- Reduce the cold-load burst: serialize or throttle the response stream behind the headline queries and stop refreshing by-location matviews `CONCURRENTLY` during peak hours.

---

## B. Architecture map

### B.1 Components

```
Browser (Netlify static SPA, React 18 + Vite)
│
├─ AuthProvider            src/contexts/AuthContext.tsx      supabase-js session (localStorage key sb-<ref>-auth-token)
├─ CompanyProvider         src/contexts/CompanyContext.tsx   organization_members → organizations → organization_companies → companies
├─ ProfileSetupGate        src/components/onboarding/ProfileSetupGate.tsx   first-login setup; writes auth user_metadata
├─ ProtectedRoute          src/components/ProtectedRoute.tsx
├─ Dashboard page          src/pages/Dashboard.tsx            tab routing, first-load loader, error screens
│    └─ useDashboardData   src/hooks/useDashboardData.ts (3,088 lines)  all fetching, derivation and loading flags
│         └─ dashboardQueries.ts  src/hooks/dashboard/dashboardQueries.ts  query keys, fetchers, page retry plan
├─ TanStack Query v5       src/App.tsx L54-58 defaults; PersistQueryClientProvider → IndexedDB (idb-keyval) key px-dashboard-cache-v1
│
▼  HTTPS, PostgREST (/rest/v1/rpc/*), JWT role = authenticated (statement_timeout 8 s)
│
Supabase Postgres 17.6  (max_connections 60, shared_buffers 256 MB, work_mem 3.5 MB, effective_cache_size 768 MB)
├─ Source tables: confirmed_prompts, prompt_responses, ai_themes, citations…
├─ Per-company metric tables (rebuilt by refresh_company_metrics(company_id) from a dirty queue)
│     company_response_sentiment_mv, company_relevance_scores_mv, company_attribute_themes_mv,
│     company_top_citations_mv, company_competitors_mv, company_llm_rankings_mv, company_scope_stats_mv…
├─ By-location matviews (REFRESH MATERIALIZED VIEW CONCURRENTLY from the tick)
│     company_response_sentiment_by_location_mv, company_relevance_scores_by_location_mv,
│     company_attribute_themes_by_location_mv, company_visibility_by_location_mv,
│     company_competitors_by_location_mv, company_llm_rankings_by_location_mv, company_top_citations_by_location_mv
├─ RPCs (SECURITY DEFINER, guarded by accessible_company_ids()):
│     get_scope_prompts, get_dashboard_rollups, get_scope_stats, get_location_rollups,
│     get_domain_stats, get_competitor_stats;  get_company_responses_page (SECURITY INVOKER, keyset)
└─ pg_cron: refresh_metrics_tick() every minute (5 companies/min from the dirty queue; one by-location matview per tick,
      60-min cooldown, 6 h starvation guard; SET LOCAL statement_timeout = 0 inside the tick)

Other tenants of the same database:
├─ Public website (repo evi-px, employers.perceptionx.ai) — anon role, statement_timeout 3 s (docs/PUBLIC_SITE_DB_DEPENDENCIES.md)
└─ MCP server — service_role, statement_timeout 20 s (migration 20260903160000)
```

### B.2 Request flow of a cold dashboard load

| Step | Trigger | Call | Gate |
|---|---|---|---|
| 1 | app mount | `auth.getSession()` (localStorage) + `onAuthStateChange` | — |
| 2 | user id known | `GET /rest/v1/organization_members?select=…organizations(organization_companies(companies(…)))` | `AuthContext.loading === false` |
| 3 | company chosen (`pickInitialCompany`) | `GET /rest/v1/companies` (collection status) | — |
| 4 | `scopeReady` (user + company + scope ids) | `get_scope_prompts`, `get_dashboard_rollups`, `get_scope_stats` — **concurrent** | `useDashboardData.ts` L404-432 |
| 5 | default location applied from user metadata | `get_location_rollups` — concurrent with 4 | L1416-1426, L1616-1631 |
| 6 | location selection known | `get_domain_stats`, `get_competitor_stats` — concurrent with 4 | L1646-1664 |
| 7 | prompts arrived | `get_company_responses_page` × N companies, concurrency 4 (first pages) | L437-450 |
| 8 | first pages arrived | remaining pages, concurrency 2, keyset walk | L451-463 |
| 9 | themes card visible | `ai_themes_keyset_page` (lazy) | AttributesSummaryCard |

Steps 4–7 overlap: on a scope of N companies the database receives 6 + min(N, 4) concurrent statements from one browser tab within roughly 1.5 s of login.

### B.3 Client cache and state

- **Query keys** (`dashboardQueries.ts` L9-30): every key is `['dashboard', 'scope', scopeKey, …]` where `scopeKey` is the sorted list of same-name sibling company ids. Location keys append the canonical location key. **No key contains the user id or organization id.** Period and other filters are applied client-side and are not part of any key.
- **Defaults** (`App.tsx` L54-58): `retry: 1`, `staleTime` 5 min, `refetchOnWindowFocus: false`, `refetchOnMount: false`, `refetchOnReconnect: false`. Dashboard queries override `refetchOnMount: true`, `staleTime` 5 min, `gcTime` 45 min.
- **Persistence** (`App.tsx` L73-92): IndexedDB, `maxAge` 24 h, `buster 'v1'`; only queries with `status === 'success'` and key[0] `'dashboard'` that do not include `'responses'` are dehydrated. Errored queries are never persisted. Nothing clears the persisted cache on sign-out (`AuthContext.signOut` L63-70 clears auth state only).
- **Derived state**: `useDashboardData` derives ~40 memoised values from the six families and selects the location-scoped or company-wide variant of each via `locActive` (L1894-1907). Loading is expressed through at least six separate booleans (`loading`, `cubesLoading`, `locationMetricsLoading`, `metricsCalculating`, `responsesStreaming`, `hydration.*`).

### B.4 Metric traces (source → RPC → client → render)

| Metric | Source of truth | RPC and family | Client derivation | Render path | Null / empty / error handling |
|---|---|---|---|---|---|
| **Sentiment** | `ai_themes` polarity per response → `company_response_sentiment_mv` (per company) and `…_by_location_mv`; v2 ratio = positive / (positive + negative) | `get_dashboard_rollups.sentiment` (company-wide) and `get_location_rollups.sentiment` (location) | `aggregateSentimentRows` → `companySentimentMetrics` / `locSentimentMetrics`; `effSentimentMetrics = locActive ? loc : company` (L1898); `averageSentiment = effSentimentMetrics.sentiment_ratio ?? 0` (L2384) | `OverviewTab` scorecard (`scorecardMetrics.sentimentScore`, L1265) | Missing location rows → `locRollupsFiltered = null` (L1719-1722) → `effSentimentMetrics = null` → `averageSentiment` stays at its initial `0` → renders `0%`. No error state. |
| **Visibility** | `prompt_responses.company_mentioned` → `company_visibility_by_location_mv` rows inside `get_dashboard_rollups.visibility` | `get_dashboard_rollups.visibility`, filtered client-side to the selected location (`visibilityRowsForSelection`) with a raw-response fallback | mentioned / total over rows in selection | scorecard `visibilityScore` | Guarded: `visibilityReady` (L2276-2282) waits for rows or the raw fallback before painting. This is why visibility survives when sentiment does not — it rides the rollups call, not the location call. |
| **Relevance** | `citations` recency-weighted → `company_relevance_scores_mv` / `…_by_location_mv` | same two families as sentiment | `effRelevanceMetrics?.relevance_score ?? 0` (L2540) | scorecard `relevanceScore` | Same silent `0` as sentiment. |
| **Themes** | `ai_themes` × attribute taxonomy → `company_attribute_themes_mv` / `…_by_location_mv` (+ lazy raw `ai_themes_keyset_page` for drill-down) | `attribute_themes` family in the same two RPCs | `effAttributeThemes` (L1907) | `AttributesSummaryCard` (L361-378), `ThematicAnalysisTab` (L784, L800) | Zero rows for any reason → "No attribute mentions found yet." / "No Experience Data". The only skeleton gate is `aiThemesLoading` (the lazy raw fetch), not the rollup fetch. |
| **Sources / Competitors** | `citations` / `detected_competitors` → cubes | `get_domain_stats`, `get_competitor_stats`, plus stream | pooled client-side by month × job function | summary cards | Skeleton only while `responsesLoading \|\| cubesLoading`; a failed cube or stream turns both false → "No sources found yet." |
| **Prompts table** | `confirmed_prompts` + stream | `get_scope_prompts` + `get_company_responses_page` | `stitchResponses` | `PromptTable` | `awaitingResponseData = responsesLoading && …` (L130): a stream that errored keeps `responsesLoadedCompanyId === null` (L605) so `responsesStreaming` stays true (Dashboard L301) → skeleton forever. |

---

## C. Findings (ranked)

Severity: **P0** = produces the reported symptom in production today; **P1** = amplifies it or blocks diagnosis; **P2** = correctness or hygiene defect with user-visible effect under specific conditions; **P3** = should be fixed, low impact.

### P0-1 · Location-scoped metrics fail silently and render as 0% / empty

- **What is wrong.** `locRollupsQuery` (`useDashboardData.ts` L1617-1631) supplies sentiment, relevance, attribute themes, top sources, competitors and LLM rankings whenever a location is selected. Its error is not part of `criticalError` (L632-635: prompts and rollups only), not part of `hydration.errored` (L1854: prompts, rollups, first pages, full stream only), and not logged. `locationMetricsLoading` (L1784-1788) is `locRollupsQuery.isPending`, which is `false` once the query is in error. `locRollupsFiltered` returns `null` when the query has no data (L1719-1722), which makes `locSentimentMetrics` and `locRelevanceMetrics` `null` (L1741-1742). With `locActive` true (L1894-1897) the effective metrics are the location ones (L1898-1899), and the scorecard code coalesces missing to `0` (L2380-2384, L2540). `metricsCalculating` clears because `allReady` (L2291-2293) only checks the company-wide rollups (`backendMetricsReady`) and `!locationMetricsLoading`.
- **Evidence.** Reproduction scenario A (`repro/results.json`, `A_first_load.png`): with `get_location_rollups` answering the production timeout body (`57014`) on both attempts and every other RPC healthy, the Overview renders Sentiment **0%**, Visibility **70%**, Relevance **0%**, EPS **21**, Themes card "No attribute mentions found yet.", zero skeletons, no "Connection Issue" screen. Scenario B (reload, healthy backend): **82% / 70% / 63%**, EPS **75**, themes present. Production API logs show the same RPC family timing out at 2026-09-10 13:44:25 and 14:13:36 UTC (see D.3). The code comment at L1892-1893 ("otherwise sentiment/relevance show 0% while visibility still renders") shows the failure mode was anticipated for a different cause and not closed for this one.
- **User impact.** Wrong numbers, not missing numbers: an EPS of 21 instead of 75 is a business-facing figure. Themes disappear entirely. Nothing tells the user to retry.
- **Likely frequency.** Every time `get_location_rollups` (or `get_dashboard_rollups` before it) times out on a cold load, which the logs show clustering in busy hours (non-2xx counts of 10 and 9 in the 13:00 and 14:00 UTC hours of 2026-09-10). Applies to every user, because the profile's default location is applied on entry (L1416-1426), so `locActive` is true on first paint for anyone who completed profile setup or has a starred view.
- **Root cause.** Error is modelled as "no data" at three layers (query flag, filtered rows, coalesced metric), and the location family was added after the error model was designed around prompts + rollups.
- **Recommended fix.** (1) Add `locRollupsQuery.error` to the hydration/error model; while `locActive` and the location query has neither data nor a fresh success, hold the scorecard skeleton or render an inline "Couldn't load location metrics — Retry" state in place of the three metrics and the Themes card. (2) Replace `?? 0` at L2384 and L2540 with `null` propagated to the scorecard, which must render "—" for `null`. (3) Log the error through the same path as `backgroundError`, and report it (see P1-4).

### P0-2 · The cold-load request burst exceeds what the database can answer inside the 8-second authenticated statement timeout

- **What is wrong.** A single cold dashboard load issues 6 composite RPCs concurrently, followed within the same second by up to 4 concurrent `get_company_responses_page` calls (concurrency 4 for first pages, 2 for the remainder; `dashboardQueries.ts` L282, L308). Each page attempt can hold a connection for the full 8 s before Postgres cancels it. The same database concurrently serves the public website (anon role, 3 s timeout), the MCP server (service role, 20 s timeout) and a per-minute refresh tick that refreshes by-location matviews `CONCURRENTLY` with `statement_timeout = 0`.
- **Evidence.**
  - Role timeouts (verified from `pg_roles.rolconfig`): `anon` 3 s, `authenticated` 8 s, `authenticator` 8 s, `service_role` 20 s (migration `20260903160000` L17); cluster default 120 s.
  - Instance settings (`pg_settings`): `max_connections` 60, `shared_buffers` 32768 × 8 kB = 256 MB, `work_mem` 3,500 kB, `effective_cache_size` 768 MB, `jit` off. `pg_stat_database`: 6,208 temp files / 59 GB temp bytes written since stats reset, cache hit 96.43%, database size 3,199 MB, 2,463 rolled-back transactions. A 3.5 MB `work_mem` against multi-hundred-MB matviews means the aggregates spill to disk under concurrency.
  - Refresh durations (`mv_refresh_state`, 2026-09-11 morning): `company_relevance_scores_by_location_mv` **97,990 ms**, `company_attribute_themes_by_location_mv` **33,189 ms**, `company_competitors_by_location_mv` 10,428 ms, `company_visibility_by_location_mv` 5,283 ms, `company_llm_rankings_by_location_mv` 4,479 ms; per-company table batches 2,673 ms. These run inside the same minute tick that the dashboard is querying against.
  - API log, 2026-09-10 13:44:25 UTC (one user's cold load): `organization_members` 200 in 1,400 ms; `get_scope_prompts` 200 in 1,463 ms; `companies` 200 in 1,222 ms; `get_scope_stats` 200 in 2,321 ms; **`get_dashboard_rollups` 500 in 10,568 ms; `get_company_responses_page` 500 × 4 in 10,426–10,632 ms; `get_domain_stats` 500 in 10,432 ms.** Even the light reads took over a second, which is the signature of a saturated pool, not a slow query.
  - API log, 2026-09-10 14:13:36 UTC: `get_dashboard_rollups` 500 in 8,189 ms; `get_company_responses_page` 500 × 6 in 8,215–8,459 ms; `get_domain_stats` 500 in 8,449 ms (all at the timeout).
  - Hourly, 2026-09-10 (dashboard RPCs only): 11:00 → 190 calls, slowest 7,059 ms, 0 failures; 12:00 → 268 calls, slowest 7,133 ms, 0 failures; **13:00 → 306 calls, slowest 10,632 ms, 10 failures; 14:00 → 185 calls, slowest 8,459 ms, 9 failures**; 15:00 → 38 calls, slowest 755 ms. Postgres-log entries containing "statement timeout" per hour the same day: 10, 2, 14, 16, 5, 1, 8, 1, 5 (11:00 through 19:00 UTC).
  - The repository already records two prior incidents of the same class: the 2026-07-21 `ACCESS EXCLUSIVE` lock incident (migration `20260719120000` header) and the 2026-08-25 statement-timeout incident (`docs/DASHBOARD_DATA_ARCHITECTURE.md`, and the comment at `useDashboardData.ts` L628-631).
- **User impact.** Any of the six families can fail on a cold load. Which one fails decides which symptom the user sees (P0-1 for the location family, P1-1 for the stream, "Connection Issue" for prompts/rollups).
- **Likely frequency.** Load-dependent; daily during business hours at current traffic. The 7.0–7.1 s slowest calls in the "healthy" hours show the system routinely runs within one second of the cliff.
- **Root cause.** No admission control between four independent workloads on a small instance, combined with a client that opens all of its work at once and retries into the same window. The 8 s timeout is a symptom cap, not a fix.
- **Recommended fix.** Short term: (a) stagger the client burst — hold the response stream until the headline families (prompts, rollups, location rollups) have settled, and drop first-page concurrency from 4 to 2; (b) move the by-location `CONCURRENTLY` refreshes out of business hours or gate them on low `pg_stat_activity` load; (c) raise `work_mem` for the `authenticated` role only for the RPC functions (`SET LOCAL work_mem` inside the SECURITY DEFINER bodies) so the aggregates stop spilling. Structural: see G.

### P1-1 · Response stream failure strands raw-derived UI in a permanent skeleton

- **What is wrong.** `firstPagesQuery` / `fullStreamQuery` errors are only `console.error`-ed (L636-640). The sync effect (L600-607) sets `responsesLoadedCompanyId(null)` whenever `streamData` is `undefined`, which after an error is permanent for that mount. `Dashboard.tsx` L301 derives `responsesStreaming = responsesLoadedCompanyId !== currentCompany?.id`, so every consumer that gates on `responsesLoading` waits forever: `PromptTable` L130 (`awaitingResponseData`), `SourcesSummaryCard` L339 and `CompetitorsSummaryCard` L341 (until a cube answers), `ThematicAnalysisTab` (comment L61).
- **Evidence.** Reproduction scenario C (`C_stream_failure.png`): with `get_company_responses_page` answering 500 on every attempt, the client made **6** page attempts (3-attempt internal plan × query-level `retry: 1`) over **46.8 s**, then left the Prompts page showing one skeleton region, no prompt rows, no error text, no "Connection Issue". Production logs show 4–6 page calls failing together in each of the two bursts above.
- **User impact.** "Some parts of the dashboard load while others don't": the Overview scorecard (rollup-backed) appears while Prompts, and any card that waits on the stream, never resolves.
- **Frequency.** Whenever any page in the walk fails after retries — the walk is the largest consumer of the 8-second budget on wide scopes (Dashboard L418 comment: "the full ~45 s stream on large scopes").
- **Root cause.** The stream was deliberately made non-critical after the 2026-08-25 incident (so a page 500 would not replace a loaded Overview with the error screen, L628-631). The change removed the error screen but did not add a replacement error state, leaving "loading" as the fallback.
- **Recommended fix.** Give the stream an explicit `errored` state: when `firstPagesQuery.error || fullStreamQuery.error` and no data, set `responsesLoadedCompanyId` to the current company with an `streamError` flag; consumers render "Responses couldn't be loaded — Retry" instead of a skeleton. Cap the combined attempts (see P1-2).

### P1-2 · Retry policy retries into the same saturated window and multiplies load

- **What is wrong.** Query-level `retry: 1` uses TanStack's default `retryDelay` (1 s for the first retry). A call that was cancelled at 8 s is retried 1 s later against the same saturated pool. For pages, the internal plan (`dashboardQueries.ts` L240-242: 0 ms / 2.5 s / 6 s, page shrink 1000 → 250) multiplied by the query-level retry yields up to 6 attempts per company, each holding a connection for up to 8 s. `refetchOnReconnect` and `refetchOnWindowFocus` are `false` globally (App.tsx L56-58), so an errored query never recovers without a remount or a manual refresh.
- **Evidence.** Scenario C: 6 attempts in 46.8 s. Code comment L444-449 records that the previous default (`retry: 3`) "multiplied a failing wide-scope walk into dozens of extra 8-second statement-timeout requests against an already saturated database" — the reduction to 1 halved the storm but kept its shape.
- **User impact.** Failures take 20–47 s to surface (if they surface at all), and the retries themselves push other users' calls over the timeout.
- **Root cause.** Retry is tuned per query in isolation; no shared budget, no jitter, no backoff sized to the 8 s timeout.
- **Recommended fix.** Exponential backoff with jitter starting at ≥ 3 s, 2 retries, and `retryOnMount`/`refetchOnReconnect: true` for queries in error state only; one internal attempt per page (let the query layer own retries); a per-tab concurrency budget shared by all families (see G).

### P1-3 · The refresh tick and migration-driven full requeues compete with interactive traffic

- **What is wrong.** `refresh_metrics_tick` (migration `20260811140000`, the live definition) runs every minute, refreshes up to 5 companies' metric tables and one by-location matview `CONCURRENTLY` with `SET LOCAL statement_timeout = 0` (L96). Several migrations call `queue_all_companies_metrics_dirty()`, which requeues every company (a 44-minute churn at 5/min). `CONCURRENTLY` refreshes are non-blocking for readers but are I/O- and `work_mem`-heavy, and with 60 connections and 256 MB of shared buffers they evict the working set the dashboard RPCs depend on.
- **Evidence.** Durations above (98 s and 33 s for the two heaviest by-location matviews). The 13:00–14:00 UTC failure cluster coincides with the tick's normal operation; the audit could not attribute individual timeouts to individual refreshes because the tick does not log start/finish to the Postgres log (only to `mv_refresh_state`).
- **Root cause.** Background maintenance and interactive reads share one small instance with no scheduling policy beyond a 60-minute cooldown.
- **Recommended fix.** Schedule by-location refreshes into a nightly window (with the 6 h starvation guard relaxed accordingly), or refresh them per company incrementally like the per-company tables already are (migration `20260706120000` pattern). Log tick start/finish/duration to the Postgres log so correlation with API 500s is possible.

### P1-4 · No production observability for data failures

- **What is wrong.** `logger` (`src/lib/utils.ts` L6-30) is a no-op outside `import.meta.env.DEV` for log/warn/info; the only production path is `console.error`. There is no error-reporting SDK (Sentry is a TODO), no request or correlation id sent with RPC calls, no client-side timing, and no health check the UI could consult. Server side, the PostgREST log has method, path, status and origin time, but no user id, company id or scope key. The question "why did this user see no sentiment at 10:42?" cannot be answered today for a specific user, only for "a request at 10:42".
- **Evidence.** This audit reconstructed the 13:44:25 burst from the API log by timestamp alone; nothing ties it to a user or a company. The reproduction's scenario A produces 30 `console.error` lines and zero reported events.
- **Recommended fix.** (1) Add Sentry (or equivalent) with `user.id`, `organization_id`, `company_id`, `scopeKey`, `locationKey`, query key, HTTP status, PostgREST error code and elapsed time on every failed query (a global `QueryCache.onError`). (2) Send `x-px-request-id` and `x-px-scope` headers from the supabase client (PostgREST forwards custom headers into `request.headers` for logging). (3) Log `refresh_metrics_tick` phases with `RAISE LOG`. (4) A `dashboard_health` RPC that returns the max `last_refresh_finished` per family so the UI can show "as of".

### P2-1 · "Loading", "empty" and "error" are conflated in cards

- **What is wrong.** `AttributesSummaryCard` L361-378 shows "No attribute mentions found yet." whenever `effAttributeThemes` is empty and the lazy raw fetch is not loading; `ThematicAnalysisTab` L784/L800 shows "No Experience Data" / "No Themes Found"; `SourcesSummaryCard` L339-354 and `CompetitorsSummaryCard` L341 show "No … found yet." once `responsesLoading || cubesLoading` is false, which an error makes true immediately. `OverviewTab` renders `0%` for a metric of `0` and for a metric that was never loaded (L1265-1267), because the hook coalesces with `?? 0` (L2384, L2540). `EMPTY_ARRAY` / `?? []` defaults are used throughout `useDashboardData` for both "not loaded" and "loaded, empty".
- **Impact.** Wrong empty states are indistinguishable from real empty states; support cannot tell a data gap from a fetch failure by looking at the screen.
- **Recommended fix.** One `Async<T>` shape per family (`{status: 'loading'|'ready'|'error'|'empty', data, error, asOf}`) consumed by every card; empty copy only on `'empty'`.

### P2-2 · First-login landing differs from every subsequent load

- **What is wrong.** `CompanyProvider` runs `fetchUserCompanies` as soon as auth resolves (`CompanyContext.tsx` L349-357) and picks the initial company with `pickInitialCompany(companies, user)` (L272), which reads `default_company_id` / `default_company_name` from `user.user_metadata` (`useProfileSetup.ts` L283-287). `ProfileSetupGate` sits *below* `CompanyProvider` in the tree (`App.tsx` L211-212 mounts the provider; `ProtectedRoute.tsx` L36 mounts the gate inside it) and writes that metadata only when the user submits the first-login form (`ProfileSetupGate.tsx` L101-105). The metadata update fires `USER_UPDATED`, but the company effect depends on `user?.id` only (L357) and `setCurrentCompany` keeps an existing selection (L274-280). So on the first login the dashboard lands on `base` (the `is_default`/first company, US-preferring), and on the next refresh it lands on the profile's default company. The location effect (`useDashboardData.ts` L1416-1426) reads the *updated* user, so location can change while company does not.
- **Evidence.** Code reading only; not reproduced (the harness seeds a completed profile). Flagged because it is a genuine login-only divergence that matches the user's description and will confuse the P0 investigation if left unexplained.
- **Impact.** Once per account, on first login only: a different company (and possibly a different location) than every later session. Low frequency, high confusion.
- **Recommended fix.** After the gate saves, call `refreshCompanies()`/re-run `pickInitialCompany` with the updated user (or mount `CompanyProvider` inside the gate).

### P2-3 · Persisted cache is not scoped to the user and is not cleared on sign-out

- **What is wrong.** Query keys carry only the scope key (company ids) and location key. The IndexedDB persister (App.tsx L73-92) keeps every successful dashboard family for 24 h. `signOut` (AuthContext L63-70) does not call `queryClient.clear()` or remove the persisted entry (grep confirms no such call anywhere in `src`).
- **Impact.** Safe *today* only because scope keys are company ids and every RPC enforces `accessible_company_ids()` server-side, so a second user on the same device can only ever read cache entries for companies they also have access to. It is still a privacy-hygiene defect (a company's rollups stay on a shared device after logout) and a correctness risk the moment a key ever omits a dimension (period, filters, admin impersonation via `switchCompany`).
- **Recommended fix.** Include `user.id` in `dashboardKeys.all`; call `queryClient.clear()` and remove `px-dashboard-cache-v1` in `signOut`; bump `buster` when the shape changes.

### P2-4 · Freshness is not part of any data contract

- **What is wrong.** Every RPC coalesces an absent family to `[]` (`20260811090000` L60-118), so "MV not built yet for this company", "refresh failed", "refresh pending in the dirty queue" and "genuinely no data" all arrive as `[]`. No RPC returns `refreshed_at`, `row_count` or a dirty-queue position. `mv_refresh_watermark` and `mv_refresh_state` exist but are not exposed to the client.
- **Evidence.** The comment at L2276-2280 ("differential MV staleness") describes visibility rows missing for a bucket while other families have them; the client works around it with a raw-response fallback that only exists for visibility.
- **Impact.** Dormant companies show a sentiment computed months ago with no "as of" date; newly onboarded companies show empty states for up to 44 minutes (queue drain) that read as "no mentions".
- **Recommended fix.** Add `meta: {as_of, refreshed_at per family, queue_position}` to the composite RPC payloads; render "as of <date>" on the scorecard; treat `queue_position > 0` as `'loading'` in the async shape.

### P2-5 · Location and country spellings are reconciled client-side

- **What is wrong.** By-location matviews key on raw `location_context` spellings; `locRollupsFiltered` (L1719-1735) re-filters the RPC result through `canonicalizeLocationContext`, and the location key deliberately excludes raw spellings (`dashboardQueries.ts` L16-20) because they "widen while the response stream lands". Company `country` codes and prompt `location_context` strings are two different vocabularies joined by heuristics in `pickInitialCompany` (L128-134) and the location filter (`docs/LOCATION_FILTER_AUDIT.md`).
- **Evidence.** Read-only SQL during the audit found multiple spellings of the same market inside `location_context` (handled by the canonicaliser) and a long tail of `attribute_id` values in `ai_themes` that do not exist in the taxonomy (dropped at render time).
- **Impact.** Correct today because the canonicaliser is thorough, but every new spelling is a silent data gap until someone adds it, and the same normalisation is duplicated in SQL (`get_location_rollups` bucket matching) and TypeScript.
- **Recommended fix.** Normalise at write time (a `location_key` column populated by trigger, used by the matviews and the RPCs); validate `attribute_id` against the taxonomy at insert.

### P3-1 · Admin identity is defined twice

- **What is wrong.** The frontend hardcodes `ADMIN_EMAILS = ['karim@perceptionx.ai']` (`CompanyContext.tsx` L70-72) while the database decides with `is_admin()` over `user_roles`. They agree today (one admin) but nothing keeps them in sync.
- **Recommended fix.** Read the role from the JWT claim or `user_roles` and delete the constant.

### P3-2 · Two applications and the MCP server share one database with no isolation

- **What is wrong.** The public website (anon, 3 s) and the MCP server (service_role, 20 s) run against the same instance (`docs/PUBLIC_SITE_DB_DEPENDENCIES.md`, migration `20260903160000`). A traffic spike on the public site or a long MCP query degrades the dashboard with no way to tell from the dashboard's own logs.
- **Recommended fix.** At minimum, a connection budget per role (`ALTER ROLE … CONNECTION LIMIT`) and separate PostgREST pools if Supabase tier allows; longer term a read replica or a separate project for the public site.

---

## D. Login-versus-refresh root-cause analysis

### D.1 Verdict

The difference between "after login" and "after refresh" is **not** a race between auth, tenant context and data fetching. It is the difference between a **cold** load (6 + N concurrent calls, some of which time out, with the failures rendered as zeros or skeletons) and a **warm** load (1–2 calls for the families that failed, served from a quieter database, with everything else rehydrated from IndexedDB).

### D.2 Suspects checked

| Suspect (from the brief) | Verdict | Evidence |
|---|---|---|
| Race between auth/session and data fetch | **Not the cause.** | Every dashboard query is gated on `scopeReady = user.id && currentCompany.id && scopeCompanyIds.length > 0` (L404); `CompanyProvider` waits for `authLoading === false` (L349-357). |
| Token refresh race | Not observed. | Session is read synchronously from localStorage by supabase-js; the log shows `organization_members` succeeding 1.4 s after login in the failing burst. |
| Company/tenant context not ready | Not the cause of missing metrics; **secondary divergence on first login only** (P2-2). | `pickInitialCompany` reads metadata that `ProfileSetupGate` writes later. |
| Initial fetch fires before context resolves | No. | Same gate as above. |
| Query keys missing dependencies | No missing dependency that drops data. | Location key excludes raw spellings by design (L16-20); widening invalidates. |
| `staleTime` / `refetchOnMount` / `refetchOnWindowFocus` | **Contributing.** | `retry: 1` with 1 s delay retries into the same window; `refetchOnReconnect/Focus: false` means an errored family never self-heals (P1-2). |
| Stale cache after login | No — the cache is why refresh *works*. | Only successful families are persisted; errored ones refetch on reload (scenario B: 2 requests). |
| Suspense / hydration mismatch | Not applicable. | Client-rendered SPA, no SSR. |
| Server-side caching / CDN | Not applicable. | Netlify serves static assets only; PostgREST responses are not cached. |
| Caching not keyed by user/org | Hygiene issue, not causal (P2-3). | Keys are company-scoped; RPCs enforce access. |
| Background jobs incomplete at login | Not "incomplete for the user"; **competes for the database** (P1-3). | Tick runs every minute regardless of logins. |
| Conditional rendering hiding data when `undefined` | **Yes — the direct cause of the visible symptom** (P0-1, P1-1, P2-1). | `?? 0`, `null` rows, skeleton forever. |
| Async waterfall | Partially: the *shape* of the burst (everything at once) is the trigger (P0-2). | 6 RPCs + 4 pages within ~1.5 s of login. |

### D.3 Timeline of a failing first load (production, 2026-09-10 13:44 UTC)

`t` is relative and reconstructed from the code path; API-log timestamps are request *completion* times, so a call logged at 13:44:25 with `origin_ms` 10,568 started at 13:44:14.

| t (s) | Event | Source |
|---|---|---|
| 0.0 | Sign-in; session persisted; `CompanyProvider` starts `fetchUserCompanies` | `AuthContext.tsx` L30-57, `CompanyContext.tsx` L349-357 |
| 1.4 | `organization_members` 200 (1,400 ms — a light read taking >1 s signals a busy pool) | API log 13:44:25.204 |
| 1.5 | `scopeReady` → `get_scope_prompts`, `get_dashboard_rollups`, `get_scope_stats`, `get_location_rollups`, `get_domain_stats`, `get_competitor_stats` fire concurrently; default location applied | L404-432, L1416-1426, L1616-1664 |
| 1.5 | `get_scope_prompts` 200 (1,463 ms); `get_scope_stats` 200 (2,321 ms) | API log |
| ~3 | prompts arrived → first response pages fire, concurrency 4 | L437-450 |
| ~10 | Postgres cancels the heavy statements at 8 s; PostgREST 500 `57014` for `get_dashboard_rollups` (10,568 ms), 4 × `get_company_responses_page` (10.4–10.6 s), `get_domain_stats` (10,432 ms) | API log 13:44:25.210–.245 |
| ~11 | TanStack retries each failed query once after ~1 s (default `retryDelay`) into the same window | App.tsx L54 |
| ~20 | Retries settle. If `get_dashboard_rollups` is still failing → "Connection Issue" screen (`criticalError`). If only the location family / stream / cubes failed → scorecard paints **0% / n% / 0%**, Themes empty, Prompts skeleton | L632-635, L1784-1788, L2384, L2540, Dashboard L827-831 |
| ~25–40 | User reloads. The API log shows app boots (`organization_members` reads) at 13:42:23, 13:42:25, 13:42:31, 13:42:33, 13:43:40 and 13:44:25, and again at 14:11:26, 14:11:29, 14:11:33, 14:13:28, 14:13:34, 14:13:36, 14:13:55 and 14:13:57 — clusters of reloads seconds apart around each failure burst. Persisted families rehydrate; only the failed families refetch; the database is quieter → 200 | API log; App.tsx L73-92; scenario B |

### D.4 Why the same user sees different subsets missing on different days

Each family fails independently and each has a different failure face: rollups → error screen; location rollups → zeros and empty Themes; stream → Prompts skeleton and empty Sources/Competitors until cubes answer; cubes → "No sources found yet."; prompts → error screen. Which calls cross the 8 s line depends on what else the database is doing in that second. This is the "some parts load, others don't" behaviour, and it is why per-metric patches will not converge.

---

## E. Data-quality assessment

All checks were read-only SQL on 2026-09-11.

| Check | Result |
|---|---|
| Responses whose `confirmed_prompt_id` has no prompt | **0** |
| Responses whose `company_id` disagrees with their prompt's company | **0** |
| Duplicate (prompt, model, tested_at) responses | **0** |
| Active companies with no rows in the per-company sentiment / relevance / attribute-theme tables | **0** |
| Per-company metric tables vs by-location matviews | Consistent where both exist; by-location rows are keyed on raw `location_context` spellings and reconciled client-side (P2-5) |
| `ai_themes.attribute_id` values not in the taxonomy | A long tail of hallucinated ids exists; they are dropped at render time, not at insert |
| Dormant companies | Companies with no new responses for several months keep their last computed sentiment with no "as of" indication (P2-4) |
| Referential integrity of prompts → companies → organizations | Sound; membership chain used by `CompanyContext` resolves for all active users checked |
| Sentiment methodology | v2 ratio `positive / (positive + negative)` applied consistently in per-company tables and by-location matviews (migration `20260719120000`); `null` when no polarised themes, coalesced to `0` only on the client (P0-1) |

**Conclusion:** the missing/zero metrics users see are not caused by missing or inconsistent rows. Where the data model is weak it is in *freshness* and *normalisation*, not integrity.

---

## F. Performance assessment

- **Instance headroom is the limiting factor.** 60 connections, 256 MB shared buffers and 3.5 MB `work_mem` for a 3.2 GB database whose hot path is aggregate scans over multi-hundred-MB matviews. 59 GB of temp-file writes confirms the aggregates spill. Cache hit is 96.4% (good) but the misses are concentrated in exactly the refresh windows.
- **Per-call cost.** Light RPCs (`get_scope_prompts`, `get_scope_stats`) complete in 1.5–2.3 s even under load; the heavy composites (`get_dashboard_rollups`, `get_location_rollups`, `get_domain_stats`, response pages) run 7–10 s under load and sub-second when idle (the 15:00, 16:00, 18:00 and 19:00 UTC hours: slowest 674–755 ms; the 17:00 hour spiked back to 6,915 ms on 76 calls). The variance, not the median, is the problem.
- **Client fan-out.** 6 composites + N first pages + N remaining walks per cold load, with `concurrency` 4 then 2. On a wide scope the full walk takes ~45 s (Dashboard L418) and downloads every response row to compute things the cubes already provide (`scopeStatsQuery` is described at L426-429 as riding "inert" until consumers flip to it).
- **Payload sizes** are managed (slim payloads migration `20260825080000`; IndexedDB instead of localStorage because rollups can exceed 5 MB, App.tsx L70-72). The stream is excluded from persistence, so it is re-walked on every cold load.
- **Background load.** By-location refreshes at 33–98 s each, one per minute-tick with a 60-minute cooldown, plus full requeues (44-minute churn) after methodology migrations.
- **Large-org behaviour.** Scope key = all same-name sibling companies; N grows with markets, so the burst grows linearly and the 8 s budget does not.

---

## G. Recommended changes

### QUICK FIXES (days; no schema changes; remove the reported symptom)

1. **Model the location family's error** (`useDashboardData.ts`): add `locRollupsQuery.error` to `hydration`, expose `locationError`, hold the scorecard skeleton or show inline retry while `locActive && !locRollupsQuery.data`. Replace `?? 0` at L2384 and L2540 with `null` and render "—".
2. **Model the stream's error**: a `streamError` flag; `responsesStreaming` false when errored; Prompts/Sources/Competitors/Themes render a retry state instead of skeleton. (`useDashboardData.ts` L600-640, `Dashboard.tsx` L301, `PromptTable.tsx` L130, the three cards.)
3. **Retry policy** (`App.tsx`, `dashboardQueries.ts`): `retry: 2` with exponential backoff and jitter starting at 3 s; `refetchOnReconnect: true`; a `retryOnMount` that only refetches errored queries; one internal attempt per page.
4. **Stagger the cold burst**: enable the stream only after `hydration.headlineReady && !locRollupsQuery.isPending`; first-page concurrency 2.
5. **Error reporting**: `QueryCache.onError` → Sentry with user/org/company/scope/location/query key/status/PostgREST code/elapsed; keep `console.error`.
6. **Clear cache on sign-out**: `queryClient.clear()` + remove `px-dashboard-cache-v1`.
7. **Move by-location refreshes off-peak** (`refresh_metrics_tick`: only refresh by-location matviews between 00:00–05:00 UTC unless `force_refresh`), and `RAISE LOG` tick phases.

### STRUCTURAL FIXES (weeks; changes contracts, not data)

8. **One async contract per family.** A `DashboardFamily<T> = {status:'loading'|'ready'|'empty'|'error', data:T|null, error?:{code,message,at}, asOf?:string}` produced in `useDashboardData` and consumed by every card; a shared `<FamilyState>` wrapper renders skeleton / empty / error uniformly. Cards stop receiving raw booleans.
9. **Freshness in the payload.** `get_dashboard_rollups` / `get_location_rollups` return `meta: {as_of, refreshed_at:{sentiment,relevance,…}, dirty_queue_position}` from `mv_refresh_state` / the dirty queue; scorecard shows "as of"; queue position > 0 renders as loading, not empty.
10. **Request budget on the client.** A single scheduler (extend `boundedMap`) with a per-tab concurrency of 3 for all dashboard RPCs, headline families first, stream last, cubes on demand.
11. **Server-side `work_mem` for the RPCs.** `SET LOCAL work_mem = '32MB'` inside the SECURITY DEFINER composites (bounded by their small concurrency) so aggregates stop spilling; measure with `EXPLAIN (ANALYZE, BUFFERS)` before/after.
12. **Correlation ids.** `x-px-request-id` and `x-px-scope` headers on every RPC (supabase client `global.headers` + per-call override) and log them from the RPC bodies.
13. **Fix first-login landing** (P2-2): re-pick the company after `ProfileSetupGate` saves.
14. **Normalise location at write time** (P2-5): `location_key` column + trigger; matviews and RPC bucket matching use it; delete the duplicated canonicaliser in SQL.

### LONGER-TERM IMPROVEMENTS (quarters)

15. **Isolate workloads.** Separate Supabase project or read replica for the public website; connection limits per role; consider a larger compute tier — the 60-connection / 256 MB instance is undersized for four concurrent workloads.
16. **Incremental by-location refresh** per company (the per-company table pattern from `20260706120000`) instead of whole-matview `CONCURRENTLY` refreshes.
17. **Stop shipping the raw stream to the browser for metrics.** Every metric on the Overview already has a cube or rollup; move the remaining raw consumers (Prompts table detail, drill-downs) to paginated, on-demand endpoints and drop the full keyset walk from the cold path.
18. **Dashboard health endpoint + status UI**: expose refresh state and last error per family; show a small "data as of / refreshing" indicator instead of the invisible `GlobalFetchIndicator` bar.
19. **Reduce `useDashboardData`** (3,088 lines, ~40 derived values, 6 loading booleans) into per-family hooks over the async contract, which is what makes the loading-state tests in H possible.

---

## H. Testing strategy

**Unit (Vitest — the repo has no test runner today; add `vitest` + `@testing-library/react`)**
- `aggregateSentimentRows`, `aggregateRelevanceRows`, `canonicalizeLocationContext`, `sentimentRatioV2`: null-safe, empty-safe, spelling variants.
- The metric selector: given `locActive` and `{loc: error, company: ready}` the output is `null`, never `0`.
- `hydration` / `FamilyState` reducer: every combination of `{pending, success, error}` × `{data, no data}` for each family maps to exactly one of loading / ready / empty / error.

**API / integration (against a Supabase branch or a seeded local stack)**
- Each RPC: shape snapshot (families present, `[]` for empty, `meta` present), access guard (foreign company id → empty, not error), and a timing budget under `EXPLAIN ANALYZE` with a fixed dataset (fail the test if the plan spills to disk).
- `get_company_responses_page`: keyset continuity (no gaps/duplicates across pages), page shrink behaviour.
- `refresh_metrics_tick`: idempotent; respects cooldown and the off-peak window; logs phases.

**Frontend (React Testing Library + MSW mocking PostgREST)**
- Scenario matrix from the reproduction: each family individually returns `500 57014` on attempts 1..k, then 200. Assert: no `0%` from a missing family; the errored region shows retry; retry succeeds; nothing else on the page regresses. This is the test that would have caught P0-1 and P1-1.
- Cache tests: sign-out clears the persisted store; a rehydrated success + a failed refetch shows a stale indicator, not zeros.

**End-to-end (Playwright, extend `docs/audits/data-reliability-2026-09-11/repro/run.cjs`)**
- Fresh login vs refresh equivalence: run the same account through cold load and reload with a healthy mock and assert identical scorecard values; then with each fault injected and assert the error states.
- Slow-network profile (Playwright `route` delay of 9 s on one family) to exercise the timeout path.
- Run in CI on every PR that touches `src/hooks/useDashboardData.ts`, `src/hooks/dashboard/`, `src/pages/Dashboard.tsx`, `src/components/dashboard/`.

**Data integrity (pg_cron nightly + `admin_data_health`)**
- The E-table checks as assertions: orphans = 0, company mismatch = 0, duplicates = 0, active companies with missing metric rows = 0, unknown `attribute_id` count below a threshold, `mv_refresh_state.last_status` never `error` for > 2 h, max `last_refresh_finished` age per family.
- Alert (email/Slack) when any assertion fails; surface the same in the admin health page.

---

## I. Implementation plan (safest order)

1. **Observability first** — add Sentry with query-cache error hook and request-id headers (`src/App.tsx`, `src/integrations/supabase/client.ts`, `src/hooks/dashboard/dashboardQueries.ts`). No behaviour change; gives a baseline failure rate before any fix.
2. **Model the location family's error and remove `?? 0`** (`src/hooks/useDashboardData.ts` L632-640, L1719-1745, L1784-1788, L1853-1875, L2380-2384, L2540; `src/components/dashboard/OverviewTab.tsx` L1258-1267 render `null` as "—", plus an inline retry). Ship with the MSW scenario test.
3. **Model the stream error** (`useDashboardData.ts` L600-640; `Dashboard.tsx` L301; `PromptTable.tsx` L130; `SourcesSummaryCard.tsx` L339; `CompetitorsSummaryCard.tsx` L341; `ThematicAnalysisTab.tsx` L784/L800; `AttributesSummaryCard.tsx` L361-378).
4. **Retry policy and cold-burst staggering** (`src/App.tsx` L54-58; `useDashboardData.ts` L437-463; `dashboardQueries.ts` L231-250, L282, L308).
5. **Cache hygiene** — user id in keys, clear on sign-out, buster bump (`dashboardQueries.ts` L9-30; `App.tsx` L73-92; `src/contexts/AuthContext.tsx` L63-70).
6. **Database: off-peak by-location refresh + tick logging + `SET LOCAL work_mem` in composites** — one additive migration touching `refresh_metrics_tick`, `get_dashboard_rollups`, `get_location_rollups`, `get_domain_stats`, `get_competitor_stats`. Verify with `EXPLAIN (ANALYZE, BUFFERS)` on a branch first.
7. **Freshness meta in RPC payloads + "as of" in the scorecard** — additive migration (new `meta` key), `dashboardQueries.ts` types, `OverviewTab.tsx`.
8. **Async contract refactor** — introduce `DashboardFamily<T>` and `<FamilyState>`; migrate cards one at a time (Attributes → Sources → Competitors → Prompts → Thematic), each behind the scenario tests.
9. **First-login landing** (`src/components/onboarding/ProfileSetupGate.tsx` L101-112; `src/contexts/CompanyContext.tsx` L262-285, L349-357).
10. **Location normalisation at write time** — migration adding `location_key` + trigger + backfill (additive, non-destructive), then switch matviews/RPCs, then remove the SQL-side canonicaliser.
11. **Test infrastructure in CI** — Vitest + RTL + MSW, Playwright suite from the repro harness, nightly data-integrity job.
12. **Workload isolation and instance sizing** — connection limits per role now; separate project/replica for the public site and a compute-tier decision after 2–4 weeks of Sentry data from step 1.

---

## Appendix — Reproduction

`docs/audits/data-reliability-2026-09-11/repro/README.md` documents the harness. Summary of results (`results.json`):

| Scenario | Fault injected | Sentiment | Visibility | Relevance | EPS | Themes | Error shown | RPC calls |
|---|---|---|---|---|---|---|---|---|
| A · first load | `get_location_rollups` → 500 `57014` on attempts 1–2 | **0%** | 70% | **0%** | **21** | empty | none | 8 (2 failed) |
| B · refresh | none | 82% | 70% | 63% | 75 | present | none | 2 |
| C · stream failure | `get_company_responses_page` → 500 on every attempt | — | — | — | — | — | none; Prompts skeleton after 6 attempts / 46.8 s | 6 page attempts |

Screenshots: `A_first_load.png`, `B_refresh.png`, `C_stream_failure.png` in the same folder.
