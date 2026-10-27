# Brief for the code agent: add the employer reputation expert to the in-app chat and Ask PerceptionX

Repo: perceptionX-main. Supabase project ofyjvfmcgtntwamkubui. Attached: `px-playbook-client-safe.md` (the content to load). Read this brief in full before changing anything. Deploy only after the checks at the end pass and Karim has seen a sample answer.

## Goal
Today the in-app chat (`chat-with-data`) and Ask PerceptionX (`mcp-server`, used from ChatGPT, Claude and Copilot) can only report data and the stored report actions. Rule 1 of the rulebook says "Answer ONLY from tool results", so neither can give expert advice on what to do. Add an expert layer they can draw on, without letting the model fall back on general knowledge.

## How the code is laid out (as deployed today)
- `supabase/functions/_shared/px-tools/instructions.ts`: `PX_RULES`, the one rulebook. `mcp-server` sends `PX_INSTRUCTIONS` as `initialize.instructions`; `chat-with-data/prompt.ts` embeds it byte for byte. `scripts/mcp-eval` asserts the live server carries it.
- `supabase/functions/_shared/px-tools/tools.ts`: `PX_TOOLS`, one registry for both surfaces (Anthropic `input_schema` and MCP `tools/list`). Descriptions are written for a host model that has never seen our prompt. All tools are read-only (`READ_ONLY_ANNOTATIONS`).
- `supabase/functions/_shared/px-tools/mod.ts`: `executeTool` switch.
- `supabase/functions/_shared/px-tools/executors-report.ts`: `get_report_actions` (reads `client_report_snapshots` and `company_actions`).
- `supabase/functions/chat-with-data/prompt.ts`: persona plus response style. Must stay byte-stable per organization (it is the cached prefix).

## Design decision
Add the expert as a **tool**, not as more prompt. Over MCP the instructions field is the only prompt surface and is too small for the playbook; tools work identically in the app, ChatGPT, Claude and Copilot.

## Changes

### 1. New file `_shared/px-tools/playbook.ts`
- `export const PLAYBOOK_AS_OF = '2026-10-27';`
- `export const PLAYBOOK: Record<PlaybookTopic, { title: string; text: string }>` built from `px-playbook-client-safe.md`: one entry per `## topic: <key>` block, text verbatim (markdown kept). Topics: `prioritise`, `diagnose`, `who_owns`, `career_site`, `job_posting`, `ai_readability`, `pay_transparency`, `candidate_experience`, `lists_awards`, `levers`, `review_platforms`, `writing_recommendations`.
- The playbook must contain no client names, client data or cross-client figures. It is shared across every organization.

### 2. New tool `get_playbook` in `tools.ts`
- `progressLabel`: `'Checking the playbook'`
- `input_schema`: `{ topic: { type: 'string', enum: [the twelve topics] } }`, required `topic`.
- Description (for a host model that has never seen our prompt): "PerceptionX's employer reputation playbook: how to move the score, how to diagnose a weak topic, who at an employer can change what, what a strong career site and job posting contain and where a block goes on a posting so AI and job boards read it, AI readability, pay transparency law, candidate experience, employer lists and awards, review platform capabilities and rules, and how to write a recommendation. Use for any 'what should we do', 'how do we fix', 'how does Glassdoor / kununu / our career site work' question, together with the data tools. This is guidance, not data about the organization: never present it as a measurement, and take every figure from the data tools. Dated facts (laws, platform features, list deadlines) carry an as-of date: say it and tell the user to check before acting."
- Read-only annotations as for the other tools.

### 3. Executor in `mod.ts`
`case 'get_playbook'`: return JSON `{ topic, title, as_of: PLAYBOOK_AS_OF, text, _coverage: 'found' }`. Unknown topic: `_coverage: 'no_data'` and the list of topics. No database call.

### 4. Rulebook edits in `instructions.ts` (one edit changes every surface)
- **Replace rule 1** with: "Figures and facts about this organization come ONLY from the data tools; never fill gaps with general knowledge about the company. Advice on what to do comes ONLY from get_playbook and get_report_actions, never from general knowledge. Keep the two apart: say which figures are measured and which points are playbook guidance."
- **Replace rule 11** with: "Recommendations. For 'what should we fix', 'what did you recommend', 'why is X low' or 'is this score final', call get_report_actions alongside the live tools. Refer to actions by their title, never by number, and give no timing (the organization decides when). Cite the report period and as-of date (cite_as). Say 'provisional' for any metric its metric_status marks provisional. Its urls, steps and where_ai_reads urls may be linked exactly as returned. Never work out a figure the records or live tools did not return: say it is not measured yet. Action status and owners are set in the PerceptionX platform; you cannot change them."
- **Add rule 13**: "For 'what should we do about X' or 'how do we improve X': first get_attribute_themes for X (what AI says and the sources in those answers), then get_report_actions (what PerceptionX already recommended), then get_playbook for the relevant topic. Answer with the move, the exact page and where on it the change goes, why in this organization's own figures, and which team owns it. Say when a change sits with another team (for example talent acquisition) or is a business change content will not fix."
- Update `PX_INTRO` only if needed to mention that the tools include a playbook.

### 5. `get_report_actions` (executors-report.ts and its tool description)
- Description: remove "numbered", "timing" and "owner"; describe actions by title.
- Schema: replace `action_number` with an optional `action` string matched case-insensitively against `title`. Keep accepting `action_number` silently for old clients, but do not advertise it.
- Shape: drop `number`, `timing` and `owner`. Add `steps` from `company_actions.steps` (array of `{label, url}`), returned exactly as stored. Sort by `cycle_raised` desc, then title.
- **Market filter bug:** actions with `markets` containing `'Global'` are currently dropped whenever a market is asked for (the filter keeps only empty market arrays or exact matches). Treat `'Global'` as matching every market, and expand region names via `_shared/regions.ts` so "Europe" returns actions for every European market plus Global.

### 6. New data tool `get_negative_drivers` (the expert's first question needs it)
- Input: `company_id`, optional `location`, `job_function`, `quarters_back` (same conventions and scope helpers as `get_attribute_themes`).
- Output per attribute, latest measured period (and the previous one): share of all negative opinions (negative themes on the attribute / all negative themes in scope), positive %, and the share of that attribute's negatives that sit in answers citing one of the organization's own review-profile pages; plus the overall share of all negatives in such answers.
- Review-profile pages: Glassdoor host with the company slug in the path; Indeed `/cmp/<slug>`; kununu `/<country>/<slug>`; AmbitionBox, Undelucram, profession.hu, WhereWeWork, Computrabajo with the slug in the path; Seek and Jobstreet `/companies/<slug>`; Infojobs Brazil `/<slug>`. Derive slugs from the organization's own citations (the most-cited employer pages on each platform for this company); never hard-code a client.
- Percentages lead; counts only under `sample_size`. Sentiment v2 (positive / (positive + negative), neutral excluded), all four prompt types, aggregated on `attribute_name`.

### 7. Persona line in `chat-with-data/prompt.ts`
After the first paragraph add: "You also know employer reputation work: career sites, job postings, review platforms, candidate experience and employer lists. That knowledge comes from get_playbook, never from memory." Keep the prompt byte-stable (no dates or per-request text).

## Checks before deploy
1. `scripts/mcp-eval`: update the expected rulebook text; assert `tools/list` includes `get_playbook` and `get_negative_drivers` with read-only annotations; assert `get_report_actions` output has no `number`, `timing` or `owner` and does include `steps`.
2. Market filter: with the Ford organization, `get_report_actions({market: 'Germany'})` returns the Global actions as well as Germany's; `{market: 'Europe'}` returns every European market's actions plus Global.
3. Sample questions in the in-app chat and over MCP (Claude), each answer checked by Karim:
   - "What should we do about candidate feedback in Canada?" Expect: what AI says and the sources (tools), the existing hiring action by title, the posting block placement (template section plus job description lines plus FAQ), the process change named as talent acquisition's, the Ontario 45-day duty with its as-of date, no invented figures, no action numbers.
   - "How does kununu's score work?" Expect: playbook answer with the as-of date and "check before acting".
   - "Where do our negatives come from?" Expect: get_negative_drivers figures, percentages only.
4. No em dashes in any playbook text or new description.
5. Deploy both `chat-with-data` and `mcp-server` (shared code changed).
