# Connector submission brief: PerceptionX MCP server

Audit of this repository, prepared for submission to Anthropic's Claude Connectors Directory.
Every value below is either taken from code in this repo or verified live against the running
server. Anything not in the code or docs is marked **MISSING** with what needs to be added or
decided.

Audited: 2026-09-21, branch `claude/charming-goldberg-mhkdd9`.

Primary sources:
- `supabase/functions/mcp-server/` (index.ts, oauth.ts, http.ts): the server
- `supabase/functions/_shared/px-tools/` (tools.ts, mod.ts, instructions.ts, executors-*.ts): the tool layer
- `public/_redirects` lines 35 to 45: the public URL proxy
- `docs/mcp-server.md`, `docs/connect-your-ai-assistant.md`: internal and customer-facing docs
- `scripts/mcp-eval/run.ts`, `scripts/mcp-eval/chat-eval.ts`, `supabase/functions/_shared/px-tools/px_tools_test.ts`: test harnesses

---

## 1. Server connection details

| Field | Value | Evidence |
|---|---|---|
| Public URL | `https://app.perceptionx.ai/mcp` | `public/_redirects:44-45`, `docs/mcp-server.md`, `docs/connect-your-ai-assistant.md` |
| HTTPS | Yes | verified live: unauthenticated `POST` returns `401` with `WWW-Authenticate: Bearer resource_metadata=...` |
| Transport | Streamable HTTP, JSON responses, stateless (no SSE, no session state) | `mcp-server/index.ts` `handleMcpEndpoint`: `GET` and `DELETE` return `405` with `Allow: POST, OPTIONS`; verified live (`GET /mcp` = 405) |
| MCP protocol versions | `2025-06-18`, `2025-03-26`, `2024-11-05` | `SUPPORTED_PROTOCOL_VERSIONS`, `mcp-server/index.ts` |
| Server identity | name `perceptionx`, title `PerceptionX`, version `1.0.0` | `initialize` handler, `mcp-server/index.ts` |
| URL model | **Universal URL.** One URL for every customer. | The organization is resolved server-side from the sha256 of the bearer token against `mcp_tokens`, never from the URL, a header, or a model argument (`authenticateBearer`, `mcp-server/index.ts`) |

Supporting facts for the form:

- The URL is a Netlify reverse proxy (`200!`, not a redirect) onto the Supabase edge function, so POST
  bodies and `Authorization` headers pass through unchanged (`public/_redirects:35-45`).
- OAuth discovery lives at the domain root, where RFC 8414 and RFC 9728 clients look:
  `https://app.perceptionx.ai/.well-known/oauth-authorization-server` and
  `.../oauth-protected-resource`. Both verified live and returning `200`.
- A direct function URL also exists and is used only for testing:
  `https://ofyjvfmcgtntwamkubui.supabase.co/functions/v1/mcp-server` (`docs/mcp-server.md`).
  **Do not put this in the submission.** If you want it to stay private, note that it is currently
  reachable and referenced in a repo doc.
- The issuer, resource and consent URLs are env-overridable (`MCP_ISSUER`, `MCP_RESOURCE`,
  `MCP_CONSENT_URL`) and default to the `app.perceptionx.ai` values above. Minor gap: none of the
  three is documented in `env.example`.

---

## 2. Full tool inventory and compliance check

16 tools, all registered from one array (`PX_TOOLS` in `_shared/px-tools/tools.ts`) and mapped to
`tools/list` entries carrying `name`, `title`, `description`, `inputSchema` and `annotations`.

Every tool inherits the same annotation block (`READ_ONLY_ANNOTATIONS`, `tools.ts`):
`readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`.
The MCP `title` is the tool's `progressLabel`, set both at top level and inside `annotations`.

| Tool | Name len | `title` | `readOnlyHint` | `destructiveHint` | What it does |
|---|---|---|---|---|---|
| `list_companies` | 14 | Looking up companies | true | false | Lists the caller organization's company and market profiles with ids, latest measured quarter and size cues. |
| `get_company_overview` | 20 | Loading company overview | true | false | Dashboard default view for the latest measured quarter: EPS, sentiment, visibility, relevance, top attributes, themes, competitors, sources. |
| `get_company_metrics` | 19 | Fetching metrics | true | false | Just the latest-quarter scorecard (EPS, sentiment, visibility, relevance) plus change in points and sample sizes. |
| `get_responses` | 13 | Reading AI responses | true | false | Returns actual AI answer texts for one profile, filterable by prompt type, AI platform and sentiment. |
| `get_themes` | 10 | Analyzing themes | true | false | Recurring themes from AI answers with share of answers, sentiment, attributes and which platforms raised them. |
| `get_attribute_breakdown` | 23 | Analyzing attributes | true | false | Employer brand attribute scorecard with share of answers, sentiment, theme share and change in points. |
| `get_competitors` | 15 | Checking competitors | true | false | Competitors AI platforms name when answering about the company, as share of answers. |
| `get_citations` | 13 | Reviewing citations | true | false | Domains cited in AI answers with coverage, answer gap and the most-cited page URLs; optional single-domain drill-in. |
| `compare_companies` | 17 | Comparing companies | true | false | Side-by-side scorecards for 2 to 10 profiles, each at its own latest measured period. |
| `get_model_breakdown` | 19 | Analyzing by AI platform | true | false | Visibility and sentiment per tracked AI platform. |
| `search_responses` | 16 | Searching responses | true | false | Full-text keyword search across AI answer texts for one profile, returning snippets. |
| `get_attribute_themes` | 20 | Analyzing themes by market | true | false | Attribute view filterable by market and job function, with example themes, quotes and the sources cited in those answers. |
| `get_visibility` | 14 | Measuring visibility | true | false | Visibility series by measured quarter, filterable by market and job function, optionally split by platform or function. |
| `get_sources` | 11 | Searching your sources | true | false | Cited domains filtered by market and job function, led by coverage, with the answer gap and top pages. |
| `get_competitor_landscape` | 24 | Mapping the competitor landscape | true | false | Competitor share of voice filtered by market, job function and optionally one attribute. |
| `get_trends` | 10 | Charting the trend | true | false | Series by measured quarter for visibility, sentiment or citations, filterable by market and job function. |

### Rule-by-rule result

| Rule | Result |
|---|---|
| No tool mixes read and write behaviour | **PASS.** There is no mutating tool in the registry. Every executor is a `SELECT` or a read-only RPC, and the OAuth scope is `perceptionx:read` (`oauth.ts`). `mod.ts` has no write branch. |
| Every tool has a `title` | **PASS.** 16 of 16, set at top level and in `annotations` (`tools.ts`). |
| Correct `readOnlyHint` / `destructiveHint` | **PASS.** 16 of 16 carry `readOnlyHint: true` and `destructiveHint: false`, plus `idempotentHint: true` and `openWorldHint: false`. `scripts/mcp-eval/run.ts:80-82` asserts this against the live server. |
| No tool name over 64 characters | **PASS.** Longest is `get_competitor_landscape` at 24. |
| No vague descriptions | **PASS.** All 16 state the metric, the grain (measured quarter), the scope default and when to use the tool. None is a generic "makes a request" wrapper. |
| No freeform endpoint paths, queries or bodies | **PASS.** No tool accepts a URL, path, SQL string or request body. Inputs are UUIDs, enums, booleans, bounded integers and a plain search keyword. UUIDs are shape-validated and every one is checked against the caller's organization before any read (`mod.ts`, `scope.ts`). |
| No description that instructs Claude's behaviour, references external instructions, or hides text | **FLAGGED, 5 instances.** See below. No hidden, encoded or invisible text anywhere. No description references any external document or instruction source. |
| No tool queries memory, chat history or conversation summaries | **PASS.** No tool takes conversation context; the only contextual input is the explicit market or job function filter the user asked about. |
| No oversized responses | **PASS with one watch item.** See below. |

### Flag 1: descriptions that direct the host model's behaviour (5 instances)

These are the only submission risk I found in the tool layer. All are in
`_shared/px-tools/tools.ts`. Reviewers read directives about how to answer, or about which other
tools to avoid, as behavioural instruction rather than tool semantics. Saying what a tool is for
is fine and expected; the phrasings below go past that.

| Tool | Text | Why it is a risk | Suggested rewrite |
|---|---|---|---|
| `get_citations` | "Do NOT call get_responses alongside this for citation questions." | A negative instruction about another tool, that is, host orchestration rather than tool semantics. | Delete. If the concern is cost, say "Citation data here is complete; answer texts are not needed for citation questions." |
| `get_competitor_landscape` | "IMPORTANT: share-of-voice is who gets NAMED, not who is rated better, say so when answering ..." | The caveat is correct and important, but "IMPORTANT" plus "say so when answering" instructs output behaviour. | Keep the fact, drop the directive: "share_of_voice measures how often a competitor is named, not how favourably it is rated." |
| `get_attribute_themes` | "Quote _meta.period_range and the matched market spellings when precision matters." | Instructs presentation. | Move to the payload or to `initialize.instructions`, where presentation rules belong. |
| `list_companies` | "Always call this first if you don't already know the company IDs." | Borderline. This is normal sequencing guidance and I would leave it, but "Always" is the sort of word reviewers pattern-match on. | Optional: "Company ids for the other tools come from here." |
| `get_company_overview` | "Use this as your default first tool when a user asks how a company is doing." | Borderline, same reason. | Optional: "Use for broad how-are-we-doing questions." |

The first three are worth fixing before submission. The last two are low risk.

Related, and worth being ready to explain rather than change: the server sends an 11-rule
instruction block as `initialize.instructions` (`_shared/px-tools/instructions.ts`, `PX_INSTRUCTIONS`).
Those rules do shape how the host model presents the data, for example "Lead with percentages" and
"Link sources ... the only URLs you may show". `initialize.instructions` is the correct, in-spec
place for that, and the URL rule in particular is a safety feature, not a liability. But if a
reviewer queries it, the answer is that these are data-integrity and anti-hallucination rules for
this dataset, not instructions to change Claude's general behaviour.

### Flag 2: response size watch item

Responses are bounded, and `docs/mcp-server.md` documents a deliberate response-minimization pass:
no internal ids, no request ids, no raw timestamps, no diagnostics; company UUIDs remain only
because tool chaining needs them. Verified in `executors-core.ts`.

The one large payload is `get_responses`, which returns raw AI answer texts: each is truncated at
1,000 characters (`executors-core.ts:721-722`) and the limit is capped at 50, so a worst-case call
is roughly 50 KB of prose. `search_responses` is tighter (300-character snippets, max 30).

This is a bounded read, not an unbounded dump, so I would not call it a violation. If you want to
remove the argument entirely, lower the `get_responses` cap from 50 to 25. The default is already 15.

---

## 3. Authentication

**OAuth 2.0, specifically OAuth 2.1, implemented in full. This satisfies Anthropic's requirement.**

Implemented in `supabase/functions/mcp-server/oauth.ts`:

| Element | Detail |
|---|---|
| Grant | Authorization code with PKCE, `S256` mandatory (a request without it is rejected) |
| Refresh | Refresh tokens with rotation and family revocation on replay |
| Token lifetimes | Access 1 hour, refresh 30 days |
| Discovery | RFC 8414 authorization server metadata and RFC 9728 protected resource metadata, both live at the domain root |
| Client registration | RFC 7591 dynamic client registration, plus client ID metadata documents (`client_id_metadata_document_supported: true`), which is the hosted-client-metadata path Claude uses |
| Revocation | RFC 7009, `POST /revoke` |
| Scope | `perceptionx:read`, a single read-only scope |
| Token format | Opaque random strings, stored sha256-hashed, each bound to exactly one organization. No JWTs, so revocation is instant |
| Redirect URIs | Exact match, HTTPS only, except RFC 8252 loopback with any port for local tooling |
| Consent | `/authorize` renders no login UI of its own. It parks the request and bounces to `https://app.perceptionx.ai/connect/consent` (`src/pages/McpConsent.tsx`), where the user signs in with their existing PerceptionX account and picks which organization to connect. Membership and organization enablement are re-checked server-side at approval, not trusted from the page |

Live values returned by the authorization server metadata endpoint, confirmed today:
issuer `https://app.perceptionx.ai`, authorize/token/register/revoke under
`https://app.perceptionx.ai/mcp/`, `scopes_supported: ["perceptionx:read"]`,
`code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]`.

**Two things to be aware of before you fill in the form:**

1. **A second, non-OAuth credential path exists in production.** `authenticateBearer` accepts tokens
   of kind `access` (OAuth) *or* `pat`, where a PAT is an admin-minted personal access token created
   by SQL (`mcp_create_api_key`, `docs/mcp-server.md`). It is how the eval harness and Claude Code
   testing authenticate. This is not exposed to customers and there is no self-serve UI for it, but
   it is a live API-key path on the same endpoint. Decide how to describe it: the accurate answer to
   "how does a user authenticate" is OAuth 2.1, with an internal-only admin-minted token path used
   for testing and support. `docs/mcp-server.md` already notes that pilot PATs should be revoked once
   OAuth is confirmed working.
2. **A valid OAuth login is not sufficient on its own.** Access requires a row in `mcp_org_settings`
   with `enabled = true` for the organization, otherwise every request returns `401` with "MCP access
   is not enabled for this organization" (`authenticateBearer`), and the consent page will show the
   user no organizations to pick. This is a deliberate per-customer allowlist. It has a direct
   consequence for the reviewer test account, covered in section 5.

---

## 4. API ownership and data handling

### Ownership

**Every API the MCP server calls is owned and operated by PerceptionX.** There is no partner API and
no third-party data API in the request path.

| Call | Owner | Detail |
|---|---|---|
| All 16 tool executors | PerceptionX | Read PerceptionX's own Supabase Postgres: the dashboard rollup cubes and a set of service-role read RPCs (`mcp_get_rollups`, `mcp_get_domain_stats`, `mcp_get_competitor_stats`, `mcp_get_attribute_competitors`, `mcp_get_measurement_periods`, `mcp_get_theme_stats`, `mcp_get_attribute_sources`, `mcp_get_cited_pages`) |
| Auth, rate limiting, audit | PerceptionX | `mcp_tokens`, `mcp_org_settings`, `mcp_request_log`, `mcp_oauth_*` tables in the same database |
| One outbound HTTPS fetch | Third party, by design | During OAuth only, when a client presents an HTTPS client-metadata URL as its `client_id` (CIMD), the server fetches that document from the client vendor's own domain, for example Anthropic's hosted client metadata (`resolveClient`, `oauth.ts`). It is guarded: HTTPS only, private and loopback hosts blocked, 5-second timeout, redirects refused, 64 KB cap, and only `redirect_uris` and `client_name` are read. This is OAuth client metadata, not a data API, and it carries no customer data |

Two points worth stating plainly in the submission, since reviewers ask:

- The **data** describes third-party AI platforms (ChatGPT, Perplexity, Google AI Overviews, Google AI
  Mode), but the connector does not call those platforms. Collection happens upstream in PerceptionX's
  own measurement pipeline, and the connector only reads the resulting PerceptionX dataset.
- Data is strictly single-tenant at read time. Every `company_id` argument is validated against
  `organization_companies` for the token's organization before any read
  (`validateCompanyOwnership`, `scope.ts`), which `docs/mcp-server.md` names as the hard security
  boundary because RLS is off on the hot tables. There is no cross-customer data and no tool that
  could return it.

### Disqualifying categories

| Category | Result |
|---|---|
| Moves money, payments or crypto | **No.** No payment, billing, wallet or crypto code anywhere in the server or tool layer. No payment SDK in `package.json`. The one grep hit for "Stripe" in the repo is an example company name inside an unrelated entity-canonicalization prompt |
| Generates AI images, video or audio | **No.** The connector returns JSON text only. No image, video, speech or media generation code in the MCP path |
| Touches health data | **No.** The dataset is employer-reputation measurement: visibility, sentiment, themes, cited sources and competitors, by market and job function. No health, medical or patient data, and no field that could carry it |

Nothing in this codebase falls into a disqualifying category.

---

## 5. What still needs to be written or created

| Item | Status | What to do |
|---|---|---|
| Listing name, max 100 chars | **MISSING** | Not in the repo. The server advertises `serverInfo.title: "PerceptionX"` and the customer docs call the connector "PerceptionX", so that is the natural listing name. Confirm it |
| Tagline, max 55 chars | **MISSING** | Needs writing. The customer guide's sub-line, "Your employer brand data, in the chat window you already use", is 61 characters, so it is 6 over and needs a trim |
| Description, max 2,000 chars | **MISSING** | Needs writing. Raw material exists in `docs/connect-your-ai-assistant.md` ("What you get", the example questions) and in the `PX_INTRO` constant in `instructions.ts`. Remember the house rules: percentages only, no raw counts, no competitor or prior-index names, no em dashes, and Andy signs off anything with a number |
| 1 to 5 category tags | **MISSING** | Nothing in the repo maps to Anthropic's tag list. This is a decision for you. Read the directory's current tag options at submission time and pick from them rather than inventing labels; on function this connector is analytics and business intelligence, with an HR or recruiting angle |
| Public documentation URL | **MISSING** | The content is written and good (`docs/connect-your-ai-assistant.md`, a full setup guide with ChatGPT and Claude walkthroughs, question tips and troubleshooting), but it is an unpublished markdown file in the repo. It needs to go live at a public HTTPS URL, for example a help article on the marketing site. No published connector documentation URL exists today |
| Privacy policy URL | **EXISTS** | `https://www.perceptionx.ai/privacy`. Verified live today, returns `200` over HTTPS. The app links `https://perceptionx.ai/privacy`, which redirects to the `www` host (`src/pages/Auth.tsx:469`, `src/pages/Welcome.tsx:405`, `src/pages/ResetPassword.tsx:154`). Submit the `www` URL, and check the policy actually covers the connector's data flow, because I audited only that the page resolves, not its wording |
| Listing icon | **NEEDS A DECISION** | No icon is designated for this purpose. Candidates already in `public/logos/`: `P-Icon-Dark-large.png`, `P-Icon-Dark-medium.png`, `P-Icon-Dark-small.png`, `perceptionx-small.png`, `perceptionx-normal.png`, `PerceptionX-PrimaryLogo.png`. Check the portal's exact size and format requirement, then export to match. The square P mark is the right shape for an icon slot |
| Support contact | **NEEDS A DECISION** | `team@perceptionx.ai` is the address the customer guide gives for connector problems and the sender address for transactional email, so it is the obvious choice. `karim@perceptionx.ai` is hardcoded as the admin allowlist in several places, but that is a personal address and not a support channel. Confirm `team@perceptionx.ai` is monitored |
| Fully populated reviewer test account | **MISSING, and the biggest blocker** | No demo or sandbox organization exists in the repo or docs. `docs/mcp-server.md` already flags this as outstanding. A reviewer needs, in this order: (1) a demo organization with real-shaped measured data across at least two measured quarters, more than one market and more than one job function, otherwise most tools return `no_data` and the connector looks broken; (2) `mcp_enable_org` run for it, because without that row every request 401s; (3) a dedicated login that is an `organization_members` row of that org, because the consent page only lists organizations the user belongs to and that are enabled; (4) no 2FA and no sign-up step. Note the confidentiality issue: the demo org must not be a real client's data, so this is new seeded data, not a copy of Netflix or Ford |
| Allowed link URIs for `ui/open-link` | **NONE FOUND** | No `ui/open-link`, elicitation or sampling capability anywhere in the codebase. The server declares only `capabilities: { tools: { listChanged: false } }`, so no tool opens a browser URL and the field should be empty. For completeness, the only PerceptionX domain a user's browser reaches during normal use is `app.perceptionx.ai`, via the OAuth consent redirect, which is the OAuth flow rather than `ui/open-link`. Separately, tool results do return third-party page URLs (customer-relevant pages on sites such as Glassdoor) as link data in `top_pages`, for the assistant to render as ordinary markdown links. Those are data, not server-opened links, and they are not a fixed allowlist |

---

## 6. Pre-submission testing status

**Partially evidenced. Two gaps to close before you submit.**

What exists:

| Harness | What it covers | Recorded result |
|---|---|---|
| `scripts/mcp-eval/run.ts` | Live end-to-end run against the deployed server over real MCP JSON-RPC. Phase A checks protocol and payload invariants, including the read-only annotations on every tool, coverage signals, measured-period envelopes, percentages-first linting, integer percentages, no raw dates, relevance present in EPS, and a cross-tenant rejection. Phase B is a tool-selection eval over `questions.json` | `docs/mcp-server.md` records 161 of 161 passing on Ford data against `mcp-server` v16, and earlier runs at 125 of 125 and 138 of 138 |
| `supabase/functions/_shared/px-tools/px_tools_test.ts` | Offline Deno tests replaying a two-wave fixture through the real executors, 14 tests, plus 3 for the chat rulebook and prompt | Documented as passing. Runs without credentials |
| `scripts/mcp-eval/chat-eval.ts` | Answer-quality lint for the in-app chat, which shares the same tool layer | **Never run with credentials.** `docs/mcp-server.md` says so explicitly. The equivalent 7-question script was run by hand in the browser, 7 of 7 pass |
| `questions.json` | 26 golden client-shaped questions with expected tool choices, doubling as the manual QA script | Used by Phase B and by hand |

Gap 1: **5 of the 16 tools are never exercised by any automated harness.** `run.ts` calls 11 tools
(`list_companies`, `get_company_overview`, `get_company_metrics`, `get_themes`,
`get_model_breakdown`, `get_citations`, `get_attribute_themes`, `get_visibility`, `get_sources`,
`get_competitor_landscape`, `get_trends`). It never calls **`get_responses`**, **`search_responses`**,
**`get_attribute_breakdown`**, **`get_competitors`** or **`compare_companies`**. Anthropic's guidance
is that every tool has been exercised end to end, so add these five to `run.ts` and re-run. That is a
small, contained change to one script.

Gap 2: **no recorded end-to-end test of the OAuth flow itself.** The eval authenticates with a PAT,
not an OAuth token (`MCP_TOKEN` in `run.ts`). The OAuth code is complete and the discovery documents
are live, the customer guide describes the ChatGPT and Claude flows as working, and
`docs/mcp-server.md` still carries the line "Revoke pilot PATs when OAuth is confirmed working",
which reads as not yet confirmed. Nothing in the repo records a completed authorize, consent,
code-exchange, refresh round trip from a real client. Since OAuth is exactly what a directory
reviewer will do first, run it once against Claude as a custom connector or MCP Inspector, end to
end including a token refresh and a revoke, and write the result into `docs/mcp-server.md`.

There is also **no CI**. `.github/workflows/` does not exist, so none of the above runs automatically;
`package.json` has `test` (vitest, frontend) and `lint`, and the Deno tests and evals are manual. Not a
submission blocker, but it means "the eval passes" is a point-in-time claim from the docs rather than
a continuously verified one.

### Shortest path to submission-ready

1. Build and seed the demo organization, enable it with `mcp_enable_org`, create the reviewer login (blocker).
2. Publish the setup guide at a public HTTPS URL (blocker).
3. Fix the three behavioural phrasings in `tools.ts` (`get_citations`, `get_competitor_landscape`, `get_attribute_themes`) and redeploy.
4. Add the 5 missing tools to `run.ts` and re-run the live eval.
5. Run the OAuth flow end to end once from Claude and record it.
6. Write the name, tagline and description, choose the tags, export the icon, confirm the support address.
