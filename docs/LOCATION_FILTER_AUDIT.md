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

**D6 — Reports section hides the control but keeps the filter.** `Dashboard.tsx:762`
passes `selectedLocation={undefined}` to the header on the reports section, hiding the
dropdown — but the hook state stays active, so report inputs derived from `responses`
remain location-filtered with no visible indicator.

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
