# Report work: load every agreed action into the knowledge base

Paste this into the PerceptionX report project (or the perceptionx-report-method skill) so every report chat produces the load file.

---

## Rule

Every action, watch item and headline figure we agree for a client report must be written to Supabase before the report is finished. The product reads three tables and nothing else: the quarterly update email, Ask AI and the dashboard action register all read them. An action that exists only in a deck or in this chat is invisible to the client's market owners.

Do this in the same conversation as "Agree copy in chat", once the actions pass the verification log and the challenge pass. Do not wait to be asked.

## The three tables

| Table | One row per | What it holds |
|---|---|---|
| `client_report_snapshots` | organisation, cycle, report type | scope (markets, functions, exclusions, assistants, aliases, collection window), headline (overall_score, sentiment_pct, visibility_pct, relevance), metric_status per metric (final or provisional, with reason), breakdowns (visibility_by_market with peers, attribute_sentiment, sources by market), as_of, source_report_name, signed_off_by, signed_off_on |
| `company_actions` | numbered action or watch item | key, register, title, cycle_raised, action_number, problem (the report's Why), ai_says, ai_reads, urls, recommendation (What to do), lanes, timing, priority, priority_reason, lifts, verified_facts, owner_name, tracking_status, markets, functions, source_name, source_domain, notes |
| `company_action_checks` | action, cycle | the readings at that cycle (metric, attribute, market, value_pct, metric_status), verified_facts, status, note |

## Field rules

- `cycle` and `cycle_raised` are the collection cycle as `YYYY-MM-01`, for example `2026-09-01` for Q3 2026. `period_label` is `Q3 2026`.
- `key` is `<cycle>:<two-digit number>` for actions (`2026-09-01:05`) and `<cycle>:watch-<slug>` for watch items. Keys make the file re-runnable: ON CONFLICT updates the same rows.
- `register` is `act_now` for a numbered action, `watch` for a watch item. `editorial_status` is `new`. `work_kind` is `owned_content`.
- `timing` is `act_now`, `act_next` or `act_later`. It is kept for the register only: no client surface (dashboard, Ask PerceptionX, the quarterly email) shows act now / next / later wording. `lanes` is any of `business`, `owned`, `people`.
- `priority` is `high`, `medium` or `low`, with `priority_reason` one sentence in the client's own figures. It is the expected effect on what AI tells candidates (share of negative opinions targeted x how much the client controls x how fast AI picks it up), not timing: the client decides when to act. Retired and done rows carry null.
- `lifts` is a JSON list of `{"metric", "attribute", "market"}`. `ai_reads` is a JSON list of `{"source", "market", "coverage_pct", "url"}` where coverage_pct is the share of the relevant answers citing the source. `verified_facts` is a JSON list of `{"fact", "checked_on"}` from the verification log.
- `markets` and `functions` use the tracked spellings in `confirmed_prompts.location_context` and `job_function_context`, exactly, so the email and Ask AI filters match. An organisation-wide action has `markets = '{}'`.
- The report's "Success by", "Worth" and Amplify share link go in `notes` as plain sentences, for example `Success by Q1 2027: both profiles claimed and current. Worth: under 0.1 points overall; Romania from 75% to 77%. Amplify: ford.perceptionx.ai/brwpxu.`
- `owner_name` is the owner agreed in the report (`Market HR`). `tracking_status` starts at `open`.
- `metric_status` is `provisional` for sentiment and the overall score until both periods carry one classifier version; `final` otherwise, with a reason.
- Copy rules apply to every stored string: percentages only, no raw counts, no em dashes, no other PerceptionX clients, no AI model or vendor names.

## Output

Produce one SQL file named `<YYYYMMDDHHMMSS>_<client>_<period>_knowledge.sql` for `supabase/migrations/`, in exactly the shape of `supabase/migrations/20261014074000_thermofisher_q3_2026_knowledge.sql`:

1. A header comment: client, organisation id, company id(s), cycle, the date the figures were re-run, and "Applied <date> with Karim's approval, which is also his sign-off on these figures."
2. `INSERT INTO public.client_report_snapshots (...) VALUES (...) ON CONFLICT (organization_id, cycle, report_type) DO UPDATE SET ...` keeping `published_at = COALESCE(client_report_snapshots.published_at, EXCLUDED.published_at)`.
3. `INSERT INTO public.company_actions (...) VALUES (...), (...) ON CONFLICT (organization_id, key) DO UPDATE SET ...` with every numbered action and watch item, `published_at = now()`.
4. `INSERT INTO public.company_action_checks (...) SELECT ... ON CONFLICT (action_id, cycle) DO UPDATE SET ...` with one row per action carrying the baseline (or this cycle's) readings and `note = 'Baseline.'` or `note = '<period> check.'`.

Look up the organisation id and company id(s) in Supabase (`organizations`, `organization_companies`, `companies`) and quote them in the header. Every figure in the file must trace to a pre-flight query in this conversation.

Then ask Karim: "Apply the knowledge file now?" On yes, apply it through the Supabase MCP (it is additive and idempotent, so it runs from a cloud session) and commit the file to the repo on the report branch. Confirm afterwards with a read of `company_actions` for the organisation showing the numbered titles. On a later cycle, add only a new `company_action_checks` row per action and update `tracking_status` through the admin function; do not rewrite the original rows.
