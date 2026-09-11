# Login-vs-refresh reproduction harness

Deterministic reproduction of the "first load shows 0% sentiment / 0% relevance / empty themes, refresh fixes it" symptom, used as evidence in `../../DATA_RELIABILITY_AUDIT_2026-09-11.md`.

The harness runs the real frontend against a fully mocked PostgREST/Auth backend (Playwright `route` interception), so it never touches production. It seeds a fake session in `localStorage` (`sb-<project-ref>-auth-token`), answers every table read and RPC with the fixtures in `fixtures.cjs` (shapes mirror the RPC contracts in `supabase/migrations/20260811090000`, `20260825080000`, `20260825120000`, `20260825160000`, `20260825200000`), and injects faults that answer exactly like production did on 2026-09-10 (HTTP 500, body `{"code":"57014","message":"canceling statement due to statement timeout"}`).

## Scenarios

| Scenario | Fault | What it shows |
|---|---|---|
| A · first load | `get_location_rollups` → 500 on attempts 1–2 (the first try and the single TanStack retry) | Scorecard renders Sentiment 0% / Visibility 70% / Relevance 0%, EPS 21, "No attribute mentions found yet.", no error state |
| B · refresh | none (same tab, `page.reload()`) | 82% / 70% / 63%, EPS 75, themes present; only 2 RPC calls because the other families rehydrate from IndexedDB |
| C · stream failure | `get_company_responses_page` → 500 on every attempt | 6 page attempts over ~47 s, then the Prompts page stays on a skeleton with no error |

Results are in `results.json`; screenshots in `A_first_load.png`, `B_refresh.png`, `C_stream_failure.png`.

## Running it

```bash
npm ci
npx vite --port 8080 --host 127.0.0.1 &      # dev server; .env must define VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
APP_URL=http://127.0.0.1:8080 OUT_DIR=/tmp/repro node docs/audits/data-reliability-2026-09-11/repro/run.cjs
```

Playwright and a Chromium binary must be available (`npx playwright install chromium` on a machine that does not have one). All calls to `/functions/v1/` and to third-party hosts are aborted so the run is hermetic.

## Adapting it

- Change the `faults` map in `run.cjs` to fail any RPC on any attempt number, e.g. `{ get_dashboard_rollups: (n) => n <= 2 }` reproduces the "Connection Issue" screen, `{ get_domain_stats: () => true }` reproduces "No sources found yet." after the stream lands.
- `fixtures.cjs` exports one company, six prompts, two months of rollups and twelve responses; widen `prompts` / `responsesPage` to test larger scopes.
