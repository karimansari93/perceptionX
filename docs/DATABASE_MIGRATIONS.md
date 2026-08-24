# Database migrations

`supabase/migrations/` is the source of truth for the database schema. If a change is
in production but not in that folder, the repo can no longer rebuild the database — and
nobody finds out until they try.

That is exactly what happened once already: 307 migrations were applied through the
Supabase MCP `apply_migration` tool without the matching file ever being committed, and
another 35 went in through `execute_sql` or under a name the file does not carry, which
leaves nothing to match against. Recovering the 307 took a full pass over
`supabase_migrations.schema_migrations`; two more rows could not be recovered at all
because their `statements` array is NULL. The rules below exist so that does not happen
again.

## The three rules

**1. Write the file first, then apply the identical SQL — with the same name.**

```
supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql
```

Write the file, then call `apply_migration` with `name` set to exactly the `<name>` part
of the filename and `query` set to exactly the file's contents. The drift check matches
on **name**, not on the timestamp, so the names have to agree. If you change the SQL
after a failed apply, change the file too — they must not diverge.

**2. Never use `execute_sql` for DDL.**

`execute_sql` runs the statement and records nothing. A migration applied that way is
invisible to `supabase_migrations.schema_migrations`, so the drift check cannot see it
and the SQL is unrecoverable if the file was never written. Reserve `execute_sql` for
reads and ad-hoc inspection. Anything that changes schema, functions, policies, grants,
triggers, cron jobs or seed data goes through `apply_migration`.

`20260817120000_activate_client_job_functions.sql` is the cautionary example: its
original text is gone for good. What is in the repo was reconstructed from
`pg_get_functiondef` after the fact and carries changes from later migrations, because
that is all the live database could tell us.

**3. Run the drift check before you finish a session that touched the database.**

```bash
export SUPABASE_DB_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres'
npm run check:db-drift
```

It exits non-zero if the ledger and the folder disagree. Never commit the connection
string — take it from Supabase Studio → Project Settings → Database → Connection string
and keep it in your shell or a git-ignored `.env.local`.

## What the drift check reports

- **Applied to the database but not in the repo** — someone applied a migration whose
  file was never committed. Recover it:

  ```sql
  select array_to_string(statements, E'\n')
  from supabase_migrations.schema_migrations
  where version = '<version>';
  ```

  Save the result as `supabase/migrations/<version>_<name>.sql`, using prod's own
  `version` and `name` so the ledger and the folder line up.

- **In the repo but never applied under that name** — either the migration was never
  applied, or it was applied under a different name. Apply it, or rename the file to
  match what prod recorded.

Add `--full` to also list the baselined entries:

```bash
node scripts/check-migration-drift.mjs --full
```

## The baseline

`scripts/migration-drift-baseline.json` records the gap that existed when the check was
introduced and that cannot be closed. Everything in it is explained; the check ignores
these and fails on anything new.

It covers three things:

- **Files older than the ledger.** `supabase_migrations.schema_migrations` only goes back
  to `20260205140000`. Migration files with earlier timestamps have no row and never will.
  This is not drift.
- **Ledger rows with no recoverable SQL.** Five rows have `statements` NULL, so there is
  nothing to write into a file. Three of those names happen to match a file anyway; the
  other two (`rebuild_rankings_historical`, `rankings_rpcs`) are gone for good.
- **Files applied via `execute_sql`.** No ledger row exists under that name. These are the
  rule-2 violations that predate the rule. One entry,
  `activate_channels_local_highlights`, is a different case: it merges two migrations that
  production applied separately, and both of those are now back-filled under their own
  names.

**Adding to the baseline is not how you make the check pass.** An entry there is a
permanent statement that the gap is understood and accepted. New drift means one of the
first two rules was broken — fix the cause, not the check.

## Notes

- Filename timestamps in this repo are not all equal to prod's `version`. Many older ones
  were invented locally before the ledger existed. That is why matching is on name.
- Prod's ledger has a few duplicate names (the same migration applied twice under one
  name). The check compares name *sets*, so duplicates do not trip it.
- Back-filled files carry a header saying they were recovered from
  `supabase_migrations.schema_migrations` and post-date the deployment. Their SQL is
  verbatim; the header is the only addition.
- There are no GitHub Actions workflows in this repo, so the check is a local command.
  If CI is added later, `npm run check:db-drift` is the thing to wire up — it needs only
  `SUPABASE_DB_URL` as a secret.
