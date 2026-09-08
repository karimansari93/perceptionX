# Working notes for Claude

## About the owner

The repo owner (karim@olivtek.com) is not a backend engineer and does not want
to be one. When working on backend, database or Supabase matters:

- Investigate and apply safe fixes yourself; do not hand over SQL or ask them
  to choose between technical options.
- Explain outcomes in plain language: what was exposed or broken, what changed,
  and what (if anything) they need to click in a dashboard. Give exact click
  paths when a step can only be done in the Supabase UI.
- Say plainly when something was deliberately left alone and why.

## Supabase security lints: known accepted trade-offs

- `materialized_view_in_api` on `rankings_overview`, `rankings_historical`
  and `company_search_index` is intentional: the public site
  employers.perceptionx.ai reads them anonymously. Never revoke anon SELECT on
  them (see `supabase/migrations/20260721000000_restore_public_index_anon_grants.sql`).
- Tables meant for service-role/cron use only follow the `_cron_settings`
  pattern: RLS enabled, no policies, no anon/authenticated grants.
