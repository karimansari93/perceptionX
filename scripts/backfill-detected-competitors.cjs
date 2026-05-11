#!/usr/bin/env node

/**
 * Backfill prompt_responses.detected_competitors for rows that were left empty
 * because the OpenAI-backed detect-competitors edge function failed silently
 * (e.g. when monthly budget was hit on 2026-05-08..10).
 *
 * Re-runs detect-competitors against response_text, applies the same filter
 * as analyze-response, and UPDATEs the row. Safe to re-run.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/backfill-detected-competitors.js [--since 2026-05-08] \
 *                                                    [--limit 100] \
 *                                                    [--batch 10] \
 *                                                    [--dry-run] \
 *                                                    [--include-empty-string]
 *
 * Flags:
 *   --since                 ISO date (default: 2026-05-08)
 *   --limit                 max rows to process this run (default: all)
 *   --batch                 concurrent edge function calls (default: 8)
 *   --dry-run               print what would change without writing
 *   --include-empty-string  also reprocess rows with '' (default: NULL only)
 */

const { createClient } = require('@supabase/supabase-js');
try { require('dotenv').config(); } catch (_) { /* dotenv optional */ }

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error(
    '❌ Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars (anon key cannot UPDATE prompt_responses).',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const options = {
  since: '2026-05-08',
  limit: null,
  batch: 8,
  dryRun: false,
  includeEmptyString: false,
  industryWide: false, // when true, processes rows with NULL company_id using industry-wide detection
};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--since') options.since = args[++i];
  else if (a === '--limit') options.limit = parseInt(args[++i], 10);
  else if (a === '--batch') options.batch = parseInt(args[++i], 10);
  else if (a === '--dry-run') options.dryRun = true;
  else if (a === '--include-empty-string') options.includeEmptyString = true;
  else if (a === '--industry-wide') options.industryWide = true;
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const STOPWORDS = new Set([
  'other', 'others', 'equal', 'training', 'development', 'skills', 'school',
  'its', 'the', 'and', 'or', 'companies', 'company', 'co', 'inc', 'llc', 'ltd',
]);

function filterCompetitors(raw, companyName) {
  if (!raw) return '';
  return raw
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n.length >= 2)
    .filter((n) => !/\bother\b/i.test(n) || /\bother\b/i.test(companyName) === false)
    .filter((n) => /[A-Z]/.test(n))
    .filter((n) => !STOPWORDS.has(n.toLowerCase()))
    .slice(0, 10)
    .join(', ');
}

async function detectCompetitors(responseText, companyName) {
  const r = await fetch(`${supabaseUrl}/functions/v1/detect-competitors`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ response: responseText, companyName }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`detect-competitors ${r.status}: ${body.slice(0, 200)}`);
  }
  const data = await r.json();
  return data.detectedCompetitors ?? '';
}

async function fetchTargets() {
  // Pull rows in pages — Supabase caps a single select at ~1000.
  const PAGE = 1000;
  const all = [];
  let from = 0;
  while (true) {
    let q = supabase
      .from('prompt_responses')
      .select('id, response_text, company_id, ai_model, detected_competitors')
      .gte('created_at', options.since)
      .not('response_text', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);

    if (options.industryWide) {
      // Second pass: only rows with NULL company_id (discovery / industry-wide prompts)
      q = q.is('company_id', null);
    }

    q = options.includeEmptyString
      ? q.or('detected_competitors.is.null,detected_competitors.eq.')
      : q.is('detected_competitors', null);

    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (options.limit && all.length >= options.limit) {
      return all.slice(0, options.limit);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function getCompanyNames(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map();
  const CHUNK = 500;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('companies')
      .select('id, name')
      .in('id', chunk);
    if (error) throw error;
    for (const c of data) map.set(c.id, c.name);
  }
  return map;
}

async function processRow(row, companyName) {
  if (!row.response_text || row.response_text.trim().length === 0) {
    return { id: row.id, skipped: 'empty_response' };
  }
  // Industry-wide mode: pass empty companyName to trigger detect-competitors'
  // "list ALL companies mentioned" path. Used for discovery / industry prompts
  // where there's no focal company.
  if (options.industryWide) {
    const raw = await detectCompetitors(row.response_text, '');
    const filtered = filterCompetitors(raw, '');
    if (options.dryRun) return { id: row.id, would_set: filtered, raw };
    const { error } = await supabase
      .from('prompt_responses')
      .update({ detected_competitors: filtered })
      .eq('id', row.id);
    if (error) throw error;
    return { id: row.id, set: filtered };
  }
  if (!companyName) return { id: row.id, skipped: 'no_company_name' };
  const raw = await detectCompetitors(row.response_text, companyName);
  const filtered = filterCompetitors(raw, companyName);

  if (options.dryRun) {
    return { id: row.id, would_set: filtered, raw };
  }

  const { error } = await supabase
    .from('prompt_responses')
    .update({ detected_competitors: filtered })
    .eq('id', row.id);
  if (error) throw error;
  return { id: row.id, set: filtered };
}

async function main() {
  console.log('🔎 Loading target rows...');
  console.log(`   since=${options.since} include-empty-string=${options.includeEmptyString} limit=${options.limit ?? 'all'} batch=${options.batch} dry-run=${options.dryRun}`);

  const rows = await fetchTargets();
  console.log(`   ${rows.length} rows to process`);
  if (rows.length === 0) return;

  const companies = await getCompanyNames(rows.map((r) => r.company_id));
  console.log(`   ${companies.size} distinct companies\n`);

  let done = 0;
  let updated = 0;
  let nonEmpty = 0;
  let failed = 0;
  let skipped = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i += options.batch) {
    const slice = rows.slice(i, i + options.batch);
    const results = await Promise.allSettled(
      slice.map((row) => processRow(row, companies.get(row.company_id))),
    );
    for (let j = 0; j < results.length; j++) {
      const res = results[j];
      done++;
      if (res.status === 'rejected') {
        failed++;
        errors.push(`row ${slice[j].id}: ${res.reason?.message || res.reason}`);
        continue;
      }
      const v = res.value;
      if (v.skipped) {
        skipped++;
      } else {
        updated++;
        const value = options.dryRun ? v.would_set : v.set;
        if (value && value.length > 0) nonEmpty++;
      }
    }
    if (done % 50 === 0 || done === rows.length) {
      console.log(
        `  ${done}/${rows.length}  updated=${updated}  non-empty=${nonEmpty}  skipped=${skipped}  failed=${failed}`,
      );
    }
  }

  console.log('\n✅ Done');
  console.log(`   updated:   ${updated}`);
  console.log(`   non-empty: ${nonEmpty}`);
  console.log(`   skipped:   ${skipped}`);
  console.log(`   failed:    ${failed}`);
  if (errors.length > 0) {
    console.log('\nFirst errors:');
    for (const e of errors.slice(0, 10)) console.log('  -', e);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
