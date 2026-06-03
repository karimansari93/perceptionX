#!/usr/bin/env node
/**
 * A/B test: uncapped web search (current prod behaviour) vs a soft cap of N
 * searches, for grounded GEO collection on gpt-5.5.
 *
 * The question: the bulk of a collection call's cost is the ~27k input tokens
 * of retrieved web-search content. If we tell the model to use fewer searches,
 * how much input/cost do we save — and how many cited SOURCES do we lose?
 *
 * Runs each real prompt twice through test-prompt-openai-abtest (a temp clone of
 * prod that accepts a `maxSearches` knob): baseline (uncapped) vs candidate
 * (maxSearches=CAP). Reports, per arm and overall:
 *   - avg web searches actually performed
 *   - avg citations + distinct cited domains
 *   - domain COVERAGE: % of the baseline's source domains the capped arm kept
 *   - real token cost (flex tier) from the usage each call returns
 *
 * Usage: node scripts/ab-search-cap.mjs [--cap 2] [--concurrency 2]
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const f of ['.env.local', '.env']) {
  try {
    readFileSync(join(__dirname, '..', f), 'utf8').split('\n').forEach((line) => {
      const [k, ...v] = line.split('=');
      if (k && v.length && !process.env[k.trim()]) process.env[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
    });
  } catch { /* ignore */ }
}
const SUPA_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
if (!SUPA_URL || !KEY) { console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY'); process.exit(1); }

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const CAP = parseInt(arg('cap', '2'), 10);
const CONC = parseInt(arg('concurrency', '2'), 10);
const FN = 'test-prompt-openai-abtest';

// Flex-tier gpt-5.5 rates ($/1M tokens) + per-search tool fee.
const R = { in: 2.50, cached: 0.25, out: 15.0 };
const WEB_SEARCH_FEE = 0.025; // ~$25 / 1k tool calls (approx)

// Representative real prompts: Media & Entertainment + multi-market/function,
// including the exact example shared. Discovery/competitive prompts that lean
// hardest on broad search (the ones most at risk from a cap).
const PROMPTS = [
  'What companies in Media & Entertainment are most recognized for exceptional career development and progression opportunities for Talent & HR in Indonesia?',
  'What is the best company to work for in the Media & Entertainment industry in Brazil?',
  'How does working at Netflix compare to other companies for Software Engineering in the United States?',
  'What companies in Media & Entertainment are known for outstanding workplace culture in Germany?',
  'How do employees at Netflix perceive job security, benefits, and additional perks for Marketing in the Philippines?',
  'What companies in Media & Entertainment are recognized for diversity, equity, and inclusion in the United Kingdom?',
  'What are the compensation, benefits, and recognition details at Netflix for Finance in Japan?',
  'What companies in Media & Entertainment have the best candidate interview experience in Mexico?',
  'How does Netflix communicate its mission and purpose, and how does it resonate with employees, for Content & Production in South Korea?',
  'What companies in Media & Entertainment are most recognized for exceptional career development for Data & Analytics in India?',
];

const domains = (cs = []) => new Set(cs.map((c) => (c.domain || '').toLowerCase().replace(/^www\./, '')).filter(Boolean));
const coverage = (base, cand) => (base.size ? [...base].filter((d) => cand.has(d)).length / base.size : 1);
const costOf = (u, searches) => {
  if (!u) return 0;
  const cached = u.input_tokens_details?.cached_tokens || 0;
  const unc = (u.input_tokens || 0) - cached;
  return (unc * R.in + cached * R.cached + (u.output_tokens || 0) * R.out) / 1e6 + (searches || 0) * WEB_SEARCH_FEE;
};

async function call(prompt, maxSearches) {
  const body = { prompt };
  if (maxSearches) body.maxSearches = maxSearches;
  const res = await fetch(`${SUPA_URL}/functions/v1/${FN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data?.error) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function run(prompt, idx) {
  try {
    const [base, cap] = await Promise.all([call(prompt), call(prompt, CAP)]);
    const bD = domains(base.citations), cD = domains(cap.citations);
    const row = {
      bSearch: base.webSearchCalls, cSearch: cap.webSearchCalls,
      bCites: bD.size, cCites: cD.size,
      cov: coverage(bD, cD),
      bIn: base.usage?.input_tokens || 0, cIn: cap.usage?.input_tokens || 0,
      bCost: costOf(base.usage, base.webSearchCalls), cCost: costOf(cap.usage, cap.webSearchCalls),
    };
    console.log(`  [${idx + 1}/${PROMPTS.length}] searches ${row.bSearch}->${row.cSearch} | domains ${row.bCites}->${row.cCites} | kept ${(row.cov * 100).toFixed(0)}% | $${row.bCost.toFixed(3)}->$${row.cCost.toFixed(3)}`);
    return row;
  } catch (e) { console.warn(`  [${idx + 1}/${PROMPTS.length}] FAILED: ${e.message}`); return null; }
}

const avg = (rs, f) => rs.reduce((s, r) => s + f(r), 0) / rs.length;
const sum = (rs, f) => rs.reduce((s, r) => s + f(r), 0);

(async () => {
  console.log(`\nA/B: uncapped vs maxSearches=${CAP} — ${PROMPTS.length} prompts, gpt-5.5 + web search (flex)\n`);
  const rows = [];
  for (let i = 0; i < PROMPTS.length; i += CONC) {
    rows.push(...(await Promise.all(PROMPTS.slice(i, i + CONC).map((p, j) => run(p, i + j)))));
  }
  const ok = rows.filter(Boolean);
  if (!ok.length) { console.error('No successful comparisons'); process.exit(1); }
  const bCost = sum(ok, (r) => r.bCost), cCost = sum(ok, (r) => r.cCost);
  console.log('\n' + '='.repeat(64));
  console.log(`Prompts compared:            ${ok.length}/${PROMPTS.length}`);
  console.log(`Avg web searches:            ${avg(ok, r=>r.bSearch).toFixed(1)} (uncapped)  ->  ${avg(ok, r=>r.cSearch).toFixed(1)} (cap ${CAP})`);
  console.log(`Avg input tokens:            ${avg(ok, r=>r.bIn).toFixed(0)}  ->  ${avg(ok, r=>r.cIn).toFixed(0)}`);
  console.log(`Avg distinct cited domains:  ${avg(ok, r=>r.bCites).toFixed(1)}  ->  ${avg(ok, r=>r.cCites).toFixed(1)}`);
  console.log(`Avg domain COVERAGE kept:    ${(avg(ok, r=>r.cov) * 100).toFixed(0)}%   <- % of uncapped's source domains the cap retained`);
  console.log('');
  console.log(`Total cost (uncapped):       $${bCost.toFixed(3)}`);
  console.log(`Total cost (cap ${CAP}):           $${cCost.toFixed(3)}`);
  console.log(`COST SAVING:                 ${((1 - cCost / bCost) * 100).toFixed(0)}%  ($${(bCost - cCost).toFixed(3)} over ${ok.length} prompts)`);
  console.log('='.repeat(64));
  console.log(`\nRead: high coverage kept + big cost saving => the cap is a free win.`);
  console.log(`Low coverage kept => the extra searches are finding real sources; keep them.\n`);
})().catch((e) => { console.error('Fatal:', e); process.exit(1); });
