#!/usr/bin/env node
/**
 * A/B test: GPT-5.5 vs a mini model for grounded GEO collection.
 *
 * Runs the same real prompts through test-prompt-openai twice — once on the
 * default model (gpt-5.5) and once on a cheaper override (gpt-5.4-mini) — both
 * with web search, then reports:
 *   - citation overlap (domain + URL) between the two models
 *   - average citations per response
 *   - real token cost per model (from the usage the function returns)
 *
 * The question it answers: if our product is "which sources does AI cite",
 * does the mini surface the same sources for a fraction of the cost?
 *
 * Usage:
 *   node scripts/compare-openai-models.mjs
 *   node scripts/compare-openai-models.mjs --candidate gpt-5-mini --concurrency 2
 *
 * Requires VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY in .env.local or .env.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

for (const f of ['.env.local', '.env']) {
  try {
    readFileSync(join(projectRoot, f), 'utf8').split('\n').forEach((line) => {
      const [k, ...v] = line.split('=');
      if (k && v.length && !process.env[k.trim()]) {
        process.env[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
      }
    });
  } catch { /* file may not exist */ }
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (in .env.local or .env).');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- args ---
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const CANDIDATE_MODEL = getArg('candidate', 'gpt-5.4-mini'); // baseline = default (gpt-5.5)
const CONCURRENCY = parseInt(getArg('concurrency', '3'), 10);

// Per-1M-token rates (USD). Baseline 5.5 is exact; mini rates are estimates —
// adjust to your actual pricing if needed. Web search billed separately below.
const RATES = {
  'gpt-5.5':      { in: 5.0,  cached: 0.5,   out: 30.0 },
  'gpt-5.4-mini': { in: 0.25, cached: 0.025, out: 2.0  },
  'gpt-5-mini':   { in: 0.25, cached: 0.025, out: 2.0  },
  _default:       { in: 5.0,  cached: 0.5,   out: 30.0 },
};
const WEB_SEARCH_FEE = 0.01; // ~$10 / 1k tool calls, model-independent

// Representative real prompts (random sample of the Netflix org set, multi-market).
const PROMPTS = [
  'How do new hires feel about onboarding at Netflix for Marketing in Indonesia?',
  '¿Qué empresas en Tecnología son conocidas por proporcionar retroalimentación valiosa a los candidatos en México?',
  'How well does Netflix communicate its mission and purpose to employees, and how does this resonate with their personal values for Finance in Thailand?',
  'Hebt sich Netflix in Bezug auf die Kandidatenerfahrung in der Technologie für Marketing in Deutschland hervor?',
  'What are the job security, benefits, and perks at Netflix for Marketing in Thailand?',
  '¿Cuál es la mejor empresa para trabajar en la industria de Tecnología en Argentina?',
  '넷플릭스는 한국의 콘텐츠 및 제작 부문을 위한 사명과 목적에 대해 무엇을 전달하나요?',
  'Quais são os detalhes de trabalho e emprego na Netflix para Marketing no Brasil?',
  'What are the compensation, benefits, and recognition details at Netflix for Communications & PR in Philippines?',
  "Welke sociale impactprogramma's en verplichtingen biedt Netflix voor Finance & Operations in Nederland?",
  'How do employees at Netflix perceive job security, benefits, and additional perks provided by the company for Finance in Thailand?',
  '넷플릭스는 소프트웨어 엔지니어를 채용하는 회사들 중에서 후보자 경험에서 두드러지나요?',
];

const domainsOf = (citations = []) =>
  new Set(citations.map((c) => (c.domain || '').toLowerCase().replace(/^www\./, '')).filter(Boolean));
const urlsOf = (citations = []) =>
  new Set(citations.map((c) => (c.url || '').split('?')[0].replace(/\/$/, '')).filter(Boolean));

const jaccard = (a, b) => {
  if (!a.size && !b.size) return 1;
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 0;
};
// fraction of baseline's items also found by candidate
const coverage = (base, cand) => (base.size ? [...base].filter((x) => cand.has(x)).length / base.size : 1);

const costOf = (model, usage) => {
  if (!usage) return 0;
  const r = RATES[model] || RATES._default;
  const cached = usage.input_tokens_details?.cached_tokens || 0;
  const uncached = (usage.input_tokens || 0) - cached;
  const out = usage.output_tokens || 0;
  return (uncached * r.in + cached * r.cached + out * r.out) / 1e6;
};

async function callModel(prompt, model) {
  const body = { prompt };
  if (model) body.model = model;
  const { data, error } = await supabase.functions.invoke('test-prompt-openai', { body });
  if (error) throw new Error(error.message || String(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

async function runPrompt(prompt, idx) {
  try {
    const [base, cand] = await Promise.all([
      callModel(prompt, undefined),          // baseline: default gpt-5.5
      callModel(prompt, CANDIDATE_MODEL),    // candidate: mini
    ]);
    const bDom = domainsOf(base.citations), cDom = domainsOf(cand.citations);
    const bUrl = urlsOf(base.citations), cUrl = urlsOf(cand.citations);
    const row = {
      idx,
      prompt: prompt.slice(0, 48),
      baseModel: base.model, candModel: cand.model,
      baseCites: bDom.size, candCites: cDom.size,
      domJaccard: jaccard(bDom, cDom),
      domCoverage: coverage(bDom, cDom),
      urlJaccard: jaccard(bUrl, cUrl),
      baseCost: costOf('gpt-5.5', base.usage) + (base.webSearchCalls || 0) * WEB_SEARCH_FEE,
      candCost: costOf(CANDIDATE_MODEL, cand.usage) + (cand.webSearchCalls || 0) * WEB_SEARCH_FEE,
      baseTier: base.serviceTier, candTier: cand.serviceTier,
    };
    console.log(`  [${idx + 1}/${PROMPTS.length}] domain overlap ${(row.domJaccard * 100).toFixed(0)}% | coverage ${(row.domCoverage * 100).toFixed(0)}% | $${row.baseCost.toFixed(3)} vs $${row.candCost.toFixed(3)}`);
    return row;
  } catch (e) {
    console.warn(`  [${idx + 1}/${PROMPTS.length}] FAILED: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log(`\n🧪 GPT-5.5 (default) vs ${CANDIDATE_MODEL} — ${PROMPTS.length} prompts, both with web search\n`);
  const rows = [];
  for (let i = 0; i < PROMPTS.length; i += CONCURRENCY) {
    const batch = PROMPTS.slice(i, i + CONCURRENCY).map((p, j) => runPrompt(p, i + j));
    rows.push(...(await Promise.all(batch)));
  }
  const ok = rows.filter(Boolean);
  if (!ok.length) { console.error('\n❌ No successful comparisons.'); process.exit(1); }

  const avg = (f) => ok.reduce((s, r) => s + f(r), 0) / ok.length;
  const sum = (f) => ok.reduce((s, r) => s + f(r), 0);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('RESULTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Prompts compared:            ${ok.length}/${PROMPTS.length}`);
  console.log(`Models:                      ${ok[0].baseModel}  vs  ${ok[0].candModel}`);
  console.log(`Service tiers seen:          base=${[...new Set(ok.map(r=>r.baseTier))].join('/')}  cand=${[...new Set(ok.map(r=>r.candTier))].join('/')}`);
  console.log('');
  console.log(`Avg citations / response:    ${avg(r=>r.baseCites).toFixed(1)} (5.5)   vs   ${avg(r=>r.candCites).toFixed(1)} (mini)`);
  console.log(`Avg DOMAIN overlap (Jaccard):${(avg(r=>r.domJaccard)*100).toFixed(0)}%`);
  console.log(`Avg DOMAIN coverage of 5.5:  ${(avg(r=>r.domCoverage)*100).toFixed(0)}%   <- % of flagship's source sites the mini also cited`);
  console.log(`Avg exact-URL overlap:       ${(avg(r=>r.urlJaccard)*100).toFixed(0)}%`);
  console.log('');
  console.log(`Total cost (5.5):            $${sum(r=>r.baseCost).toFixed(3)}`);
  console.log(`Total cost (${CANDIDATE_MODEL}): $${sum(r=>r.candCost).toFixed(3)}`);
  console.log(`Cost ratio:                  ${(sum(r=>r.baseCost)/Math.max(sum(r=>r.candCost),1e-9)).toFixed(1)}x cheaper on mini`);
  console.log('');
  console.log('Rule of thumb: domain coverage >~80% => the mini surfaces essentially the');
  console.log('same sources; switching is defensible for a source-measurement product.');
  console.log('Lower coverage => the flagship is finding/citing sources the mini misses.\n');
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
