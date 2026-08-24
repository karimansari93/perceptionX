#!/usr/bin/env node
/**
 * check-migration-drift.mjs
 *
 * Compares Supabase's applied-migration ledger (supabase_migrations.schema_migrations)
 * against the files in supabase/migrations/, and fails if they have diverged.
 *
 * Matching is on NAME, not on the timestamp prefix: several filename timestamps in
 * this repo were invented locally and do not equal the `version` prod recorded.
 *
 *   node scripts/check-migration-drift.mjs        # fail on any un-baselined gap
 *   node scripts/check-migration-drift.mjs --full # also list the baselined entries
 *
 * Requires SUPABASE_DB_URL in the environment (never commit it):
 *   export SUPABASE_DB_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres'
 *   npm run check:db-drift
 *
 * Get the string from Supabase Studio -> Project Settings -> Database -> Connection string.
 *
 * A known, explained gap lives in scripts/migration-drift-baseline.json so the check can
 * pass today and still catch anything NEW. Read that file before adding to it: an entry
 * there is a permanent "we accept this", not a way to silence a real drift.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const MIGRATIONS_DIR = join(REPO, 'supabase', 'migrations');
const BASELINE_PATH = join(HERE, 'migration-drift-baseline.json');

const showFull = process.argv.includes('--full');

function fail(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(2);
}

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  fail(
    'SUPABASE_DB_URL is not set.\n' +
      "  export SUPABASE_DB_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres'\n" +
      '  (Supabase Studio -> Project Settings -> Database -> Connection string.)\n' +
      '  Do not commit it.'
  );
}

/** Filename -> migration name: strip the 14-digit timestamp prefix and the .sql suffix. */
function nameFromFile(file) {
  return file.replace(/\.sql$/, '').replace(/^\d{14}_/, '');
}

function readBaseline() {
  try {
    const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    return {
      repoOnly: new Map((raw.repoOnly ?? []).map((e) => [e.name, e.reason])),
      prodOnly: new Map((raw.prodOnly ?? []).map((e) => [e.name, e.reason])),
    };
  } catch (err) {
    if (err.code === 'ENOENT') return { repoOnly: new Map(), prodOnly: new Map() };
    throw err;
  }
}

function list(rows, render) {
  for (const row of rows) console.log(`    ${render(row)}`);
}

const client = new pg.Client({
  connectionString: dbUrl,
  // Supabase terminates TLS with a cert this client has no root for; the
  // connection is still encrypted. Set SUPABASE_DB_SSL=disable for a local
  // (supabase start) database, which speaks plaintext.
  ssl: process.env.SUPABASE_DB_SSL === 'disable' ? false : { rejectUnauthorized: false },
});

let exitCode = 0;
try {
  await client.connect();

  const { rows: prodRows } = await client.query(
    'select version, name from supabase_migrations.schema_migrations order by version'
  );

  const repoFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const repoNames = new Set(repoFiles.map(nameFromFile));
  const prodNames = new Set(prodRows.map((r) => r.name));
  const baseline = readBaseline();

  const prodOnly = prodRows.filter((r) => !repoNames.has(r.name));
  const repoOnly = repoFiles.filter((f) => !prodNames.has(nameFromFile(f)));

  const newProdOnly = prodOnly.filter((r) => !baseline.prodOnly.has(r.name));
  const newRepoOnly = repoOnly.filter((f) => !baseline.repoOnly.has(nameFromFile(f)));

  console.log('\nMigration drift check');
  console.log(`  ledger rows          : ${prodRows.length}`);
  console.log(`  migration files      : ${repoFiles.length}`);
  console.log(`  matched on name      : ${prodRows.filter((r) => repoNames.has(r.name)).length}`);
  console.log(
    `  baselined (accepted) : ${prodOnly.length - newProdOnly.length} prod-only, ` +
      `${repoOnly.length - newRepoOnly.length} repo-only`
  );

  if (newProdOnly.length) {
    exitCode = 1;
    console.log(`\n  APPLIED TO THE DATABASE BUT NOT IN THE REPO (${newProdOnly.length}):`);
    list(newProdOnly, (r) => `${r.version}  ${r.name}`);
    console.log(
      '\n    Recover each with:\n' +
        "      select array_to_string(statements, E'\\n') from supabase_migrations.schema_migrations where version = '<version>';\n" +
        '    and save it as supabase/migrations/<version>_<name>.sql'
    );
  }

  if (newRepoOnly.length) {
    exitCode = 1;
    console.log(`\n  IN THE REPO BUT NEVER APPLIED UNDER THAT NAME (${newRepoOnly.length}):`);
    list(newRepoOnly, (f) => f);
    console.log(
      '\n    Either apply it with `apply_migration` using the same name as the file,\n' +
        '    or, if it was applied under a different name, rename the file to match.'
    );
  }

  if (showFull) {
    if (prodOnly.length - newProdOnly.length) {
      console.log('\n  baselined prod-only:');
      list(
        prodOnly.filter((r) => baseline.prodOnly.has(r.name)),
        (r) => `${r.version}  ${r.name} — ${baseline.prodOnly.get(r.name)}`
      );
    }
    if (repoOnly.length - newRepoOnly.length) {
      console.log('\n  baselined repo-only:');
      list(
        repoOnly.filter((f) => baseline.repoOnly.has(nameFromFile(f))),
        (f) => `${f} — ${baseline.repoOnly.get(nameFromFile(f))}`
      );
    }
  }

  console.log(exitCode === 0 ? '\n  OK — no new drift.\n' : '\n  DRIFT DETECTED.\n');
} catch (err) {
  fail(`Drift check could not run: ${err.message}`);
} finally {
  await client.end().catch(() => {});
}

process.exit(exitCode);
