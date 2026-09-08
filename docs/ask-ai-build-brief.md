# Build brief: "Ask AI" inside the PerceptionX app

Goal: give every PerceptionX user the same analyst that ChatGPT and Claude get through the MCP connector, inside the app, with the exact same guardrails, numbers, links and job-function filters. One tool layer, one rulebook, three transports (ChatGPT, Claude, in-app).

This brief is the task spec for a fresh session. Read it fully before touching code.

## 0. Starting point

- Branch off `claude/ai-chat-guardrails-audit-mo2kev` (12 commits ahead of `main`, no PR yet). If it has been merged, branch off `main`. Everything below assumes that branch's code.
- Read first, in this order: `docs/mcp-server.md`, `supabase/functions/_shared/px-tools/mod.ts`, `tools.ts`, `scope.ts`, `helpers.ts`, `supabase/functions/mcp-server/index.ts` (the `SERVER_INSTRUCTIONS` constant), `supabase/functions/chat-with-data/index.ts`, `src/pages/Chat.tsx`, `src/components/chat/*`, `src/hooks/useChat.ts`, `src/services/chatService.ts`, `src/components/AdminRoute.tsx`, `src/components/AppSidebar.tsx`, `supabase/migrations/20260216000000_create_chat_tables.sql`, `scripts/mcp-eval/run.ts` and `questions.json`, `supabase/functions/_shared/px-tools/px_tools_test.ts`, `docs/connect-your-ai-assistant.md`.
- Deployed today: `mcp-server` v14 and `chat-with-data` v29 both run this branch's `px-tools`. Both were deployed as single minified bundles because the session had no Supabase CLI (`/root/.deno/bin/deno bundle --platform deno --minify --external 'https://deno.land/*' --external 'https://esm.sh/*' -o out.js <entry.ts>`, then deploy `index.js` as the entrypoint). Keep that path working or use the CLI if you have it.
- Production frontend deploys from `main` on Netlify. Nothing in the app ships until the branch is merged.

## 1. What exists today (audit, 2026-09-04)

Backend `supabase/functions/chat-with-data/index.ts`:
- Supabase JWT auth, then `organization_members` check for the `organizationId` in the body. Every tool call is scoped to that org; `executeTool` re-checks company ownership.
- Manual Anthropic streaming loop over raw `fetch`, model `claude-opus-4-7`, `max_tokens` 4096, no thinking, no prompt caching, up to 10 tool rounds, SSE events `{text}`, `{status}`, `{error}`, `[DONE]`.
- System prompt `buildSystemPrompt(orgName)` carries the guardrails. It is a second copy of the MCP server's `SERVER_INSTRUCTIONS`; the two are aligned by hand today and will drift.
- Tools: the full `px-tools` registry via `anthropicTools`, including `top_pages`, `job_function`, `by_job_function`.

Frontend:
- Route `/chat` is wrapped in `AdminRoute`, which is a hard-coded email allowlist (`karim@perceptionx.ai`). No sidebar entry points at it. Customers cannot reach it.
- `ChatCore` (full mode): conversation list, messages, input, stop button, welcome screen with four hard-coded suggestions. Compact mode is unused.
- `ChatMessage.formatMessage` is a home-grown renderer: headings, bullets, numbered lists, bold. It does not render links, so the `[title](url)` links the analyst now returns show as raw text. No tables, italics or code.
- `useChat` keeps a 20-message history window, persists to `chat_conversations` / `chat_messages` (RLS per user; list filtered by org client-side).
- `useSuggestedQuestions` + edge function `suggest-questions` (deployed v4) generate personalised starter questions from raw tables, bypassing `px-tools`. Nothing renders them: dead code.
- The dashboard's floating "Ask AI" buttons (`OverviewTab`, `SourceDetailsModal`, `CompetitorDetailsModal`) build their own prompts from client-side rows and call `test-prompt-claude` directly. They have none of the guardrails (raw counts, no measured periods, no coverage signals). Out of scope for this brief except as noted in section 6.

Eval and tests:
- `scripts/mcp-eval/run.ts` runs 161 checks against the deployed MCP server with a PAT, plus a tool-selection eval over `questions.json`. There is no eval against `chat-with-data`.
- `cd supabase/functions && deno test _shared/px-tools/` (14 tests) pins the tool layer offline.

## 2. The rulebook (non-negotiable, identical on every transport)

Source of truth today: `SERVER_INSTRUCTIONS` in `supabase/functions/mcp-server/index.ts`, rules 1 to 11. The chat prompt must carry the same rules word for word, plus the analyst persona. Move the rules into one shared module (for example `_shared/px-tools/instructions.ts` exporting `PX_RULES`) and have both `mcp-server` and `chat-with-data` import it. Do not paraphrase them into a new voice.

1. Answer ONLY from tool results. Never fill gaps with general knowledge about the company. If a tool did not return it, say the data is not tracked yet.
2. Every result has `_coverage` (found / partial / no_data). On no_data say so plainly; on partial name what is missing.
3. Periods are MEASURED quarters. `_meta.periods` lists every measured period in the window. A calendar month or quarter not listed was not a measurement period: never call it missing, a gap or a pause, never say a month is missing. Compare listed periods only, in order. "(in progress)" marks a wave still being collected; every other listed period is complete and final, never hedge it.
4. Lead with percentages. Every headline figure is a share of answers. Anything under `sample_size` is a raw count for context only; never narrate change as a count of mentions or responses. Sentiment and visibility are percentages, never decimals.
5. Change is percentage points against the PREVIOUS measured period (`change_vs_previous_period`, `delta_points_vs_previous`).
6. Numbers match the dashboard: brand scope (all same-name market profiles) and the latest measured period by default. Quote `_meta.period_range` and matched market spellings when precision matters.
7. Data is scoped to this user's organisation only. There is no cross-customer data. Never mention or imply other customers.
8. Competitor "share of voice on an attribute" means who gets NAMED when the topic comes up, not that the competitor is rated better.
9. Tool routing: `list_companies` first if IDs are unknown; "how are we doing" is `get_company_overview`; market questions go to the market-aware tools; "why did X change" is `get_attribute_themes` with the attribute, which returns example themes and the sources cited in those answers.
10. Link sources. Source and citation rows carry `top_pages` (url + title), the only URLs allowed. Link the top page as a markdown link with the returned title and the exact url. Never construct, shorten or guess a URL, never link a bare domain, never link anything a tool did not return. If the user wants links and the rows in hand carry none, call `get_sources` or `get_citations` with `domain_filter`.
11. Scope. Figures are brand-wide across every market and job function unless the user asks for one. Market-aware tools take `location` and `job_function`; `_meta.locations_matched` and `_meta.job_functions_matched` show what applied. Never present unfiltered figures as specific to a role or market. For "which functions differ" use `by_job_function`.

Presentation rules already in the chat prompt and to keep: describe coverage inclusively (the tracked platforms: ChatGPT, Perplexity, Google AI Overviews, Google AI Mode), never in terms of what is excluded; sentiment methodology v2 note; EPS = 50% sentiment + 30% visibility + 20% relevance; present sources behind a change as association, not cause; a clear "we don't have data for X" is a correct answer; never make PerceptionX look bad by calling its own data incomplete, late or missing.

## 3. Work to do

Do these in order. Each has an acceptance check.

### 3.1 One rulebook module
- Create the shared instructions module; `mcp-server` uses it as `instructions`, `chat-with-data` wraps it with the analyst persona and the "how to respond" section.
- Accept: a diff of the two prompts shows only the persona and response-style sections differ. `deno test _shared/px-tools/` passes. Redeploy both functions and re-run `scripts/mcp-eval/run.ts` (161/161).

### 3.2 Backend on the current API
- Call Claude with the official SDK (`npm:@anthropic-ai/sdk`) if it bundles and boots on Supabase edge; otherwise keep raw `fetch` but use the current request shape.
- Model `claude-opus-5` (env override `CLAUDE_MODEL`). Adaptive thinking is on by default on this model; leave it on, expose `output_config.effort` via env (`CLAUDE_EFFORT`, default `high`; measure time to first token on Ford and drop to `medium` if p50 is above about 6 s).
- Prompt caching: `cache_control` on the system block (tools, then system, then messages). The system prompt must be byte-stable per org: no timestamps or request ids in it.
- Streaming stays. Raise `max_tokens` to at least 16000. Handle `stop_reason === "refusal"` by streaming a plain "I can't help with that here" line instead of an empty answer.
- Return every parallel `tool_result` in one user message (already the case; keep it). Failed tools return `is_error: true`, not a dropped block.
- Add an SSE event `{sources: [{title, url, domain}]}` built from the `top_pages` in tool results of that turn, so the UI can render a sources footer from data rather than from the model's text.
- Usage log: insert one row per request into a new `chat_request_log` (org, user, tool names, rounds, input/output tokens, duration, error). Add a per-org daily cap (`organizations` setting or a small `chat_org_settings` table, default 300 a day) with a friendly in-chat message when hit.
- Accept: a question on Ford about wellbeing in Germany for finance roles streams an answer with a linked Glassdoor or Indeed page, `_meta.job_functions_matched` is respected, and the log row shows the tools used.

### 3.3 Open the chat to customers
- Remove `AdminRoute` from `/chat`. Gate by `ProtectedRoute` plus an organisation in `CompanyContext` (owner, admin and member roles all allowed). Keep a platform-wide env kill switch (`VITE_ASK_AI_ENABLED`).
- Add a sidebar entry "Ask AI" in the Dashboard group (Sparkles icon) pointing at `/chat`, and make `activeSection="chat"` highlight it.
- Rename the page header to "Ask PerceptionX" with the sub-line from `docs/connect-your-ai-assistant.md`.
- Accept: a member-role user in the PepsiCo org sees the entry, opens the page, and only sees PepsiCo conversations and data.

### 3.4 Render answers properly
- Replace `formatMessage` with `react-markdown` (already a dependency) plus `remark-gfm` for tables. Override `a` so links open in a new tab with `rel="noopener noreferrer"`, allow only `http(s)` hrefs, and render anything else as plain text. Keep the streaming placeholder and status line.
- Render the `{sources}` event as a compact "Sources" footer under the answer (title, domain), each linked.
- Accept: the Glassdoor link in a sources answer is clickable and opens the returned URL exactly.

### 3.5 Starter questions
- Delete the hard-coded suggestions and the unused `useSuggestedQuestions` hook path. Build starters from `px-tools` data on the server (`list_companies`, `get_company_overview` for the busiest company): one visibility, one theme, one sources-with-links, one job-function question, phrased in the customer's market names. Cache per org for 24 h. Fall back to the four questions in `docs/connect-your-ai-assistant.md` when the org has no data.
- Never suggest something the guardrails forbid (no "compare to other customers", no month-level questions).
- Accept: the welcome screen for Ford shows four questions naming Ford markets or functions; PepsiCo shows Q3 2026 questions.

### 3.6 Eval for the in-app chat
- Add a `chat` target to `scripts/mcp-eval/run.ts` (or a sibling script): sign in a test user with email and password through Supabase auth (`CHAT_EVAL_EMAIL`, `CHAT_EVAL_PASSWORD`, `CHAT_EVAL_ORG`), post each `questions.json` question to `chat-with-data`, collect the stream, and lint the final text: no calendar-gap language ("missing", "gap", "no data for May", "still filling in"), no decimal sentiment or visibility, no "other customers", every markdown link host present in that turn's `{sources}` event, every answer that names a source carries at least one link.
- Accept: the lint passes on Ford and PepsiCo. Record the run in `docs/mcp-server.md`.

### 3.7 Docs and ship
- Update `docs/mcp-server.md`: the chat is no longer an internal harness; describe the shared rulebook, the log table, the cap, the eval target and the deployed versions.
- Migrations for `chat_request_log` and the cap go in `supabase/migrations/` and are applied.
- Deploy `chat-with-data` and `mcp-server`; verify both boot (function logs show "booted") and answer.
- Open a PR to `main` with a body that lists what a reviewer should click through.

## 4. Constraints

- Read-only. The chat never writes to customer data. Tools stay as they are; if you must change a payload, extend it, then run the offline tests and the live eval.
- No cross-tenant reads anywhere: every query is scoped by the verified `organizationId`, never by the body alone.
- Do not weaken the MCP server. Same tools, same numbers, same instructions.
- Keep response minimisation: no internal ids, request ids or diagnostics in what the model sees or what the UI shows, except company UUIDs needed for tool chaining.
- Match existing UI conventions (Tailwind, shadcn components, `#13274F` primary, pink badge logo).
- Commit in small steps with descriptive messages. Do not commit secrets. Test credentials live in env, never in the repo.

## 5. Manual QA script (run in the browser before opening the PR)

Ask, as a Ford member:
1. "How are we doing?"  Expect Q3 2026, percentages, brand-wide, no month talk.
2. "What changed on wellbeing since last quarter and which sources are behind it?"  Expect points change vs the previous measured period, linked pages.
3. "Which Glassdoor pages come up most, with links?"  Expect only returned URLs, clickable.
4. "Show visibility by job function."  Expect a `by_job_function` list.
5. "How do we compare to other PerceptionX customers?"  Expect a refusal citing org-only data.
6. "Why is May missing?"  Expect an explanation that May was not a measurement period, never "missing".
7. "Write a job description for engineers that leans into what AI says about us."  Expect a draft grounded in the engineering-function themes, with the caveat that it is drawn from AI answers.
As a PepsiCo member, repeat 1 and 3; expect Q3 2026 only and no Ford data.

## 6. Out of scope, note for a follow-up

The dashboard "Ask AI" buttons should be rerouted through this chat (open `/chat` with a prefilled question such as "Summarise BMW versus Ford on the competitors tab") so they inherit the rulebook. Do not do it in this task; leave a short note in `docs/mcp-server.md` under a "Next" heading.
