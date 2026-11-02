#!/usr/bin/env node
/**
 * Comparison: competitor detection on Claude Haiku 5.5 (current
 * detect-competitors prompt) against the lists OpenAI gpt-4.1-nano stored in
 * July, on the same answers. Run before backfilling October, so October and
 * July count competitors the same way (Rodrigo, 2026-11-02; sign-off: Karim).
 *
 * Calls Claude exactly as detect-competitors does: same prompts (imported from
 * supabase/functions/_shared/competitor-prompt.ts), model, max_tokens and
 * thinking off; then the same handling of an empty reply and the same name
 * filter analyze-response applies. Nothing is written to the database.
 *
 * Input: a JSON array of { id, ai_model, company, response_text, old }
 * exported from Supabase, where `old` is the stored detected_competitors.
 * Sample used for CSL Behring, July 2026 (25 answers per AI assistant):
 *
 *   with s as (
 *     select pr.id, pr.ai_model, c.name company, pr.response_text,
 *            pr.detected_competitors old,
 *            row_number() over (partition by pr.ai_model order by md5(pr.id::text)) rn
 *     from prompt_responses pr join companies c on c.id = pr.company_id
 *     where c.name = 'CSL Behring' and length(c.name) >= 3
 *       and pr.tested_at >= '2026-07-01' and pr.tested_at < '2026-08-01'
 *       and pr.detected_competitors is not null)
 *   select json_agg(s) from s where rn <= 25;
 *
 * Needs CLAUDE_API_KEY in the environment. Cost: about 100 Haiku calls of
 * ~1,300 input tokens, under $0.05.
 *
 * Usage: node --experimental-strip-types scripts/compare-competitor-detection.mjs \
 *          --data sample.json [--out results.csv] [--concurrency 4]
 */
import { readFileSync, writeFileSync } from 'fs';
import { competitorPrompts, filterCompetitorNames } from '../supabase/functions/_shared/competitor-prompt.ts';

const MODEL = 'claude-haiku-5-5';
// Haiku 5.5, $ per 1M tokens (standard API).
const PRICE = { in: 0.10, out: 0.50 };

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const DATA = arg('data');
const OUT = arg('out');
const CONC = parseInt(arg('concurrency', '4'), 10);
const KEY = process.env.CLAUDE_API_KEY;
if (!DATA) { console.error('Missing --data <sample.json>'); process.exit(1); }
if (!KEY) { console.error('Missing CLAUDE_API_KEY'); process.exit(1); }

const rows = JSON.parse(readFileSync(DATA, 'utf8'));

// Same request and reply handling as detect-competitors.
async function detect(text, company) {
  const { systemPrompt, userPrompt } = competitorPrompts(text, company);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 200,
      thinking: { type: 'disabled' },
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) return { error: `${res.status} ${data?.error?.message ?? ''}` };
  const usage = data.usage ?? {};
  const textBlocks = (data.content || []).filter((b) => b.type === 'text');
  if (textBlocks.length === 0) {
    return data.stop_reason === 'end_turn'
      ? { raw: '', usage }
      : { error: `no content (stop_reason ${data.stop_reason})`, usage };
  }
  let raw = textBlocks.map((b) => b.text).join('').trim();
  if (raw.includes('There are no specific company names mentioned as competitors or alternatives') ||
      raw.includes('Some companies mentioned as competitors or alternatives')) raw = '';
  return { raw, usage };
}

const names = (s) => (s || '').split(',').map((n) => n.trim()).filter(Boolean);
const key = (n) => n.toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
// A "name" that is really a sentence, or a refusal word: what the pilot stored.
const isJunk = (n) => n.split(' ').length > 6 || /^(none|n\/a|null)$/i.test(n) || /\b(text|competitor|mention)/i.test(n);

const results = [];
let next = 0;
async function worker() {
  while (next < rows.length) {
    const r = rows[next++];
    const out = await detect(r.response_text, r.company);
    const stored = out.error ? null : filterCompetitorNames(out.raw, r.company);
    results.push({ ...r, raw: out.raw ?? null, stored, error: out.error ?? null, usage: out.usage ?? {} });
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

// Per answer: does each model find any competitor, and how much do the lists overlap.
const byModel = {};
let inTok = 0, outTok = 0;
for (const r of results) {
  inTok += r.usage.input_tokens ?? 0;
  outTok += r.usage.output_tokens ?? 0;
  const m = (byModel[r.ai_model] ??= { n: 0, errors: 0, oldAny: 0, newAny: 0, bothAny: 0, bothNone: 0, recall: [], precision: [], junk: 0 });
  m.n++;
  if (r.error) { m.errors++; continue; }
  const o = new Set(names(r.old).map(key)), nw = names(r.stored);
  const n = new Set(nw.map(key));
  if (nw.some(isJunk)) m.junk++;
  if (o.size) m.oldAny++;
  if (n.size) m.newAny++;
  if (o.size && n.size) m.bothAny++;
  if (!o.size && !n.size) m.bothNone++;
  if (o.size) m.recall.push([...o].filter((x) => n.has(x)).length / o.size);
  if (n.size) m.precision.push([...n].filter((x) => o.has(x)).length / n.size);
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const avg = (xs) => (xs.length ? `${Math.round((100 * xs.reduce((a, b) => a + b, 0)) / xs.length)}%` : '-');
const all = Object.values(byModel).reduce((t, m) => {
  for (const k of ['n', 'errors', 'oldAny', 'newAny', 'bothAny', 'bothNone', 'junk']) t[k] += m[k];
  t.recall.push(...m.recall); t.precision.push(...m.precision);
  return t;
}, { n: 0, errors: 0, oldAny: 0, newAny: 0, bothAny: 0, bothNone: 0, recall: [], precision: [], junk: 0 });

console.log('\nAI assistant          answers  errors  old finds any  new finds any  agree any/none  old names kept  new names in old  junk');
for (const [model, m] of [...Object.entries(byModel).sort(), ['ALL', all]]) {
  const ok = m.n - m.errors;
  console.log(
    `${model.padEnd(22)}${String(m.n).padStart(7)}${String(m.errors).padStart(8)}` +
    `${pct(m.oldAny, ok).padStart(15)}${pct(m.newAny, ok).padStart(15)}` +
    `${pct(m.bothAny + m.bothNone, ok).padStart(16)}${avg(m.recall).padStart(16)}${avg(m.precision).padStart(18)}${String(m.junk).padStart(6)}`,
  );
}
console.log(`\nTokens: ${inTok} in, ${outTok} out. Cost: $${((inTok * PRICE.in + outTok * PRICE.out) / 1e6).toFixed(4)}`);

if (OUT) {
  const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = ['id,ai_model,old,new,raw,error', ...results.map((r) =>
    [r.id, r.ai_model, r.old, r.stored, r.raw, r.error].map(esc).join(','))];
  writeFileSync(OUT, lines.join('\n'));
  console.log(`Per-answer results: ${OUT}`);
}
