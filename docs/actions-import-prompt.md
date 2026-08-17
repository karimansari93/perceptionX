# Actions — standard quarterly prompt

The one prompt to run per organization, per quarter. Paste it into the chat that
holds that quarter's report. It produces the full JSON for every action, ready
for the import in [`ACTIONS_AUTHORING_RUNBOOK.md`](./ACTIONS_AUTHORING_RUNBOOK.md).

Two placeholders and one paste-in:

| Placeholder | Example |
|---|---|
| `{{COMPANY}}` | `Netflix` |
| `{{PERIOD}}` | `Q4 2026` |
| `{{PRIOR_REGISTER}}` | output of the query below (or `(none — first quarter)`) |

---

## Step 0 — Generate `{{PRIOR_REGISTER}}`

This is the part that makes a *refresh* different from a first import. Carried
actions must reuse their existing `key`, or they lose their owner and their
ticked steps. Run this and paste the result into the prompt:

```sql
SELECT string_agg(
         format('%s | %s | %s | %s',
                key, COALESCE(source_name, title), register,
                CASE WHEN work_status = 'done'
                       THEN 'owner marked DONE ' || COALESCE(to_char(asserted_done_at,'YYYY-MM-DD'),'')
                     WHEN array_length(steps_done,1) > 0
                       THEN 'owner in progress'
                     ELSE 'not started' END),
         E'\n' ORDER BY register, key)
FROM public.company_actions
WHERE organization_id = '<ORG_UUID>'
  AND published_at IS NOT NULL
  AND register <> 'retired';
```

The work-status column is the point of this block, alongside key reuse: an
action an owner marked done but which is **still showing in the data** is the
single most useful thing the new report can say. It means the recommendation
didn't work, not that nobody tried. There is no review ledger — that judgement
lives in the evidence prose, so the analyst has to be handed the work status to
make it.

---

## The prompt

```text
You are producing the {{PERIOD}} actions register for {{COMPANY}} as JSON, for
import into the PerceptionX dashboard.

Output ONLY a single JSON array in one fenced code block. No commentary.

=== LAST QUARTER'S REGISTER ===
{{PRIOR_REGISTER}}
=== END ===

For every action in the {{PERIOD}} report, output one object:

  key              string. Stable kebab-case slug. If the action appears in the
                   register above, REUSE THAT KEY EXACTLY — it is what preserves
                   the owner and their ticked steps. A new key silently orphans
                   both. Only mint a new key for a
                   genuinely new action. Never put a date or quarter in a key.
  title            string. The card's headline, verbatim.
  source_name      string. The source the action is about, as a name — "Kununu",
                   "Glassdoor", "note.com", "jobs.netflix.com". NOT a sentence.
  source_label     string. Short qualifier shown beside it, usually the market:
                   "Germany", "United States", "r/cscareerquestions", "US · UK".
                   Use " · " between parts. Under ~28 characters.
  source_domain    string. Bare domain for the row logo — "kununu.com",
                   "teamblind.com". No scheme, no www., no path.
  recommendation   string. The instruction line under the title, verbatim.
  evidence         string. The "what the data shows" body, verbatim. Do not
                   paraphrase, summarise, or round any figure.
  work_kind        one of: "reviews" | "conversations" | "outreach" |
                   "profile_claims" | "certifications" | "owned_content" |
                   "social_pr"
                   Pick by WHO HAS TO SAY YES before the work can happen:
                     reviews        = employee-review platforms (claim, respond)
                     conversations  = threads the AI quotes (reply in-thread)
                     outreach       = lists/roundups/articles someone else owns
                     profile_claims = unclaimed profiles; one admin task
                     certifications = programmes with entry deadlines
                     owned_content  = pages the company publishes itself
                     social_pr      = channels it posts to, stories it can place
                   This drives the page's grouping, so never leave it out.
  steps            array of 2-4 strings: the concrete moves that carry out the
                   recommendation, in the order they'd be done. Each must be
                   something a person can finish and tick off — "Claim the
                   employer profile on kununu", "Reply to the eight cited
                   reviews on Wellbeing and Job Security", "Name a monthly
                   response owner". Imperative, no trailing period. Do NOT
                   restate the recommendation. Do NOT invent a quantity the
                   report doesn't support.
  ai_reads         array of {"label": string, "url": string|null}, 1-4 entries.
                   The specific pages the AI cites. label = as it appears in the
                   report (a path "/kommentare", a handle "r/cscareerquestions",
                   or a domain "builtin.com"). url = the full https:// URL when
                   the report has it, else null — NEVER guess or reconstruct a
                   URL. These render as badges with the platform logo beside
                   them, so the platform name in the label is optional.
  register         one of: "act_now" | "watch" | "regional" | "retired"
                     act_now  = needs work this quarter (overdue or new)
                     watch    = monitored, no action required yet
                     regional = tracked in a market's own report, not globally
                     retired  = closed as obsolete; keep it on the record
  editorial_status one of: "new" | "carried" | "overdue" | "retired"
                   Judge against the register above:
                     new      = not in the register at all
                     carried  = in the register, still open, not yet overdue
                     overdue  = in the register and unresolved past its quarter
                     retired  = closing it this quarter
  overdue_count    integer, optional. ONLY set this if the report itself prints
                   an "OVERDUE ×N" on the card — then use that N verbatim. It is
                   authored copy, not a running total: do not compute it, do not
                   increment last quarter's, and use 0 when the card shows no ×N.
  markets          array of strings, ONE ENTRY PER MARKET, FULL country names —
                   "United States", "United Kingdom", never "US" or "UK".
                   Split "US, Poland, UK + global eng" ->
                   ["United States","Poland","United Kingdom","Global"].
                   Use "Global" for worldwide scope.
  functions        array of strings, one per function. Split on commas, "+" and
                   "·": "Legal, Talent & HR · Comms + EB" ->
                   ["Legal","Talent & HR","Comms","EB"].
  categories       array from: "informational", "experience", "discovery".
                   Split combined badges; [] if the card has none.
  moves            array of strings as printed on the card (["Relevance"],
                   ["Sentiment"], ["Visibility","Protection"]).
  evidence_filter  object, optional. Only what the evidence actually references,
                   from: location_context (country name), theme, source_domain,
                   prompt_type. Omit anything you'd have to infer. {} is fine.

DO NOT include owner, assignee, work status, step completion, published state,
or any date field. Those belong to the client and are set in the app.

RULES
- Cover every action in the report: the main register, the watch list, the
  regional list and the retired line.
- Any action in LAST QUARTER'S REGISTER that the report no longer raises must
  still appear, with register "retired" and a one-line evidence explaining why
  it closed. Never drop an action silently.
- Where the register shows "owner marked DONE" but the data still shows the
  problem, say so explicitly in evidence. That gap — claimed done, still
  present — is the most valuable sentence in the report.
- Never invent a figure, market, URL or source. Verbatim or nothing.
- If a field genuinely isn't in the report, use null (or [] / {}).
```

---

## After you have the JSON

Follow [`ACTIONS_AUTHORING_RUNBOOK.md`](./ACTIONS_AUTHORING_RUNBOOK.md): import as
drafts, review as a platform admin, publish, assign owners, then dry-run the
digest before sending.

Two checks worth doing on the JSON before importing:

```sql
-- 1. Keys that look new but resemble an existing one (likely a renamed carry).
SELECT key FROM public.company_actions
WHERE organization_id = '<ORG_UUID>'
ORDER BY key;

-- 2. After import: anything left uncategorised falls into Outreach on the page.
SELECT key FROM public.company_actions
WHERE organization_id = '<ORG_UUID>' AND work_kind IS NULL;
```
