# Actions — quarterly authoring runbook

Actions are the recommendations from the quarterly PDF, surfaced in the client
dashboard at `/actions` so a named owner can pick each one up.

**There is deliberately no admin UI.** With a handful of client orgs on a
quarterly cadence, the rows are written straight into Supabase via Claude with
DB access. This file is the procedure, so it does not get reconstructed each
quarter.

Everything lives in one table: `public.company_actions`. See
`supabase/migrations/20260729000000_company_actions_mvp.sql` for the schema and
the reasoning behind it.

---

## Key facts before you start

- **Rows are org-scoped, not company-scoped.** A client org holds one company
  profile per market (Netflix has 19). Scope on `organization_id`; leave
  `company_id` NULL. The applicable market goes in `markets[]`.
- **`key` is the identity.** A stable kebab-case slug, unique per org, that must
  stay identical across quarters for the same action. Upserting on
  `(organization_id, key)` is what preserves an action's owner, its assertion,
  and its ticked steps while the evidence gets refreshed.
- **`published_at IS NULL` means draft** — invisible to the client (RLS) and
  skipped by the digest. Platform admins see drafts in the UI, badged.
- **Evidence is frozen text**, not a live query. It says what the report said at
  the time. Nothing recomputes it.
- **`overdue_count` is authored, not computed.** It is whatever the report card
  prints. There is no review ledger behind it — see the last section.
- **Two status axes.** `register` / `editorial_status` / `overdue_count` are
  ours, set when authoring. `work_status` + `asserted_done_*` + `steps_done`
  belong to the client's owner — **never overwrite these on a re-import.**
- **`work_kind` drives the page layout.** The dashboard groups by it, not by
  `register`. An action with a NULL `work_kind` falls into Outreach, so set it.
- **`work_status` is derived from steps.** Ticking every step marks the action
  done; un-ticking one withdraws it. Don't set `work_status` by hand.

---

## Step 1 — Get the JSON

In the chat holding the report, use the prompt in
[`actions-import-prompt.md`](./actions-import-prompt.md). It emits a JSON array
with one object per card.

Check before importing:
- Market names are consistent — full country names throughout. `US` and
  `United States` must not both appear across rows.
- `key` values match last quarter's for any carried action. A changed key
  silently orphans the old row and its owner.

## Step 2 — Import as drafts

Insert with `published_at` omitted. Idempotent, so a re-run corrects rather
than duplicates:

```sql
INSERT INTO public.company_actions
  (organization_id, key, period_label, register, editorial_status, overdue_count,
   title, recommendation, evidence, categories, moves, markets, functions,
   ai_reads, evidence_filter, work_kind, source_name, source_label,
   source_domain, steps)
SELECT
  '<ORG_UUID>'::uuid,
  r->>'key', '<PERIOD>', r->>'register', r->>'editorial_status',
  (r->>'overdue_count')::int,
  r->>'title', NULLIF(r->>'recommendation',''), NULLIF(r->>'evidence',''),
  ARRAY(SELECT jsonb_array_elements_text(r->'categories')),
  ARRAY(SELECT jsonb_array_elements_text(r->'moves')),
  ARRAY(SELECT jsonb_array_elements_text(r->'markets')),
  ARRAY(SELECT jsonb_array_elements_text(r->'functions')),
  r->'ai_reads', r->'evidence_filter',
  r->>'work_kind', r->>'source_name', r->>'source_label', r->>'source_domain',
  COALESCE(r->'steps', '[]'::jsonb)
FROM jsonb_array_elements($json$ [ ...paste... ] $json$::jsonb) AS r
ON CONFLICT (organization_id, key) DO UPDATE SET
  period_label     = EXCLUDED.period_label,
  register         = EXCLUDED.register,
  editorial_status = EXCLUDED.editorial_status,
  overdue_count    = EXCLUDED.overdue_count,
  title            = EXCLUDED.title,
  recommendation   = EXCLUDED.recommendation,
  evidence         = EXCLUDED.evidence,
  categories       = EXCLUDED.categories,
  moves            = EXCLUDED.moves,
  markets          = EXCLUDED.markets,
  functions        = EXCLUDED.functions,
  ai_reads         = EXCLUDED.ai_reads,
  evidence_filter  = EXCLUDED.evidence_filter,
  work_kind        = EXCLUDED.work_kind,
  source_name      = EXCLUDED.source_name,
  source_label     = EXCLUDED.source_label,
  source_domain    = EXCLUDED.source_domain,
  steps            = EXCLUDED.steps;
```

The `DO UPDATE` list is exhaustive on purpose: it names every editorial column
and **no** ownership column, so re-importing never disturbs `assignee_id`,
`work_status`, `asserted_done_*`, `steps_done`, `published_at`, or
`notified_at`.

**One trap:** `steps_done` holds ticked step *indices*. Overwriting `steps` with
a REORDERED list silently reassigns an owner's ticks to different work. Append
new steps at the end, or clear `steps_done` for that action deliberately.

## Step 3 — Review

Sign in as `karim@perceptionx.ai` and open `/actions`. Platform admins see
drafts; the client cannot. Read them as the client will.

## Step 4 — Publish

```sql
UPDATE public.company_actions
   SET published_at = NOW()
 WHERE organization_id = '<ORG_UUID>'
   AND published_at IS NULL;
```

Keep both conditions. Without the org filter you publish every client at once;
without the NULL guard you restamp already-live rows.

## Step 5 — Assign owners

Do this *before* the digest, or everyone gets a shared backlog instead of their
own name. Market-specific actions are the obvious first assignments.

```sql
UPDATE public.company_actions
   SET assignee_id = '<USER_UUID>', assigned_at = NOW()
 WHERE organization_id = '<ORG_UUID>' AND key = '<KEY>';
```

## Step 6 — Send the digest

```
POST /functions/v1/send-actions-digest
{ "organizationId": "<ORG_UUID>", "dryRun": true }
```

Platform-admin auth required. **Always dry-run first** — it returns the exact
recipient list without sending. These are real client inboxes.

Re-run with `dryRun: false` to send. It stamps `notified_at`, so a second run is
a no-op; only newly imported actions go out next time. A failed send stays
unstamped and retries.

---

## On the register history

A per-quarter review ledger (`action_reviews`: one row per action per quarter,
accruing carried / resolved / retired) was designed and **deliberately not
built** — 2026-08-15. Its main justification was deriving the "OVERDUE ×N"
counter instead of typing it, and that counter was judged not worth the table,
view, RLS and seed it would cost.

Consequences, so nobody rediscovers them the hard way:

- `overdue_count` is authored copy, copied from whatever the report card prints.
  Nothing computes or increments it. Don't build logic on it.
- There is no queryable history of what happened to an action across quarters.
  The one case that matters — an owner marked it done and the problem came back —
  is carried in the `evidence` prose instead, which is why Step 1's
  prior-register block hands the analyst each action's work status.
