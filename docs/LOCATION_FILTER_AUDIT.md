# Location Filter & "All Locations" State Audit

**Date:** 2026-07-17
**Scope:** `selectedLocation` state management, the "All locations" semantics, and which
dashboard data does / doesn't honor the location filter.

**Trigger:** "Sometimes we're filtered on all locations, but I see it's filtered for a
specific country. I don't know if all locations actually means an aggregated dataset."

---

## TL;DR

Both halves of that observation are real, and both have concrete causes:

1. **"All locations" is not an aggregated dataset across countries.** It means "the
   current company row, with no in-company filter applied." Accounts using the legacy
   model (one company row per country, e.g. Netflix-US / Netflix-JP) will see
   single-country data under an "All locations" label, because the other countries live
   in *sibling company rows*, not in the current dataset.
2. **The trigger label and the actual filter state can disagree.** The dropdown trigger
   falls back to "All locations" whenever `selectedLocation` doesn't resolve to a known
   option — which happens transiently (and sometimes persistently) after company
   switches, starred-view restores, and stale selections. So the UI can say "All
   locations" while internal state still holds a country key, or say nothing while a
   silent reset has occurred.

Beyond that headline, the filter is applied through **two parallel implementations**
(client-side raw-string matching for responses, server-side MV queries for metrics) that
can drift, and several derived datasets don't honor the filter consistently.

---

## 1. Architecture: two location models coexist

| | Legacy model | Current model |
|---|---|---|
| Unit | One company **row per (name, country)** — `companies.country` code | One company row; **`confirmed_prompts.location_context`** free-form string per prompt |
| "Filter" action | **Switch company** (different dataset entirely) | Filter responses + query `_by_location_mv` views |
| Values | ISO codes (`US`, `JP`), `GLOBAL` sentinels | Free text: "United States", "the Netherlands", "Burbank", "Sydney", `GLOBAL`, null |

`buildLocationOptions()` (`src/utils/locationContext.ts:120`) merges both into one
dropdown: in-company `location_context` values become `filter` entries; same-name sibling
companies in other countries become `switchCompany` entries. The two entry types look
identical to the user, but one filters and the other **navigates to a different company**.

### State inventory

| State | Where | Persistence |
|---|---|---|
| `selectedLocation` (canonical key or `null` = All) | `useDashboardData.ts:196` | In-memory only; restored via starred view |
| `pendingLocationRef` (apply-after-company-switch) | `useDashboardData.ts:1818` | ref |
| Starred view (location + period) | `useStarredView.ts` | `localStorage`, **per user, not per company** |
| `selectedPeriod` | `useDashboardData.ts:154` | In-memory + starred view |
| `selectedJobFunction` | `Dashboard.tsx:179` | `sessionStorage` |

Three filters, three different persistence models — part of why filter state "feels"
inconsistent across reloads and company switches.

---

## 2. Why the UI shows "All locations" while data is country-scoped

### 2.1 Legacy sibling-row accounts (semantic cause — the big one)

For a company row whose prompts are all tagged one country (or an old row with no
`location_context` at all), the unfiltered dataset **is** that country's data. The label
"All locations" is technically true ("no in-company filter") but reads as "aggregated
across every location," which it is not. The other countries are only reachable via the
`switchCompany` dropdown entries.

**There is no view that aggregates sibling company rows.** "All locations" never sums
Netflix-US + Netflix-JP.

### 2.2 Label fallback hides a stale selection (state-management cause)

`LocationFilter.tsx:74`: `displayName = selectedEntry ? selectedEntry.label : 'All locations'`.
Any `selectedLocation` value with no matching option renders as "All locations" — with no
checkmark anywhere in the menu. Ways to get such a value:

- **Company switch with a pending location** (`CompanySwitcher.tsx:77`): the target
  company's country code is canonicalized (e.g. `US` → `united states`) and applied after
  the switch — but if the target row's prompts don't carry that spelling in
  `location_context` (typical for legacy rows), the key resolves to zero raw values.
  Trigger shows "All locations"; metrics fall back to company-wide (which is the
  country's data — see 2.1). The mismatch is then silently cleaned up by the reconcile
  effect.
- **Starred view restore** (`Dashboard.tsx:218`): applied once per user regardless of
  which company is current. Star "United States" while on company A; open the app on
  company B → invalid key applied, shows as "All locations", then silently wiped.
- **Sibling-row location pick** (`LocationFilter.tsx:53`): picking a `switchCompany`
  entry stashes the canonical key and switches company; same failure mode as above when
  the target row has no matching `location_context`.

### 2.3 Silent resets

The reconcile effect (`useDashboardData.ts:2023`) nulls invalid selections with no user
feedback — the filter just "flips back" to All locations. It also only runs when
`responses.length > 0`, so a company whose eager 180-day window has zero responses keeps
a stale selection indefinitely.

---

## 3. State-management defects

**S1 — Two sources of truth for "what filter is active".** The trigger label derives from
`options` (built from loaded responses); the data scoping derives from
`locationRawValues[selectedLocation]`. There's no enforced invariant that a non-null
`selectedLocation` is a member of `options`, so label/data agreement depends on timing
(see 2.2). *Fix direction:* render an unresolved selection explicitly (e.g. the
title-cased key + "no data for this view") instead of falling back to "All locations",
or reconcile synchronously with the options build.

**S2 — Pending-location path bypasses the guarded setter.** The public
`setSelectedLocation` (`useDashboardData.ts:220`) flips `locationMetricsLoading`
synchronously to prevent painting half-swapped content. But the company-change effect
applies pending locations via `setSelectedLocationState` directly
(`useDashboardData.ts:1827`), so a sibling-row switch paints company-wide numbers for a
tick or two before the location-scoped fetch effect raises the flag — exactly the flash
the setter exists to prevent.

**S3 — Starred view is per-user, not per-company.** `dashboard.starredView:{userId}`
stores one location+period globally. Multi-company users get their starred location
applied to whichever company loads, then silently wiped if invalid — and the star icon
still shows a saved view that isn't actually active. *Fix direction:* key by
`{userId}:{companyId}` and re-apply on company switch.

**S4 — Reconcile-effect blind spot.** Guarded by `responses.length === 0` (see 2.3):
zero-response companies never reconcile.

**S5 — `LocationFilter` hides entirely when `options.length === 0`** — so while
responses load there is no location control at all, and after load it may reappear with
different state. Combined with S1, users can't tell whether a filter is active during
loading.

---

## 4. Scoping inconsistencies — which data honors the filter

When a location is active, scoping happens through **two independent mechanisms**:

- **Responses** (visibility, prompts table, competitors/citations fallbacks): client-side
  exact match of trimmed raw `location_context` strings (`matchesLocation`,
  `useDashboardData.ts:1849`).
- **Sentiment / relevance / sources / competitors / LLM rankings / attribute themes**:
  server-side `.in('location_context', rawValues)` against `*_by_location_mv` views.

They agree only because both key on the same raw-spelling set — which is derived
**exclusively from the 180-day eager response window**. That produces:

**D1 — Historical spellings are silently dropped.** If an older month stored a spelling
that no longer occurs in recent data ("the United States", "USA"), its MV rows are
excluded from location-scoped sentiment/relevance history, skewing per-month trends. A
location present *only* in old data never appears in the dropdown at all.

**D2 — Period list ignores the location filter.** `availablePeriods`
(`useDashboardData.ts:1788`) is built from unfiltered responses. With a location active,
the period dropdown offers months with zero in-location data; picking one yields
visibility 0% while sentiment falls back to the location's all-months aggregate
(`useDashboardData.ts:2355`) — a mixed-scope scorecard.

**D3 — Month bucketing is inconsistent.** `responseMonthKey` (`useDashboardData.ts:127`)
documents that `response_month` is the canonical bucket. `periodFilteredResponses`
follows it, but `epsTrend` (`:2525`), `epsTrendByJobFunction` (`:2670`) and the
visibility part of `previousPeriodMetrics` (`:2139`) bucket by `tested_at` date ranges.
A run collected May 30 but tagged June lands in different months depending on the metric
— headline vs. sparkline can disagree.

**D4 — `sentimentTrend` ignores every filter** (location, period, and the
`isOverallCandidateExperience` exclusion) because it iterates raw `responses`
(`useDashboardData.ts:2721`). It's currently dead — destructured in `Dashboard.tsx` but
never rendered — so this is a delete-or-fix, not a live bug.

**D5 — General/no-location bucketing is a fragile implicit contract.** `GENERAL_KEY`
matching depends on the MVs bucketing `NULL`/empty as `''` and keeping `GLOBAL` spellings
verbatim (`20260628000000_codify_by_location_mvs.sql:35`), mirrored by `generalBuckets`
in `buildLocationOptions`. It works today but nothing ties the two together — a change on
either side breaks "General" silently.

**D6 — ~~Reports section hides the control but keeps the filter.~~** *Correction after
deeper inspection:* `CustomReports` is self-contained and does not consume the
dashboard's filtered `responses`, so hiding the control on the Reports section is
correct UX, not a data inconsistency. Withdrawn.

**D7 — Benchmarks key on display labels.** `selectedMarketName` (`Dashboard.tsx:195`) is
the option *label* ("United States", "Burbank"), fed to `competitor_benchmarks_mv.market`
and through `marketNameFromLocation` (which expects a country *code* — labels only pass
through because of the `?? location` fallback). On "All locations", `market` is null and
benchmarks vanish rather than showing a global benchmark.

**D8 — Dead wiring suggesting drift.** `PromptsTab` accepts a `selectedLocation` prop it
never uses; `CompanySwitcher` accepts `onLocationChange` and never calls it; retired
search-insights and recency merge paths still sit in `topCitations`/`topCompetitors`.

---

## 5. What works well (keep)

- Canonicalization (`canonicalizeLocationContext`) collapsing ISO codes / article
  prefixes / case is solid and well-commented.
- The `locActive` fallback (invalid selection → company-wide data instead of empty
  0%-metrics) is the right failure mode; the problem is only that it's invisible.
- Stale-fetch guards (`requestedCompanyId` / `isStale()`) around company switches are
  thorough.
- The `effective*` selector pattern gives a single seam where location-scoped vs
  company-wide data is chosen — the right structure to build on.

---

## 6. Recommended fixes, in order

1. **Decide and label the semantics** (product + copy): either rename the null state to
   reflect reality ("All locations · this company") or build true cross-row aggregation
   for sibling-company accounts. Cheapest high-impact fix for the reported confusion.
2. **Make the trigger honest (S1):** never render a non-null `selectedLocation` as "All
   locations". Show the selection with an explicit no-data/stale affordance, and surface
   reconcile resets (toast or badge) instead of silent flips.
3. **One setter for all mutations (S2):** route pending-apply and starred-restore through
   `setSelectedLocation` so the loading gate behaves uniformly.
4. **Canonicalize server-side (D1):** add a canonical location column to the
   `_by_location_mv` views (same normalization as `canonicalizeLocationContext`) and
   filter by canonical key. This removes the raw-spelling round-trip, makes client and
   server filters identical by construction, and fixes >180-day history.
5. **Scope the period list (D2)** to the active location, and **unify month bucketing on
   `responseMonthKey` (D3)**.
6. **Per-company starred views (S3)** keyed `{userId}:{companyId}`.
7. **Delete dead code (D4, D8):** `sentimentTrend` export, unused props, retired search
   and recency merge paths.
8. **Add tests:** unit tests for `canonicalizeLocationContext` / `buildLocationOptions`
   (spelling collapse, GENERAL bucketing, sibling merge) and an integration test for
   company-switch + pending-location and starred-restore flows — the two paths where
   label/state desync originates.

---

## 7. Fixes applied on this branch

| Finding | Status | How |
|---|---|---|
| S1 label/state desync | **Fixed** | `LocationFilter` renders an unresolved selection under its own name (via `labelForCanonicalKey`; `__general__` → "General") instead of masquerading as "All locations". |
| S2 pending path bypasses guarded setter | **Fixed** | Company-entry location application (pending → starred → null) moved into one hook effect that raises `locationMetricsLoading` on the same tick; the location-scoped fetch effect keeps the flag up until the company's responses (and thus the raw-value sets) are final, so swaps render skeletons, never half-swapped numbers. |
| S3 starred view leaks across companies | **Fixed** | `StarredView` now records `companyId`; it only auto-applies on that company. Legacy entries self-migrate (stamped with the first company they apply on). `pickInitialCompany` lands login directly on the starred company, so the star restores (company + location + period) coherently. |
| S4 reconcile blind spot (zero-response companies) | **Fixed** | New `responsesLoadedCompanyId` marks when a company's responses are FINAL (all pages / empty / cache); reconcile judges on that instead of `responses.length > 0`. Also fixed the related `isSwitchingCompany` flag sticking `true` forever for zero-response companies (which kept sources/competitors empty even with MV data). |
| D1 historical spellings dropped from MV queries | **Fixed (client-side)** | Distinct all-time `location_context` buckets are fetched from `company_llm_rankings_by_location_mv` and widen the raw-spelling sets **extend-only** (existing entries only — locations absent from the 180-day window still don't get dropdown entries, since they'd render empty prompts/visibility). Server-side canonicalization (rec. #4) remains the structural follow-up. |
| D2 period list ignores location | **Fixed** | `availablePeriods` is built from the location-filtered `visibleResponses`. |
| D3 mixed month bucketing | **Fixed** | `epsTrend`, `epsTrendByJobFunction`, and previous-period visibility all bucket by `responseMonthKey` (snapshot month), matching the period filter. |
| D4 dead `sentimentTrend` | **Fixed** | Removed (memo, export, consumer destructure). |
| D5 GENERAL bucketing contract | Open | Still an implicit frontend↔MV convention; needs a test or shared constant. |
| D6 Reports hides control but keeps filter | **Withdrawn** | Reports is self-contained; see corrected finding above. |
| D7 benchmarks keyed on labels; no global benchmark | Open | Needs `competitor_benchmarks_mv` semantics (defined outside this repo's migrations). |
| D8 dead wiring | **Fixed** | Unused `PromptsTab.selectedLocation` and `CompanySwitcher.onLocationChange` props removed. Retired search/recency merge paths left in place (inert) for a separate cleanup. |
| §2.1 "All locations" ≠ cross-row aggregate | **Fixed — see §8** | Product decision made (2026-07-17): "All locations" now truly aggregates same-name sibling profiles. |
| Silent reconcile resets (§2.3 feedback) | Open | Resets are now far rarer (S1–S4), but still silent; a toast/badge is a UX follow-up. |

---

## 8. Cross-profile aggregation (product decision, 2026-07-17)

Decision: **"All locations" must mean all locations of the brand**, including the
legacy per-country company profiles. Implemented as follows:

**Brand scope.** The scope is the **current company plus its same-name siblings
_in the same organization_** (`scopeCompanies` in `useDashboardData`). The
`organization_id` constraint is load-bearing: matching on name alone once
grouped identical brand names across unrelated client organizations (a
multi-org admin got an 18-profile scope), which both mixed tenants and produced
statement-timeout-heavy queries. A `MAX_SIBLINGS = 9` cap (10 profiles total)
guards against a runaway group. The list is deterministically sorted by id.

**Query shapes (this is the part the first deploy got wrong).** Do NOT fetch
the scope with one `.in('company_id', scopeIds)` on a large row-level table:
`.in(...) + ORDER BY tested_at + OFFSET` cannot ride the `(company_id,
tested_at)` index, so Postgres gathers and sorts the whole window across every
profile — the shape that hit the ~8s statement timeout and returned HTTP 500s.
Instead:
- **Heavy row-level fetches** (`prompt_responses_canonical` response pages and
  the attribute pass, `ai_themes`, `company_response_sentiment_mv`,
  `company_attribute_themes_mv`, and the `company_sentiment/relevance_scores_mv`
  metric fetches) run **one indexed `.eq('company_id', id)` pagination per scope
  profile**, merged client-side.
- **Small grouped rollup MVs** (`company_top_sources_mv`, `company_competitors_mv`,
  `company_llm_rankings_mv`) and `confirmed_prompts` may use `.in(...)`, but
  still **paginate** — PostgREST's `max_rows` (1000, in `supabase/config.toml`)
  silently clamps every response regardless of `.limit()`, so an unpaginated
  request drops rows with no error. Top-N rollups fetch per-company (each with
  its own `.limit`) so a key that ranks modestly in every profile isn't cut
  before the merge.
- Every paginated query carries a **stable `ORDER BY`** (the MV's unique-index
  columns). The by-location tables are plain tables rebuilt by DELETE+INSERT, so
  unordered OFFSET pages can duplicate or skip rows mid-refresh.

Metrics that can repeat a key across companies (sources, competitors, LLM
rankings, attribute themes) are summed client-side via `sumRowsBy` /
`aggregateAttributeThemeRows`. "All locations" therefore shows a true
cross-profile aggregate.

**Visibility is rollup-first.** `company_visibility_by_location_mv` (migration
`20260717150000`) precomputes mentioned/total per (profile, location bucket,
snapshot month, job function), mirroring the frontend conventions exactly
(response_month-first bucketing, `''` untagged bucket, Overall Candidate
Experience excluded). The hook loads it once per brand entry
(`visibilityMvRows`), scopes it to the active location with the same
attribution rule as responses (`visibilityRowsForSelection`), and every
visibility consumer (`metrics`, `previousPeriodMetrics`, `epsTrend`,
`metricsByJobFunction`, `epsTrendByJobFunction`) prefers it via
`visibilityFromMvRows(rows, monthKey, jobFn)` — exact numbers independent of
how much of the raw response stream has arrived, with silent fallback to
response counting when no rollup rows match (MV not yet refreshed).

**One attribution rule.** `resolveResponseLocationKey` (locationContext.ts):
a response belongs to its prompt's `location_context` if tagged, **else to its
company's `country`**, else to "General". The rule is applied identically by:
- the dropdown builder (entries seeded from every profile's country, so a
  country profile is always selectable even with no recent responses loaded),
- the client-side response filter (canonical matching — raw-spelling drift no
  longer matters for responses), and
- the location-scoped MV queries: profiles *owned* by the selection (their
  country attributes to it) contribute all their buckets except those tagged
  with a different location; other profiles contribute only buckets tagged with
  the selection's spellings.

**Countries are filters now.** Selecting a country in the location dropdown
never switches company (the `switchCompany` entry type is gone). The company
switcher's per-country submenu still exists and still lands on that profile —
but it also sets the country filter, and since the scope is the whole group,
the numbers are identical either way.

**Consequences worth knowing:**
- Legacy sibling profiles' untagged prompts no longer pollute "General" — they
  belong to their profile's country. "General" is only offered when countryless
  profiles have untagged prompts.
- A single-profile company with `country = US` now shows a "United States"
  entry (its whole dataset) — making the scope visible instead of hiding it
  behind "All locations".
- Benchmarks (D7) still key on a single market label and remain hidden on the
  aggregated "All locations" view.
- The per-company response cache is keyed by the entered profile's id; entering
  the brand through a different sibling re-fetches the same merged scope (a
  cache-key refinement is possible later).

## 9. Raw ai_themes pagination goes through an RPC (2026-07-20)

Raw `ai_themes` rows are fetched **per drilldown attribute, on demand**
(`fetchAIThemesForAttribute`), not in bulk. The Thematic tab's main ranking is
MV-driven; only an open drilldown needs row-level data (subtheme names,
response links for quotes/sources/visibility), so nothing is fetched until one
opens, and rows accumulate per drilled attribute. The old design bulk-loaded
the whole window on tab mount: ~130 requests / ~130k rows in browser memory on
an 18-profile brand. A subtheme-level rollup MV was measured and rejected —
LLM-generated theme names are ~75% unique (Ford US: 18,640 raw rows → 14,017
distinct names), so a (theme_name, month, fn) grain barely compresses; a
per-attribute fetch is ~1–3 pages per scope profile and preserves exact
response-level scoping (periods, locations, job functions).

The fetch does **not** use a PostgREST table read. It calls the
`ai_themes_keyset_page` RPC (optional `p_attribute_ids text[]` filter — the
v2 id plus its legacy v1 aliases), one keyset pagination per scope profile,
1000 rows/page, 180-day window, all pages through `withDbSlot`. Two measured
reasons (18-profile Ford brand, ~130k themes in window):

**PostgREST's keyset encoding defeats the index.** The cursor had to be
expressed as `or=(created_at.lt.X,and(created_at.eq.X,id.lt.Y))`, and Postgres
cannot use an OR as a btree boundary. EXPLAIN showed every page re-scanning all
previously-fetched rows and filtering them out (`Rows Removed by Filter:
10000` on page 10) — page N cost O(N × 1000), the exact OFFSET pathology
keyset was meant to avoid, and why deep pages crossed the ~8s statement
timeout. The RPC's row-value comparison `(created_at, id) < (X, Y)` is an
exact boundary on `idx_ai_themes_company_created_id` (company_id, created_at
DESC, id DESC — migration `20260720090000`, supersedes the old 2-column
index), so every page is O(page size) regardless of depth.

**Per-row RLS was the other half of the cost.** The `ai_themes` select policy
calls `user_can_access_company(company_id)` — a non-inlinable SECURITY DEFINER
helper (~97 buffer hits/call) — per scanned row: 1.6s for a single 1000-row
page *even with a perfect index boundary*. The RPC is SECURITY DEFINER and
evaluates the identical predicate once against its `p_company_id` argument
(equivalent, since every returned row has that company_id; zero rows on
failure, mirroring RLS filtering). Worst-case page: ~8s → ~8ms.

Constraints that still hold: per-company `.eq`-equivalent queries only (the
RPC takes a single company id — scope profiles are still paginated separately
and merged client-side), stable ordering `(created_at DESC, id DESC)`,
PostgREST `max_rows` clamps RPC responses at 1000 exactly like table reads,
and every call rides `withDbSlot`. If the RPC's shape changes, keep the
row-value cursor and the once-per-call access check — reverting to either the
OR-form predicate or a per-row policy check reintroduces the timeout.

Accumulation caveat: consumers that opportunistically scan `aiThemes`
(OverviewTab's key-themes / attribute-insights memos) now see
partial-by-attribute data — the same class of partiality as the old "empty
until the Thematic tab was visited" behavior, and never partial within an
attribute. Accumulated rows are invalidated on company switch, scope change,
and explicit refresh (the open drilldown refetches automatically), and are
deliberately not written to the per-company switch-back cache.

The same per-row `user_can_access_company()` cost applied to the select
policies of the seven per-company rollup tables (`company_response_sentiment_mv`
etc. — ~30k first-paint rows per brand entry, 200ms per 1000 rows) and to
direct `ai_themes` reads. Migration `20260720100000` rewrote those eight
select policies to the hashable `(select is_admin()) OR company_id IN
(select …)` form that `prompt_responses` / `confirmed_prompts` already used:
the membership subquery runs once per statement and each row is a hash probe
(200ms → 1.7ms per 1000 MV rows, verified member/non-member/admin-equivalent
in production). Any new per-company table's select policy should use the same
IN form, not a bare `user_can_access_company(company_id)` call.
