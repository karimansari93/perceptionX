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
mcp_get_domain_stats, mcp_get_competitor_stats, mcp_get_attribute_competitors)
```

**One tool layer, two transports.** `chat-with-data` (the in-app analyst, admin-only at `/chat`) and `mcp-server` execute the identical `px-tools` registry — same numbers, same `_coverage`/`_meta` caveats. The in-app chat is the development/eval harness for what external hosts consume.

**Self-caveating payloads.** Over MCP our system prompt does not travel — only `initialize.instructions`, tool descriptions, and result payloads reach the host model. So every result embeds `_coverage` (found/partial/no_data), `_meta.period_range`, the matched market spellings, scope size, and methodology notes (sentiment formula, platform coverage, "SOV ≠ sentiment").

**Presentation rules (client feedback, Aug 2026 — enforced by the eval):**
- **Quarters, never raw dates.** Internal storage is monthly; payloads roll up to quarters at read time, with the running quarter labeled "(in progress)" so a light latest point is never misread as a decline. No timestamps or ISO dates anywhere in a payload.
- **Percentages, never decimals.** `positive_sentiment_pct: 81`, not `sentiment_ratio: 0.81`.
- **Say what's included, never what's excluded.** Coverage is framed as the tracked platforms (ChatGPT, Perplexity, Google AI Overviews, Google AI Mode); no payload or description mentions excluded models.
- **Response minimization** (ChatGPT plugin guidelines): no internal ids, request ids, or diagnostics in tool responses; company UUIDs remain only because tool chaining requires them.

## Security model

1. **Bearer token → organization.** OAuth access tokens and PATs are opaque random strings stored sha256-hashed in `mcp_tokens`, each bound to ONE `organization_id`. The org is never client- or model-chosen.
2. **Explicit org allowlist.** `mcp_org_settings`: no row / `enabled=false` → no MCP access, regardless of tokens. Rollout is per-client.
3. **Rate limits + audit.** Per-token per-minute and per-org daily quotas enforced against `mcp_request_log`, which is also the audit trail (org, token, tool, args, duration, status).
4. **Tenancy at the tool layer.** Every `company_id` argument is validated against `organization_companies` before any read (`validateCompanyOwnership`); sibling/brand scope is resolved from the org's own rows. This is the hard boundary (RLS is off on hot tables).
5. **Read-only.** The registry contains no mutating tool; OAuth scope is `perceptionx:read`.
6. **PKCE S256 mandatory; refresh rotation with family revocation; single-use 5-min auth codes; exact redirect-URI matching; DCR restricted to https (+ localhost) redirect URIs.**

## Deploy order (safe at each step)

1. **Migrations** (additive only): `20260831120000_mcp_auth.sql`, then `20260831120100_mcp_read_rpcs.sql`.
2. **Edge functions**: deploy `chat-with-data` (now importing `_shared/px-tools`) and `mcp-server` (**verify_jwt = false** — it implements its own bearer auth; OAuth discovery must be reachable unauthenticated).
3. **Frontend** (merge to main → Netlify): `_redirects` proxy rules, `/connect/consent` page, `/chat` admin route. Until this ships, OAuth can't complete (no consent page) — PATs against the direct functions URL work regardless.
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

Phase A: 37 protocol + tool-shape invariants against the live server (coverage signals, quarter labels, integer-percentage checks, no-raw-dates lint, read-only annotations, tenant-rejection). Phase B (with `ANTHROPIC_API_KEY`): tool-selection eval over `questions.json` — the regression net for tool descriptions. Run it after ANY change to tool descriptions or the shared layer.

## Netflix pilot checklist

1. `mcp_enable_org` for the Netflix org; confirm quotas.
2. Verify their users exist as `organization_members` (consent lists only orgs the user belongs to AND that are enabled).
3. Run the eval with a PAT scoped to their org; spot-check the flagship questions ("culture in India", "visibility in Japan", "sources in Germany", "top competitor for pay" — expect the SOV-not-sentiment caveat).
4. Their workspace admin enables Developer Mode and adds `https://app.perceptionx.ai/mcp` (steps above); or we demo via Claude Code + PAT first.
5. Watch `mcp_request_log` during the first sessions; tune tool descriptions where the host model picks the wrong tool.
6. Revoke pilot PATs when OAuth is confirmed working.

## ChatGPT directory submission (when we go beyond Developer Mode)

Per OpenAI's plugin guidelines, already satisfied in code: unique verb-style tool names; descriptions that match behavior with no comparative/manipulative language; `readOnlyHint`/`idempotentHint` true and `destructiveHint`/`openWorldHint` false on every tool (all are side-effect-free reads of the caller's own org data — state this justification in the submission form); minimal inputs (no conversation context, no location beyond the explicit market filter); response minimization (no timestamps, internal ids, or diagnostics); transparent OAuth with a narrow read-only scope. Still needed at submission time: verified OpenAI org (platform dashboard), published privacy policy URL, support contact, and a fully-featured **demo account with sample data** (use a demo org, e.g. "Demo Account", with `mcp_enable_org` + a dedicated login — reviewers must not need 2FA or sign-up).

## Known limits / later

- **Competitor sentiment** (`competitor_themes`) accrues forward from Aug 2026 — the tools say so in-band until it has depth. Attribute SOV covers v2 prompts only.
- **Theme↔citation linkage doesn't exist** — "which source drives this sentiment" is deliberately not a tool; needs extraction-time changes first.
- **Apps SDK / directory (`@PerceptionX` with branded cards)**: later packaging step on this same server — add `resources` (skybridge card templates) + `_meta.openai/outputTemplate` to tool results, then submit for OpenAI review. Results already carry `structuredContent` in anticipation.
- **Progress states**: hosts render their own "Running tool…" with our tool `title`s (e.g. "Searching your sources"); the streamed SSE statuses remain an in-app-chat nicety.
- `mcp_org_settings.enabled` gates NEW requests only; long-lived PATs should carry `p_expires_in_days`.
