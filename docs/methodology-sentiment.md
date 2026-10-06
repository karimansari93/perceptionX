# Sentiment methodology

The single definition of how PerceptionX scores sentiment. The classifier
prompt (`supabase/functions/_shared/theme-analysis.ts`), dashboard code,
report pre-flight and the PerceptionX Claude skills all follow this page. If
they disagree with it, this page wins and the other place is the bug.

## What gets labelled

Every AI answer is split into themes. Each theme gets one attribute (the 13
attributes in `methodology-v2-prompt-taxonomy.md`) and one sentiment label.

| Label | Meaning | Example |
|---|---|---|
| positive | The answer praises the company as an employer | "Candidates describe the interviews as friendly" |
| negative | The answer criticises the company as an employer | "Recruiters are slow to respond" |
| neutral | The answer describes facts or process with no judgement | "The process has three interview rounds and a technical test" |

Rules that decide borderline cases:

- A plain description of a process is neutral, even when it sounds organised
  or thorough.
- A rating or score is positive or negative only when the answer itself frames
  it as good or bad. A bare number ("rated 6/10") is neutral.
- Usefulness is not sentiment. Helpful information about how to apply is
  neutral.

## The score

**Sentiment = positive themes / (positive + negative themes)**, across all four
question types (discovery, competitive, experience, informational).

- Neutral themes are excluded from the score. They still count towards how
  often an attribute is mentioned (theme share, Perception Matrix volume).
- Neutral share (neutral / all themes) is reported alongside as a supporting
  signal: a high share means AI describes the topic without vouching for it.
- Never use positive / all themes, `sentiment_score` averages, or a filter on a
  `sentiment` question type (there is no such type).

## Classifier versions

Every row in `ai_themes` carries `classifier_version`, set from
`CLASSIFIER_VERSION` in `_shared/theme-analysis.ts`. NULL means the row was
labelled before versioning (before the 2026-10-06 rules) and is not comparable
with versioned rows.

| Version | Live from | What changed |
|---|---|---|
| (NULL) | before 2026-10-06 | Default temperature; no written neutral rule. Labels drift between runs. |
| v2-2026-10-06 | 2026-10-06 11:32 UTC | Temperature 0; sentiment rules above added to the prompt. |

**Comparing periods:** absolute sentiment may be compared across two periods
only when every theme in both periods carries the same single version. Check
before writing any trend:

```sql
select date_trunc('month', pr.created_at) as period, t.classifier_version, count(*)
from ai_themes t join prompt_responses pr on pr.id = t.response_id
where pr.company_id = any(:company_ids)
group by 1, 2 order by 1, 2;
```

If the periods differ, either re-theme the older period (see below) or compare
ranks only.

## Changing the classifier

Any change to the model, temperature, schema, prompt or validation in
`_shared/theme-analysis.ts`:

1. Bump `CLASSIFIER_VERSION`.
2. Run the reference check (below) with the candidate and get Karim's sign-off
   on the result before it goes live.
3. Add a row to the version table above.
4. Decide, with Karim, which past periods must be re-themed for open reports.

### Reference check

`theme_reference_labels` holds a fixed set of 197 answers labelled by
`v2-2026-10-06` (two runs, to show normal run-to-run variation). To test a
candidate classifier:

1. Deploy the candidate to the `theme-batch` function only (live theming is
   untouched).
2. Queue the reference answers as a dry run:
   ```sql
   insert into theme_batch_items (run_label, response_id, company_name, apply_result)
   select distinct 'refcheck-<candidate>', r.response_id, c.name, false
   from theme_reference_labels r
   join prompt_responses pr on pr.id = r.response_id
   join companies c on c.id = pr.company_id
   where r.classifier_version = 'v2-2026-10-06' and r.run = 1;
   ```
   Dry-run rows (`apply_result = false`) are never written to `ai_themes`.
3. When the rows reach `stored`, compare neutral share and sentiment against
   the reference. The two reference runs differ by about 1 point; a candidate
   that moves either measure by more than 2 points changes the methodology and
   needs Karim's sign-off.

## Theming and cost

- All theming is batch-only, for new collections and re-runs alike. New
  answers are queued by `ai-thematic-analysis` / `ai-thematic-analysis-bulk`
  (run_label `live` in `theme_batch_items`) and labelled by `theme-batch`
  through the Message Batches API at half price, usually within the hour.
  There is no live theming path.
- A re-run uses its own run_label (for example `netflix-2026q3-retheme`) so it
  does not collide with `live` rows.
- Before any re-run over 1,000 answers, estimate the cost (about $0.003 per
  answer through batch at current Haiku 4.5 prices) and get Karim's approval.
- Back up the themes being replaced first, and verify afterwards that no
  backed-up row remains.
