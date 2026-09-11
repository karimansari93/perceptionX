# Dashboard observability

Error reporting for the dashboard data path, added as Phase 3 of the
remediation in `docs/audits/DATA_RELIABILITY_AUDIT_2026-09-11.md` (finding
P1-4: no production signal for a failed dashboard request).

## What is reported

Every dashboard query family that ends in error (after the query-level retry)
produces one structured record:

| Field | Source |
|---|---|
| `family` | query key: `prompts`, `rollups`, `stats`, `location`, `domains`, `competitors`, `responses_first`, `responses_full` |
| `rpc` | the PostgREST function behind the family (`get_location_rollups`, …) |
| `http_status` | PostgREST HTTP status of the failing attempt |
| `pg_code` | PostgREST / SQLSTATE error code (`57014` = statement timeout) |
| `elapsed_ms` | wall-clock time of the failing attempt, measured in the RPC helper |
| `user_id`, `organization_id`, `company_id` | set by `AuthContext`, `CompanyContext` and `useDashboardData` |
| `scope_key`, `location_key` | the brand scope (sorted sibling company ids) and canonical location the user was looking at |
| `message` | the PostgREST error message, capped at 200 characters |

Each *attempt* (including the retry) also leaves a Sentry breadcrumb with the
RPC, status, code and elapsed time, and a successful RPC slower than 5 s
leaves an informational one — the audit showed "healthy" hours running one
second under the 8 s statement timeout.

## What is never sent

Request or response bodies, prompt or response text, e-mail addresses, names,
auth tokens or API keys. Sentry is initialised with `sendDefaultPii: false`;
the user object carries only the id; request headers, cookies and data are
stripped in `beforeSend`.

## Transport

* **Sentry** — enabled when `VITE_SENTRY_DSN` is set at build time (Netlify
  environment variable). Optional `VITE_SENTRY_ENVIRONMENT` (defaults to the
  Vite mode). Events are grouped per `(family, error code)`, so one issue
  reads "location rollups failing with 57014" with the affected users,
  companies and scopes listed as tags/context. The Content-Security-Policy in
  `index.html` allows the `*.ingest.sentry.io` hosts.
* **Without a DSN** — the same records are kept in an in-memory ring buffer
  (last 50) exposed as `window.__pxDashboardErrors`, so a session can still be
  inspected from the browser console. Nothing leaves the browser.

## Answering "why did this user see no sentiment at 10:42?"

1. Sentry → issue `dashboard-query / location / 57014` → filter by
   `user_id` / `company_id` tag and time. The event shows the RPC, status,
   elapsed time, scope and location key, plus breadcrumbs for both attempts.
2. Cross-check the Supabase API log for that minute: the same RPC path with
   the same status and `origin_ms` ≈ `elapsed_ms`.
3. The UI state at that moment is deterministic from the report: a `location`
   failure renders sentiment/relevance/EPS as "—" with a Retry (never 0%),
   `responses_*` failures render the stream error state, `rollups`/`prompts`
   failures render the page-level "Connection Issue" screen.

## Code

* `src/lib/observability.ts` — init, context, reporting, ring buffer.
* `src/hooks/dashboard/dashboardQueries.ts` — the RPC helper attaches
  `rpc`, `status`, `elapsedMs` to every error and records attempts.
* `src/App.tsx` — `QueryCache.onError` → `reportDashboardQueryError`; the
  React error boundary → `reportRenderError`.
* Tests: `src/test/observability.test.ts`, and the integration assertion in
  `src/test/dashboard-reliability.test.tsx` (scenario 1).
