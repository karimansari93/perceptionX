# Employer Narrative: metric definitions (proposed, for Karim)

Status: proposal. Nothing applied, nothing run. Scope for the first test: United States only, Ford (Ford + Ford Credit) and Netflix, **October 2026 collection only** (Karim, 2026-11-19). No July data, so the samples show no trend arrow; the header shows the October figure alone.

## 1. What the US test has to work with (verified 2026-11-19)

| | Ford US | Netflix US |
|---|---|---|
| Market spelling in `confirmed_prompts.location_context` | `United States` | `the United States` |
| Job functions | 11 + no-function prompts | 3 (Content & Production, Product & Technology, Marketing) + no-function prompts |
| Assistants | ChatGPT, Perplexity, Google AI Mode, Google AI Overviews (no Claude) | the same four plus Claude |
| October answers | 3,263 | 1,018 |
| July answers | 2,877 | 1,009 |
| Theme version, October | all `v2-2026-10-06` | all `v2-2026-10-06` |
| Theme version, July | all `v2-2026-10-06` | mostly unversioned (NULL) |
| Rival themes stored, October | yes (roughly a third to a half of answers per assistant) | yes (roughly a third to a half) |
| Rival themes stored, July | yes | almost none |

Consequences:
- July is out of scope for this test (Karim, 2026-11-19), so no trend and no re-theming of Netflix July. The July rows above are kept for reference only.
- **The market x function grid is one row in a US-only test.** For the samples it becomes a function strip: Ford 11 cells, Netflix 3.

## 2. Definitions

Shared scope for every query: the client's companies (data-model scoping), `location_context` in the claim's market, the period's `created_at` window, themes on `classifier_version = 'v2-2026-10-06'` only.

**Relevant answer (for a claim).** An answer in the claim's company, market and function (NULL on the claim = all) that has at least one theme with the claim's `attribute_id`. Answers that never touch the theme are not counted for that claim. Known limit: an answer that echoes a claim but was themed under a different attribute is missed. I'll measure how often this happens on a sample before sign-off.

**Matcher verdict (per claim x relevant answer).** Claude Haiku 5.5 reads the full answer and the claim and returns one of:
- `echoes`: the answer states the claim or a clear equivalent
- `contradicts`: the answer says the opposite, as opinion or framing
- `inaccurate`: the answer states a specific fact (policy, number, event, date) that conflicts with the dated claim
- `silent`: the answer touches the theme but not this claim

It must return a verbatim quote for anything but `silent`. Every `inaccurate` starts as `pending` and only reaches a client after we confirm it.

**Narrative alignment % (headline).** Of the answers relevant to at least one active claim, the share with at least one `echoes` verdict.

```sql
-- per period; add ai_model / job_function_context to group by for the strips
select round(100.0 * count(*) filter (where echoed) / nullif(count(*),0), 1) as narrative_alignment_pct
from (
  select m.response_id, bool_or(m.verdict = 'echoes') as echoed
  from narrative_claim_matches m
  join narrative_claims c on c.id = m.claim_id and c.is_active
  join prompt_responses pr on pr.id = m.response_id
  where c.company_id = any(:company_ids)
    and pr.created_at >= :start and pr.created_at < :end
    and m.matcher_version = :matcher_version
    and m.review_status <> 'rejected'
  group by m.response_id
) a;
```

**Claim status (one per claim per period).** Proposed rule, thresholds are Karim's call:

| Status | Rule (checked in this order) |
|---|---|
| Not enough data | fewer than 10 relevant answers (shown greyed, never coloured) |
| Inaccurate | at least one confirmed `inaccurate` verdict |
| Contradiction | `contradicts` on 20% or more of relevant answers, and more often than `echoes` |
| Aligned | `echoes` on 20% or more of relevant answers |
| Gap | everything else |

I propose 20% rather than "most answers" because AI rarely repeats a specific employer claim. Under a majority rule, almost every claim would come out as a Gap. I'll show the spread at 10%, 20% and 30% on the real Ford and Netflix data before we fix the number.

**Status mix %.** Share of active claims in each status, excluding Not enough data, with the excluded share stated beside it.

**Per assistant / per function.** The same two metrics, filtered to `pr.ai_model` or `cp.job_function_context`.

**Radar.**
- Solid (what the employer says): each theme's share of the employer's active claims, scaled so the largest theme = 100. This shows emphasis, not quality.
- Dashed (what AI says): theme sentiment, using the standard v2 formula (positive / (positive + negative), neutral excluded).
- Faint (one rival): the same sentiment formula on `competitor_themes` for that rival, same scope.

The two lines use different scales. The legend must say so, or readers will read the gap between the lines as a score.

**Rival choice.** The 3 employers with the most US answers carrying `competitor_themes` rows in the period. They are market peers that AI names alongside the client, so they may appear in that client's sample. Never another PerceptionX client's data.

## 3. Cost and load (quote before running)

Matching job, Claude Haiku 5.5 via Message Batches (half price: $0.05 / $0.25 per million input / output tokens):

| Run | Answers (upper bound) | Answer text | Estimated cost |
|---|---|---|---|
| October, both clients | 4,281 | about 11.2M characters | about $0.60 |

Assumptions: about 4 characters per token, about 1,000 tokens of instructions and claims per request, about 250 output tokens. Only relevant answers are sent, so the real count is lower. I'll re-quote once the claims are loaded and stop if the per-request size grows past this. The job is over 1,000 answers, so it needs Karim's approval.

Load: reads only US answers in the October window. It writes only to the two new tables, which have no triggers and feed no materialized views. Run in Dubai working hours with a time limit per step.
