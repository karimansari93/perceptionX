# Skill updates to paste (October 2026)

Paste these into the PerceptionX skills in project settings. They match
`docs/methodology-sentiment.md`.

## perceptionx-report-method

**Replace the Sentiment (v2) line under "Metric definitions" with:**

- **Sentiment (v2)** = positive / (positive + negative) themes in `ai_themes`, all four prompt types, neutral excluded. Neutral means the answer describes facts or process without judging them; a bare rating is neutral. Do not use `sentiment_score` averages or positive / all themes. Report neutral share alongside as a supporting signal, never as part of the score.

**Add to "Hard rules":**

- Before any comparison across periods, check `ai_themes.classifier_version` for every period in the comparison. Compare absolute sentiment only when all periods carry the same single version. If they differ, or any period has NULL versions, compare ranks only and add a data flag, or ask Karim whether to re-theme the older period.

**Replace the methodology-change hard rule with:**

- Across a methodology change (July 2026 question types) or a classifier version change (2026-10-06 and any later bump), compare ranks, not absolute scores, unless the older period has been re-themed with the current classifier version.

**Add to "Required pre-flight outputs":**

- The classifier version(s) behind each period's themes, and neutral share per period and per model. A neutral share that moves by more than 5 points between periods on the same questions is a data flag for Karim before any trend is written.

## perceptionx-data-model

**Add to the `ai_themes` description:**

- `classifier_version` (text): which classifier labelled the theme. NULL = labelled before 2026-10-06 and not comparable with versioned rows. Current version: `v2-2026-10-06`.

**Add under "Metric patterns":**

- **Version check** before any cross-period sentiment:
  `select date_trunc('month', pr.created_at), t.classifier_version, count(*) from ai_themes t join prompt_responses pr on pr.id = t.response_id where ... group by 1, 2;`

**Add to "Operating rules":**

- Re-theming goes through the `theme-batch` edge function (Message Batches API, half price) and needs Karim's approval with a cost estimate (about $0.003 per answer) when it covers more than 1,000 answers. Back up the themes being replaced first.
- Never change the theme classifier (`_shared/theme-analysis.ts`) without bumping `CLASSIFIER_VERSION`, running the reference check against `theme_reference_labels`, and Karim's sign-off.
