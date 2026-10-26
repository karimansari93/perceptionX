# Client knowledge base: report snapshots and the action register

Every client report that Karim signs off is loaded into Supabase so the
product can read it. Three tables, all keyed by `organization_id`:

| Table | What it holds | One row per |
|---|---|---|
| `client_report_snapshots` | The report's scope, headline figures, per-metric status (provisional or final), breakdowns, as-of date | organisation, cycle, report type |
| `company_actions` | The numbered actions and watch items: title, problem ("Why"), what AI says, where AI reads it, what to do, lane, timing, lifts, owner, status, markets, functions | action |
| `company_action_checks` | The readings taken for an action each cycle, starting with the baseline | action, cycle |

Who reads them:

- **Ask AI** through the `get_report_actions` tool (`supabase/functions/_shared/px-tools/executors-report.ts`).
- **The quarterly update email** through `supabase/functions/_shared/digest/payload.ts`: the open actions whose markets overlap the reader's view (plus organisation-wide ones) appear under "From your report", and the AI-written "Where to act next" box must point at one of them.
- **The dashboard** action register.

If an action is not in `company_actions`, none of these can see it. An
action that exists only in a deck or a chat is invisible to the client's
owners in the product.

## Rule for report work

When a report's actions are agreed (step 2 of the report method, "Agree
copy in chat"), the same conversation produces the load file: one migration
under `supabase/migrations/` named
`<date>_<client>_<period>_knowledge.sql`, in the shape of
`20261014074000_thermofisher_q3_2026_knowledge.sql`. It carries the snapshot
row, every numbered action, every watch item, and the baseline check row
for each action. It is applied with Karim's approval after sign-off, and
that approval is also his sign-off on the figures it stores.

Stored text follows the copy rules: percentages only, no raw counts, no em
dashes, no other PerceptionX clients. `markets` uses the tracked market
spellings (`confirmed_prompts.location_context`) so the email and Ask AI
filters match.

Each later cycle adds a `company_action_checks` row per action with the new
readings and sets `tracking_status` (open, in_progress, done, stalled,
escalated, retired). Done and retired actions drop out of the email.
