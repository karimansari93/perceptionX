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

## Known follow-ups (deliberate scope cuts)

- Citations dominate the remaining stream payload (~2.5 MB/1000 rows). Split
  them into a lazy per-tab fetch (Sources drilldowns) to cut hydration
  another ~40%.
- The stitch + memo cascade over the full row set still blocks the main
  thread for seconds on 40K-row scopes when the full stream commits — chunk
  it or move it to a worker.
- Persist the rollups/prompts cache to IndexedDB (`persistQueryClient`) for
  Linear-style warm starts across reloads.
- A per-job-function rollup MV would let scorecard function switching drop
  its raw-row dependency entirely.
- `get_dashboard_rollups` returns full `to_jsonb` rows for sentiment/
  relevance (~12 MB raw, ~1 MB gzipped); typed column lists would halve it.
- The one-per-minute `refresh_metrics_tick` (mean 12.6 s) is the biggest
  background I/O consumer; batching/off-peak scheduling would reduce read
  contention.
