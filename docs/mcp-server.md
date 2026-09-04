# PerceptionX MCP Server

Clients ask their AI assistant questions like **"@PerceptionX what's our culture like in India?"** — ChatGPT/Claude calls our remote MCP server, which answers from the same rollup cubes the dashboard reads, org-scoped and read-only.

## Architecture

```
ChatGPT / Claude / Claude Code
        │  MCP (Streamable HTTP, JSON) + OAuth 2.1
        ▼
https://app.perceptionx.ai/mcp          ← Netlify proxy (public/_redirects)
https://app.perceptionx.ai/.well-known/… ← OAuth discovery at domain root
        │
        ▼
supabase/functions/mcp-server           ← OAuth AS + MCP JSON-RPC
        │
        ▼
supabase/functions/_shared/px-tools     ← SHARED tool layer (16 tools)
        │                                  also consumed by chat-with-data
        ▼
Dashboard stats cubes via service-role twin RPCs (mcp_get_rollups,
mcp_get_domain_stats, mcp_get_competitor_stats, mcp_get_attribute_competitors,
mcp_get_measurement_periods, mcp_get_theme_stats, mcp_get_attribute_sources)
```

**One tool layer, two transports.** `chat-with-data` (the in-app analyst, admin-only at `/chat`) and `mcp-server` execute the identical `px-tools` registry — same numbers, same `_coverage`/`_meta` caveats. The in-app chat is the development/eval harness for what external hosts consume.

**Self-caveating payloads.** Over MCP our system prompt does not travel — only `initialize.instructions`, tool descriptions, and result payloads reach the host model. So every result embeds `_coverage` (found/partial/no_data), `_meta.periods` / `_meta.period_range`, the matched market spellings, scope size, and methodology notes (sentiment formula, platform coverage, measured-period rule, "SOV ≠ sentiment").

**Presentation rules (client feedback Aug 2026 + Ford guardrail audit Sep 2026 — enforced by the eval and `_shared/px-tools/px_tools_test.ts`):**
- **Measured quarters, never calendar quarters.** Collection runs in waves (Ford: one wave in Apr/May 2026, one in July). A tool's window is "the last N quarters that have data"; `_meta.periods` lists every one, `period_range` is bounded by data (never "from Q4 2025" when the first wave was Q2 2026), and the instructions tell the host model an unlisted month or quarter was not a measurement period — never a gap, never "May is missing". Internal storage stays monthly; payloads roll up at read time. No timestamps or ISO dates anywhere in a payload.
- **"(in progress)" is a pipeline fact, not a calendar one.** The latest quarter is labeled in progress only while `company_batch_queue` has pending/processing work for the scope or the cubes saw answers in the last two days (`mcp_get_measurement_periods`). A completed wave is never hedged as "still filling in".
- **Percentages lead; counts nest.** Every headline is a share of answers — `visibility_pct`, `mentioned_in_pct_of_answers` (attributes and themes), `cited_in_pct_of_answers` (sources), `named_in_pct_of_answers` (competitors) — and every raw count sits under `sample_size`, so a host model never narrates "dropped from 3,013 to 3,000 mentions". Integer percentages (`81`), never decimals.
- **Change in points vs the previous measured period.** `change_vs_previous_period` / `delta_points_vs_previous` mirror the dashboard's delta chips (latest vs the previous period in the list, not the previous calendar quarter).
- **Dashboard scope by default.** Every tool aggregates the brand scope (same-name market profiles) and the snapshot tools default to the latest measured quarter — the dashboard's default view — so ChatGPT and the app say the same numbers. `compare_companies` reports each profile at its own latest period and labels it.
- **"Why did X change?" is answerable.** `get_attribute_themes` with an attribute returns the example themes and `sources_in_attribute_answers` — the domains cited in the answers that discuss that attribute (response-level association, framed as "not cause").
- **Links are real pages.** Every source row (`get_sources`, `get_citations`, `sources_in_attribute_answers`) carries `top_pages` — the most-cited page URLs on that domain with their titles, read from the page cube `company_page_stats_mv` (`mcp_get_cited_pages`; refreshed by the same pipeline as the domain cube, so page shares use the domain shares' denominator; the attribute read returns them from its own sampled scan). URLs are normalized (fragment, tracking params and trailing slash dropped) and titles lose the "Opens in new tab." suffix. The instructions make those the only URLs a host may show: link the top page with the returned title, never a bare domain, never a constructed URL.
- **Job function is a filter, like market.** 91% of Ford's Q3 answers carry one (Finance, Marketing & Sales, HR, ...), every cube stores it at its grain, and the dashboard filters on it, so the market-aware tools take `job_function` next to `location` (matched via `mcp_list_job_function_buckets` with shorthand aliases; unknown → `no_data` + `available_job_functions`), `_meta.job_functions_matched` echoes what applied, and `by_job_function` splits visibility and attribute rows by function. Every read RPC carries `p_job_functions`; the page cube has no function grain, so `mcp_get_cited_pages` samples the filtered answers under that filter and says so. Instruction rule 11 forbids presenting unfiltered figures as function-specific.
- **Say what's included, never what's excluded.** Coverage is framed as the tracked platforms (ChatGPT, Perplexity, Google AI Overviews, Google AI Mode); no payload or description mentions excluded models.
- **Response minimization** (ChatGPT plugin guidelines): no internal ids, request ids, or diagnostics in tool responses; company UUIDs remain only because tool chaining requires them.

**Why the Sep 2026 rebuild (defects found in the audit):** (1) windows were calendar quarters, so Ford's two waves read as "Q4 2025–Q3 2026 with gaps" and July's completed wave was hedged as in progress; (2) EPS read relevance from `company_relevance_scores`, a relation that does not exist — relevance silently scored 0 and EPS lost its 20% component; (3) the original chat tools aggregated raw rows pulled through PostgREST, which caps at `max_rows = 1000`, so every real company's theme/competitor/citation counts were truncated; (4) those tools pooled every wave ever collected for one market profile, which never matched the dashboard. All aggregates now come from the cubes or SQL RPCs.

## Security model

1. **Bearer token → organization.** OAuth access tokens and PATs are opaque random strings stored sha256-hashed in `mcp_tokens`, each bound to ONE `organization_id`. The org is never client- or model-chosen.
2. **Explicit org allowlist.** `mcp_org_settings`: no row / `enabled=false` → no MCP access, regardless of tokens. Rollout is per-client.
3. **Rate limits + audit.** Per-token per-minute and per-org daily quotas enforced against `mcp_request_log`, which is also the audit trail (org, token, tool, args, duration, status).
4. **Tenancy at the tool layer.** Every `company_id` argument is validated against `organization_companies` before any read (`validateCompanyOwnership`); sibling/brand scope is resolved from the org's own rows. This is the hard boundary (RLS is off on hot tables).
5. **Read-only.** The registry contains no mutating tool; OAuth scope is `perceptionx:read`.
6. **PKCE S256 mandatory; refresh rotation with family revocation; single-use 5-min auth codes; exact redirect-URI matching; DCR restricted to https (+ localhost) redirect URIs.**

## Deploy order (safe at each step)

1. **Migrations** (additive only): `20260831120000_mcp_auth.sql`, `20260831120100_mcp_read_rpcs.sql`, then `20260903120000_mcp_measurement_periods_and_theme_stats.sql` (adds `mcp_get_measurement_periods`, `mcp_get_theme_stats`, `mcp_get_attribute_sources`; replaces `mcp_get_rollups` in place to add the `relevance` family). The edge functions call the new RPCs on every request, so apply this migration BEFORE deploying them.
2. **Edge functions**: deploy `chat-with-data` (now importing `_shared/px-tools`) and `mcp-server` (**verify_jwt = false** — it implements its own bearer auth; OAuth discovery must be reachable unauthenticated).
3. **Frontend** (merge to main → Netlify): `_redirects` proxy rules, `/connect/consent` page, `/chat` admin route. Until this ships, OAuth can't complete (no consent page) — PATs against the direct functions URL work regardless.

**State as of 2026-09-03 (Ford pilot prep):** the migrations above are applied (plus `20260903130000_ai_themes_company_attribute_index.sql` and `20260903140000_mcp_attribute_sources_sampled.sql`, found during the live eval: the attribute-sources read took 15 s on Ford's brand scope and the edge function's PostgREST connection stops statements at 8 s — it now samples answers (1,500 after `20260903160000_mcp_sample_sizes_and_service_role_timeout.sql`) and returns in ~0.1 s warm; `20260903150000_mcp_theme_stats_sampled.sql` does the same for theme aggregation, which timed out on every brand-wide `get_themes` call and silently emptied the overview's and platform breakdown's theme data — it samples answers (1,500) before joining their themes, and every theme-level figure now says so via `sample_size` and a methodology note. Because a cold cache still costs ~4 page reads per sampled row, the same migration also sets `statement_timeout = 20s` on `service_role` — the edge functions had been inheriting the 8 s `authenticator` login default) and the Ford org is enabled. `mcp-server` v11 was deployed as a single minified bundle (`functions/mcp-server/index.js`, built with `deno bundle --platform deno --minify --external 'https://deno.land/*' --external 'https://esm.sh/*' mcp-server/index.ts`) because the session had no Supabase CLI; the live eval passes 125/125 against it with Ford data (theme, overview and platform-breakdown reads complete in 3–5 s warm; an attribute read that ran 12 s was not cut, confirming the 20 s budget applies through PostgREST). `20260903170000_mcp_cited_pages.sql` and `20260903180000_company_page_stats_cube.sql` (applied) add page-level links: `top_pages` on `get_sources`, `get_citations` and the attribute source breakdown carry the most-cited page URLs with titles, and the instructions tell the host to link those and nothing else — found when ChatGPT answered source questions without a single link. The first migration read pages from a request-time sample, which took ~20 s on Ford's four-quarter brand scope; the second moves them into `company_page_stats_mv` (refreshed per company by `refresh_company_metrics` and hourly in full), so the read is an index lookup with complete counts. `mcp-server` v13 carries it; the live eval passes 138/138. The next `supabase functions deploy mcp-server --project-ref ofyjvfmcgtntwamkubui` from this branch replaces the bundle with the source files (identical behavior). `chat-with-data` v29 (deployed 2026-09-04 as the same kind of single-file bundle, `verify_jwt` true) runs this branch's `px-tools`, so the in-app chat returns the same sources with page links and the same job-function filter as the MCP server.

**Page cube refresh policy (incident, 2026-09-03 14:40 UTC):** `company_page_stats_mv` is refreshed per company only — it is in `refresh_company_metrics(p_company_id)` and `_refresh_cm_dispatch`, but NOT in the hourly full-rebuild list (`20260903190000_page_stats_out_of_full_rebuild.sql`). The first full rebuild (all 188 companies, ~1M page rows in one transaction, scheduled as a one-off pg_cron job) coincided with a Postgres restart four minutes in (256 MB shared_buffers, 3.5 MB work_mem); the job was unscheduled and the backfill was redone per company in batches of 15–25 (20–50 s each). Never run `_refresh_cm_page_stats(NULL)` on this instance size; backfill a new org with `select _refresh_cm_page_stats(company_id) from organization_companies where organization_id = ...` in batches.

**Job function (2026-09-04, mcp-server v14):** `20260903200000_mcp_job_function_filter.sql` adds `p_job_functions` to every read RPC (old signatures dropped) and `mcp_list_job_function_buckets`; the five market-aware tools take `job_function`, `get_visibility` and `get_attribute_themes` take `by_job_function`, and instruction rule 11 covers scope. The live eval passes 161/161 on Ford with a filtered read, both splits and the sampled page path under a job-function filter.
4. **Enable an org + mint a PAT** (below), run the eval.

## Admin operations (SQL editor / service role — no UI by design)

```sql
-- Enable an org (explicit allowlist; also sets quotas)
select mcp_enable_org('<organization_id>', 60, 2000, 'pilot');

-- Mint a PAT (returns the raw key ONCE — deliver securely, never store)
select * from mcp_create_api_key('<organization_id>', 'netflix-pilot-test', 90);

-- Inspect usage
select ts, token_kind, method, tool_name, status, duration_ms
from mcp_request_log order by ts desc limit 50;

-- Revoke a token (and its refresh family) / kill an org's access
select mcp_revoke_token('<token_id>');
select mcp_disable_org('<organization_id>');
```

## Connecting clients

**ChatGPT (Team/Enterprise/Plus — Developer Mode)**  
Settings → Connectors → Advanced → Developer Mode → *Add custom connector* → URL `https://app.perceptionx.ai/mcp` → OAuth. ChatGPT discovers the metadata, registers dynamically, and sends the user to our consent page; they sign in with their PerceptionX account, pick their org, approve. Workspace admins can then share the connector with the workspace.

**Claude (claude.ai)**  
Settings → Connectors → *Add custom connector* → same URL, same OAuth flow.

**Claude Code / scripts (PAT)**
```bash
claude mcp add --transport http perceptionx https://app.perceptionx.ai/mcp \
  --header "Authorization: Bearer pxk_..."
```

**Direct URL for testing** (bypasses the Netlify proxy):
`https://ofyjvfmcgtntwamkubui.supabase.co/functions/v1/mcp-server`

## Eval

```bash
MCP_URL=https://ofyjvfmcgtntwamkubui.supabase.co/functions/v1/mcp-server \
MCP_TOKEN=pxk_... \
deno run --allow-net --allow-env --allow-read scripts/mcp-eval/run.ts
```

Phase A: protocol + tool-shape invariants against the live server — coverage signals, measured-period envelopes (`_meta.periods`, data-bounded `period_range`, no "(in progress)" without an active collection), shares-first lint (inside list entries the only bare numbers are `*_pct` / `*_points` / `*_per_answer` / `eps`; everything else must sit under `sample_size`), integer-percentage checks, no-raw-dates lint, relevance present in EPS, read-only annotations, tenant-rejection. Phase B (with `ANTHROPIC_API_KEY`): tool-selection eval over `questions.json` — the regression net for tool descriptions. Run it after ANY change to tool descriptions or the shared layer.

Offline (no PAT needed): `cd supabase/functions && deno test _shared/px-tools/` replays a Ford-shaped fixture (two waves, Apr/May + July, nothing since) through the real executors and pins the same rules.

## Client pilot checklist (Netflix live; Ford next)

1. `mcp_enable_org` for the org (Ford Motor Company: `0af791f6-db6e-4063-95c4-71cd31f8779a`); confirm quotas.
2. Verify their users exist as `organization_members` (consent lists only orgs the user belongs to AND that are enabled).
3. Run the eval with a PAT scoped to their org; spot-check the flagship questions ("how are we doing" — expect Q3 2026 numbers that match the dashboard, "culture in India", "visibility in Japan", "sources in Germany", "top competitor for pay" — expect the SOV-not-sentiment caveat, "why did wellbeing change" — expect points vs Q2 2026 plus the sources in those answers, and never a reference to May/June or Q1 as missing).
4. Their workspace admin enables Developer Mode and adds `https://app.perceptionx.ai/mcp` (steps above); or we demo via Claude Code + PAT first.
5. Watch `mcp_request_log` during the first sessions; tune tool descriptions where the host model picks the wrong tool.
6. Revoke pilot PATs when OAuth is confirmed working.

## ChatGPT directory submission (when we go beyond Developer Mode)

Per OpenAI's plugin guidelines, already satisfied in code: unique verb-style tool names; descriptions that match behavior with no comparative/manipulative language; `readOnlyHint`/`idempotentHint` true and `destructiveHint`/`openWorldHint` false on every tool (all are side-effect-free reads of the caller's own org data — state this justification in the submission form); minimal inputs (no conversation context, no location beyond the explicit market filter); response minimization (no timestamps, internal ids, or diagnostics); transparent OAuth with a narrow read-only scope. Still needed at submission time: verified OpenAI org (platform dashboard), published privacy policy URL, support contact, and a fully-featured **demo account with sample data** (use a demo org, e.g. "Demo Account", with `mcp_enable_org` + a dedicated login — reviewers must not need 2FA or sign-up).

## Known limits / later

- **Competitor sentiment** (`competitor_themes`) accrues forward from Aug 2026 — the tools say so in-band until it has depth. Attribute SOV covers v2 prompts only.
- **Theme↔citation linkage is response-level only, and sampled.** `sources_in_attribute_answers` (on a focused `get_attribute_themes`) lists the domains cited in a random sample of up to 1,500 of the latest period's answers that carry a theme of that attribute — "the sources in play when wellbeing comes up" — with `sample_size.answers_sampled` stating the denominator. Exploding every answer's citation JSON at request time took 15 s on a brand-wide scope, past the PostgREST statement budget (20 s for service_role since 2026-09-03; it was the 8 s login default); a per-attribute domain cube would make it exact. Which citation produced which sentence would need extraction-time changes; the payload says "association, not cause" for that reason.
- **Apps SDK / directory (`@PerceptionX` with branded cards)**: later packaging step on this same server — add `resources` (skybridge card templates) + `_meta.openai/outputTemplate` to tool results, then submit for OpenAI review. Results already carry `structuredContent` in anticipation.
- **Progress states**: hosts render their own "Running tool…" with our tool `title`s (e.g. "Searching your sources"); the streamed SSE statuses remain an in-app-chat nicety.
- `mcp_org_settings.enabled` gates NEW requests only; long-lived PATs should carry `p_expires_in_days`.
