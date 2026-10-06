# PerceptionX: rules for Claude sessions

## Sentiment and theming (read before touching either)

- The definition of sentiment lives in `docs/methodology-sentiment.md`.
  Sentiment = positive / (positive + negative) themes across all four question
  types; neutral is excluded. Do not invent another formula.
- `supabase/functions/_shared/theme-analysis.ts` is the classifier. Any change
  to its model, temperature, schema, prompt or validation requires, in order:
  bump `CLASSIFIER_VERSION`, run the reference check in the methodology doc,
  get Karim's sign-off on the result. Never ship a classifier change without
  all three.
- Every `ai_themes` insert must set `classifier_version`. Before comparing
  sentiment across periods, confirm both periods carry the same single
  version; otherwise compare ranks only or re-theme.

## Cost

- Bulk re-theming goes through `theme-batch` (Message Batches API, half
  price). Do not loop live Claude calls over large sets of answers.
- Quote the estimated cost and get Karim's approval before any job over 1,000
  answers. Our timelines are usually a month, so slower and cheaper wins.
- Keep background check-ins sparse: report on completion or on a problem, not
  on a fixed hourly cadence.

## Data safety

- Supabase is read-only unless Karim asks for a change in the current
  conversation. Back up rows before replacing them, and verify afterwards.
- The Supabase MCP holds DROP and DELETE statements for a confirmation that
  does not reach cloud sessions, so they time out. Put deletes in edge
  function code or a committed migration instead of retrying them.
- Edge functions deploy automatically from `main`
  (`.github/workflows/deploy-edge-functions.yml`). A function deployed by hand
  is overwritten on the next merge, so commit every change you deploy.
