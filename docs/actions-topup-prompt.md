# Actions top-up prompt — Netflix Q3 2026

The 21 Netflix actions are live but three authored fields are thin, so parts of
the page render empty. This prompt fills only the gaps — it is not a re-import.
Hand it to whoever has the Q3 report open.

For a **fresh** quarter use [`actions-import-prompt.md`](./actions-import-prompt.md)
instead; that one produces every field from scratch.

Where the data lives: `public.company_actions`, one row per action, matched on
`key`. `ai_reads` renders the "What AI reads" badges, `steps` renders the
checklist, `evidence` renders the paragraph. All three are authored prose — none
of it is computed from the citation tables.

---

```text
I'm topping up 21 existing Netflix Q3 2026 actions in a database. Each is
identified by a stable `key`. I need three fields filled from the Q3 report.

Output ONLY a single JSON array in one fenced code block, no commentary.
One object per action, using the EXACT keys listed below — do not invent,
rename, merge or drop any key, and do not add actions that aren't listed.

  {
    "key": "<exact key from the list>",
    "ai_reads": [ {"label": "...", "url": "https://..." | null} ],
    "steps":    ["...", "..."],
    "evidence": "..." | null
  }

FIELD RULES

ai_reads — the specific pages/profiles AI cites for this action. label = how it
  appears in the report (a path like "/kommentare", a handle like
  "r/cscareerquestions", or a domain like "builtin.com"). url = the full
  https:// URL when the report has it, otherwise null. NEVER guess or
  reconstruct a URL. 1-4 entries. These render as badges with the platform's
  logo beside them, so the platform name in the label is optional.

steps — 2-4 concrete moves that carry out the recommendation, in the order
  they'd be done. Each must be something a person can finish and tick off:
  "Claim the employer profile on kununu", "Reply to the eight cited reviews on
  Wellbeing and Job Security", "Name a monthly response owner". Imperative, no
  trailing period. Do NOT restate the recommendation. Do NOT invent quantities
  the report doesn't support — if the report says eight reviews, say eight; if
  it gives no number, don't use one.

evidence — the "what the data shows" paragraph: the figures that justify the
  action. Verbatim from the report. Do not round or paraphrase. null if the
  report genuinely has none for this item.

WHAT EACH ACTION NEEDS

Needs ai_reads + steps + evidence (all three missing):
  glassdoor-es-pt-response-programme
  glassdoor-us-response-programme
  gowork-poland-claim
  gptw-citation-tracking
  levels-fyi-salary-currency
  prosple-philippines-profiles
  wearenetflix-us-employer-video
  youtube-brazil-employer-video
  youtube-japan-employer-video

Needs ai_reads + steps (evidence already present — omit the evidence key):
  culture-polarity-owned-content
  function-positioning-plays
  hbr-editorial-pitch

Needs steps only, plus URLs added to its existing ai_reads labels:
  kununu-germany-claim        (has 3 labels, only 1 has a URL — steps ALREADY
                               written, so omit "steps" for this one)
  linkedin-listings-employee-posting   (2 labels, 0 URLs)
  reddit-authentic-participation       (2 labels, 0 URLs)

Needs steps only (ai_reads and evidence already complete — omit both keys):
  builtin-profile-completeness
  tryexponent-interview-narrative
  facebook-owned-thailand-philippines
  instagram-owned-brazil-argentina
  naver-korean-content
  note-com-japan-publish

When re-supplying ai_reads for an action that already has labels, include the
FULL list (existing labels plus URLs), because the field is replaced wholesale.
```

---

## Applying the result

`ai_reads` and `evidence` overwrite cleanly. **`steps` needs care:** ticked
steps are stored in `steps_done` as indices, so writing a new `steps` array for
an action someone has already worked reassigns their ticks. Nothing is ticked
right now, so a first application is safe — check before a later one:

```sql
SELECT key, steps_done FROM public.company_actions
WHERE organization_id = '03388b70-2563-497c-8043-2b3340823608'
  AND array_length(steps_done, 1) > 0;
```

Then apply, matching on `key` and touching only the three fields:

```sql
UPDATE public.company_actions ca
   SET ai_reads = COALESCE(v.ai_reads, ca.ai_reads),
       steps    = COALESCE(v.steps, ca.steps),
       evidence = COALESCE(v.evidence, ca.evidence)
FROM (
  SELECT r->>'key' AS key,
         r->'ai_reads' AS ai_reads,
         r->'steps' AS steps,
         NULLIF(r->>'evidence','') AS evidence
  FROM jsonb_array_elements($json$ [ ...paste... ] $json$::jsonb) AS r
) AS v
WHERE ca.key = v.key
  AND ca.organization_id = '03388b70-2563-497c-8043-2b3340823608';
```

`COALESCE` means an omitted key leaves the existing value alone, so the prompt's
"omit this key" instructions do the right thing.
