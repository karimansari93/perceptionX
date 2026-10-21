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

- All AI theming is batch-only (Karim, 2026-10-06): new collections and
  re-runs alike go through `theme-batch` (Message Batches API, half price).
  `ai-thematic-analysis` and `ai-thematic-analysis-bulk` only queue
  responses; never add a live Claude call for themes back.
- Quote the estimated cost and get Karim's approval before any job over 1,000
  answers. Our timelines are usually a month, so slower and cheaper wins.
- Flag cost before it happens, for any AI job (collection, extraction,
  canonicalization, theming): quote it up front, and stop and re-quote to
  Karim if the scale or the per-call size grows past the quote (Karim,
  2026-10-18, after a canonicalization run cost several times its estimate
  because the canonical list sent with every call grew 8x). Offer a cheaper
  route when one exists.
- Use the cheapest model that does the job. OpenAI is only for measuring
  ChatGPT itself; supporting work (canonicalization, extraction) runs on
  Claude Haiku or another cheap model, never gpt-4.1-class models. Never send
  a whole table in a prompt; send a shortlist.
- Keep background check-ins sparse: report on completion or on a problem, not
  on a fixed hourly cadence.

## Database load (read before any collection, rebuild or bulk job)

- Nothing runs on a schedule except the workers that carry out a run someone
  started (Karim, 2026-10-21). Index and client maintenance run by hand after
  each quarterly collection or recollection: follow
  `docs/RUNBOOK_AFTER_COLLECTION.md`. Do not switch paused cron jobs back on.
- Before any collection, rebuild or bulk job over 1,000 answers: check the
  Disk IO budget in the Supabase dashboard, run heavy steps one at a time and
  off-peak (21:00 to 06:00 UTC), and give each a time limit. On 2026-10-21 an
  untimed full scan after a 56,000-answer collection exhausted the budget and
  took the database down for about two hours.
- Quote the load as well as the cost: say what else the new rows will set off
  (triggers, ticks, refreshes) before starting.
- Never scan all of `prompt_responses` or `index_responses` in one query from
  a scheduled job. Scope it to the new collection's dates.

## Data safety

- Supabase is read-only unless Karim asks for a change in the current
  conversation. Back up rows before replacing them, and verify afterwards.
- The Supabase MCP holds DROP and DELETE statements for a confirmation that
  does not reach cloud sessions, so they time out. Put deletes in edge
  function code or a committed migration instead of retrying them.
- Edge functions deploy automatically from `main`
  (`.github/workflows/deploy-edge-functions.yml`). A function deployed by hand
  is overwritten on the next merge, so commit every change you deploy.
