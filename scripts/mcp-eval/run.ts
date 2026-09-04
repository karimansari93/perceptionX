// MCP server eval — run against a deployed mcp-server with an org PAT.
//
//   MCP_URL=https://<ref>.supabase.co/functions/v1/mcp-server \
//   MCP_TOKEN=pxk_... \
//   deno run --allow-net --allow-env --allow-read scripts/mcp-eval/run.ts
//
// Phase A (always): deterministic protocol + tool-shape smoke tests against
// the live server — initialize, tools/list, and a battery of tools/call
// invariants (coverage signals present, measured periods present, values in
// range, shares-first payloads, no raw dates, no calendar hedging). Uses
// whichever org the PAT is scoped to; picks its busiest company.
//
// Phase B (only when ANTHROPIC_API_KEY is set): tool-selection eval — for
// each golden question in questions.json, asks a small model to pick the
// first tool given our tools/list, and scores it against expect_any.
// This is the regression net for tool descriptions: if a description edit
// makes the model stop reaching for get_attribute_themes on "culture in
// India", this fails loudly before any client sees it.

const MCP_URL = Deno.env.get('MCP_URL') || '';
const MCP_TOKEN = Deno.env.get('MCP_TOKEN') || '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';

if (!MCP_URL || !MCP_TOKEN) {
  console.error('Set MCP_URL and MCP_TOKEN (an org-scoped PAT from mcp_create_api_key).');
  Deno.exit(1);
}

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

let rpcId = 0;
async function rpc(method: string, params?: Record<string, unknown>): Promise<any> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MCP_TOKEN}`,
      'MCP-Protocol-Version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params: params ?? {} }),
  });
  if (!res.ok) throw new Error(`${method} → HTTP ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method} → RPC error ${body.error.code}: ${body.error.message}`);
  return body.result;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<any> {
  const result = await rpc('tools/call', { name, arguments: args });
  const text = result?.content?.[0]?.text ?? '{}';
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* leave empty */ }
  return { result, parsed };
}

// ─── Phase A: protocol + tool invariants ────────────────────────────────────
console.log('\n━━ Phase A: protocol + tool smoke tests ━━');

const init = await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'px-mcp-eval', version: '1.0' },
});
check('initialize returns protocolVersion', typeof init.protocolVersion === 'string');
check('initialize returns instructions', typeof init.instructions === 'string' && init.instructions.includes('_coverage'));
check('instructions carry the measured-period rule', String(init.instructions).includes('never describe it as missing'));
check('instructions carry the shares-first rule', String(init.instructions).includes('sample_size'));
check('serverInfo.name = perceptionx', init.serverInfo?.name === 'perceptionx');

const toolsList = await rpc('tools/list');
const toolNames: string[] = (toolsList.tools || []).map((t: any) => t.name);
check('tools/list returns 16 tools', toolNames.length === 16, `got ${toolNames.length}`);
for (const required of ['list_companies', 'get_attribute_themes', 'get_visibility', 'get_sources', 'get_competitor_landscape', 'get_trends']) {
  check(`tool present: ${required}`, toolNames.includes(required));
}
// ChatGPT plugin guidelines: read-only annotations on every tool.
check('all tools annotated read-only + closed-world', (toolsList.tools || []).every((t: any) =>
  t.annotations?.readOnlyHint === true && t.annotations?.openWorldHint === false));
check('no tool description mentions excluded models', !(toolsList.tools || []).some((t: any) =>
  /\b(claude|gemini|deepseek)\b/i.test(String(t.description))));

// ─── Presentation contract ──────────────────────────────────────────────────
// Quarters + percentages; no raw dates or decimals in numeric payloads; no
// "(in progress)" hedge unless the server says a collection is in flight;
// every measured period listed and the range bounded by data; raw counts
// never lead — inside list entries the only bare numbers are shares/points.
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
const QUARTER = /^Q[1-4] \d{4}( \(in progress\))?$/;
// Share-shaped keys: "..._pct", "..._pct_of_answers", "..._points",
// "..._per_answer", and the EPS composite. Anything else numeric inside a
// list entry is a raw count and must live under sample_size.
const SHARE_KEY = /(_pct(_|$)|_points$|_per_answer$|^eps$)/;
const SERIES_KEYS = new Set(['by_job_function', 'top_pages', 'quarterly', 'series', 'sources', 'competitors', 'attributes', 'attribute_summary', 'top_attributes', 'top_themes', 'top_competitors', 'top_sources', 'citations', 'themes', 'model_breakdown', 'by_platform', 'share_of_voice', 'comparison']);

function rawCountLeaks(payload: any, path = '$', out: string[] = []): string[] {
  if (Array.isArray(payload)) { payload.forEach((v, i) => rawCountLeaks(v, `${path}[${i}]`, out)); return out; }
  if (!payload || typeof payload !== 'object') return out;
  for (const [k, v] of Object.entries(payload)) {
    if (k === 'sample_size' || k === '_coverage' || k === '_meta') continue;
    if (SERIES_KEYS.has(k) && Array.isArray(v)) {
      v.forEach((entry: any, i: number) => {
        if (!entry || typeof entry !== 'object') return;
        for (const [ek, ev] of Object.entries(entry)) {
          if (typeof ev === 'number' && !SHARE_KEY.test(ek)) out.push(`${path}.${k}[${i}].${ek}`);
        }
      });
    }
    rawCountLeaks(v, `${path}.${k}`, out);
  }
  return out;
}

function checkPresentation(name: string, payload: unknown) {
  const p: any = payload;
  const text = JSON.stringify(payload);
  const sansUrls = JSON.stringify(payload, (k, v) => (k === 'url' ? undefined : v));   // page URLs may legitimately carry dates
  check(`${name}: no raw ISO dates in payload`, !ISO_DATE.test(sansUrls), sansUrls.match(ISO_DATE)?.[0] ?? '');
  const leaks = rawCountLeaks(payload);
  check(`${name}: raw counts nest under sample_size`, leaks.length === 0, leaks.slice(0, 3).join(', '));
  if (p?._meta?.collection_in_progress !== true) {
    check(`${name}: no "(in progress)" hedge while no collection is running`, !text.includes('(in progress)'));
  }
  if (p?._meta?.periods) {
    check(`${name}: _meta.periods are quarter labels`, p._meta.periods.every((q: string) => QUARTER.test(q)));
    check(`${name}: period_range is bounded by measured data`,
      p._meta.period_range?.from === p._meta.periods[0] && p._meta.period_range?.to === p._meta.periods[p._meta.periods.length - 1]);
    check(`${name}: methodology states unlisted periods are not gaps`,
      (p._meta.methodology || []).some((m: string) => m.includes('not missing data')));
  }
}

const { parsed: companies } = await callTool('list_companies', {});
check('list_companies has _coverage', !!companies._coverage);
check('list_companies carries latest_period per profile', (companies.companies || []).every((c: any) => 'latest_period' in c && 'measured_periods' in c));
checkPresentation('list_companies', companies);
const busiest = (companies.companies || []).sort((a: any, b: any) => b.total_responses - a.total_responses)[0];
check('org has at least one company with data', !!busiest && busiest.total_responses > 0,
  JSON.stringify(companies).slice(0, 200));

if (busiest) {
  const cid = busiest.id;

  const { parsed: vis } = await callTool('get_visibility', { company_id: cid, quarters_back: 4 });
  check('get_visibility has _coverage + _meta', !!vis._coverage && !!vis._meta);
  if (vis._coverage?.status === 'found') {
    check('visibility_pct in [0,100]', vis.visibility_pct >= 0 && vis.visibility_pct <= 100, String(vis.visibility_pct));
    check('visibility quarterly series non-empty', Array.isArray(vis.quarterly) && vis.quarterly.length > 0);
    check('quarter labels look like "Qn YYYY"', (vis.quarterly || []).every((q: any) => QUARTER.test(q.quarter)));
    check('visibility entries lead with visibility_pct', (vis.quarterly || []).every((q: any) => Object.keys(q)[1] === 'visibility_pct'));
    check('visibility change is vs the previous measured period',
      vis.quarterly.length < 2 || (vis.change && typeof vis.change.delta_points_vs_previous === 'number' && vis.change.previous_period === vis.quarterly[vis.quarterly.length - 2].quarter));
    checkPresentation('get_visibility', vis);
  }

  const { parsed: attrs } = await callTool('get_attribute_themes', { company_id: cid, quarters_back: 4 });
  check('get_attribute_themes has _coverage + _meta', !!attrs._coverage && !!attrs._meta);
  if (attrs._coverage?.status === 'found') {
    check('attributes ranked non-empty', Array.isArray(attrs.attributes) && attrs.attributes.length > 0);
    check('attributes lead with % of answers', (attrs.attributes || []).every((a: any) => 'mentioned_in_pct_of_answers' in a && Object.keys(a)[2] === 'mentioned_in_pct_of_answers'));
    const pcts = (attrs.attributes || []).map((a: any) => a.positive_sentiment_pct).filter((x: any) => x !== null);
    check('sentiment values are integer percentages [0,100]',
      pcts.every((x: number) => Number.isInteger(x) && x >= 0 && x <= 100));
    check('no retired attribute ids surface', !(attrs.attributes || []).some((a: any) => a.attribute_id === 'overall-candidate-experience'));
    checkPresentation('get_attribute_themes', attrs);
  }

  const { parsed: focus } = await callTool('get_attribute_themes', { company_id: cid, attribute_id: 'pay', quarters_back: 4 });
  check("alias 'pay' resolves to compensation", focus.focus_attribute === 'compensation' || focus._coverage?.status === 'no_data');
  if (focus._coverage?.status === 'found') {
    check('focused attribute returns example_themes', Array.isArray(focus.example_themes));
    check('focused attribute returns the sources in those answers',
      Array.isArray(focus.sources_in_attribute_answers?.sources) && String(focus.sources_in_attribute_answers?.note || '').includes('not cause'));
    check('source breakdown is populated (not a silent timeout)',
      (focus.sources_in_attribute_answers?.sources || []).length > 0 || (focus.sources_in_attribute_answers?.sample_size?.answers_sampled ?? 0) === 0,
      String(focus.sources_in_attribute_answers?.note || ''));
    const attrSources = focus.sources_in_attribute_answers?.sources || [];
    check('attribute sources carry top_pages to link',
      attrSources.every((s: any) => Array.isArray(s.top_pages)) && (attrSources.length === 0 || attrSources.some((s: any) => s.top_pages.length > 0)));
    checkPresentation('get_attribute_themes/focus', focus);
  }

  const { parsed: badAttr } = await callTool('get_attribute_themes', { company_id: cid, attribute_id: 'nonsense-attribute' });
  check('unknown attribute → recoverable error listing valid ids', typeof badAttr.error === 'string' && badAttr.error.includes('compensation'));

  const { parsed: badLoc } = await callTool('get_visibility', { company_id: cid, location: 'Atlantis' });
  check('unknown market → no_data with available_markets', badLoc._coverage?.status === 'no_data' && Array.isArray(badLoc._coverage?.available_markets));

  const { parsed: badFn } = await callTool('get_visibility', { company_id: cid, job_function: 'Astronaut Corps' });
  check('unknown job function → no_data with available_job_functions', badFn._coverage?.status === 'no_data' && Array.isArray(badFn._coverage?.available_job_functions));
  const fn = badFn._coverage?.available_job_functions?.[0];
  if (fn) {
    const { parsed: fnVis } = await callTool('get_visibility', { company_id: cid, job_function: fn, quarters_back: 4 });
    check('job function filter applies and is echoed in _meta',
      fnVis._coverage?.status === 'found' && Array.isArray(fnVis._meta?.job_functions_matched) && fnVis._meta.job_functions_matched.includes(fn),
      String(fnVis._coverage?.reason || fnVis.error || ''));
    if (fnVis._coverage?.status === 'found') checkPresentation('get_visibility/job_function', fnVis);
    const { parsed: fnSplit } = await callTool('get_visibility', { company_id: cid, by_job_function: true, quarters_back: 4 });
    check('by_job_function splits visibility, share-first',
      Array.isArray(fnSplit.by_job_function) && fnSplit.by_job_function.length > 0 && fnSplit.by_job_function.every((x: any) => Object.keys(x)[1] === 'visibility_pct'));
    const { parsed: fnAttr } = await callTool('get_attribute_themes', { company_id: cid, attribute_id: 'pay', by_job_function: true, quarters_back: 4 });
    check('by_job_function splits an attribute',
      fnAttr._coverage?.status !== 'found' || (fnAttr.attributes || []).every((a: any) => Array.isArray(a.by_job_function) && a.by_job_function.length > 0));
    if (fnAttr._coverage?.status === 'found') checkPresentation('get_attribute_themes/by_job_function', fnAttr);
    const { parsed: fnSrc } = await callTool('get_sources', { company_id: cid, job_function: fn, quarters_back: 1, limit: 5 });
    check('sources honor the job function filter and state the page sample',
      fnSrc._coverage?.status !== 'found' || ((fnSrc.sources || []).length > 0 && (fnSrc.sample_size?.answers_sampled_for_pages ?? 0) > 0),
      String(fnSrc._coverage?.reason || fnSrc.error || ''));
    if (fnSrc._coverage?.status === 'found') checkPresentation('get_sources/job_function', fnSrc);
  }

  const { parsed: sources } = await callTool('get_sources', { company_id: cid, quarters_back: 4, limit: 10 });
  check('get_sources has _coverage + _meta', !!sources._coverage && !!sources._meta);
  if (sources._coverage?.status === 'found') {
    check('sources lead with share of answers', (sources.sources || []).every((s: any) => Object.keys(s)[1] === 'cited_in_pct_of_answers'));
    check('sources carry the answer gap as a share', (sources.sources || []).every((s: any) => 'answer_gap_pct_of_answers' in s));
    const pages = (sources.sources || []).flatMap((s: any) => s.top_pages || []);
    check('every source carries top_pages', (sources.sources || []).every((s: any) => Array.isArray(s.top_pages)));
    check('top pages are real links, share-first (page read did not fail)',
      pages.length > 0 && pages.every((p: any) => /^https?:\/\//.test(p.url) && Object.keys(p)[2] === 'cited_in_pct_of_answers'),
      String(sources._coverage?.pages_note || pages.length));
    check('page titles are clean', pages.every((p: any) => !String(p.title || '').includes('Opens in new tab') && !/^https?:/.test(String(p.title || ''))));
    check('page shares never exceed their domain share (one denominator)',
      (sources.sources || []).every((s: any) => (s.top_pages || []).every((p: any) => p.cited_in_pct_of_answers <= s.cited_in_pct_of_answers)));
    checkPresentation('get_sources', sources);
  }

  const topDomain = sources.sources?.[0]?.domain;
  if (topDomain) {
    const { parsed: cit } = await callTool('get_citations', { company_id: cid, domain_filter: topDomain });
    check('get_citations(domain_filter) returns that domain with its pages',
      Array.isArray(cit.citations) && cit.citations.length > 0 && (cit.citations[0].top_pages || []).length > 0,
      String(cit.error || cit._coverage?.pages_note || ''));
    check('citation rows lead with share of answers', (cit.citations || []).every((c: any) => Object.keys(c)[1] === 'cited_in_pct_of_answers'));
    checkPresentation('get_citations', cit);
  }

  const { parsed: comp } = await callTool('get_competitor_landscape', { company_id: cid, attribute_id: 'compensation', quarters_back: 4 });
  check('get_competitor_landscape has _coverage', !!comp._coverage);
  if (comp.attribute_lens) {
    check('attribute lens carries SOV-not-sentiment note', String(comp.attribute_lens.note || '').includes('not competitor sentiment'));
    check('attribute lens carries sentiment-accrual note', String(comp.attribute_lens.competitor_sentiment_note || '').length > 0);
  }
  if (comp._coverage?.status !== 'no_data') checkPresentation('get_competitor_landscape', comp);

  const { parsed: trend } = await callTool('get_trends', { company_id: cid, metric: 'sentiment', quarters_back: 6 });
  check('get_trends has quarterly series', Array.isArray(trend.series) || trend._coverage?.status === 'no_data');
  if (Array.isArray(trend.series) && trend.series.length) {
    check('trend values are integer percentages',
      trend.series.every((s: any) => s.positive_sentiment_pct === null || Number.isInteger(s.positive_sentiment_pct)));
    check('trend change names the previous measured period',
      trend.series.length < 2 || trend.change?.previous_period === trend.series[trend.series.length - 2].quarter);
    checkPresentation('get_trends', trend);
  }

  const { parsed: metrics } = await callTool('get_company_metrics', { company_id: cid });
  check('get_company_metrics has _coverage + _meta', !!metrics._coverage && !!metrics._meta);
  if (metrics._coverage?.status === 'found') {
    check('metrics are for one measured period', QUARTER.test(String(metrics.period)) && metrics._meta.periods?.length === 1);
    check('relevance is scored when citations were scored',
      (metrics.sample_size?.scored_citations || 0) === 0 || (Number.isInteger(metrics.relevance_pct) && metrics.relevance_pct > 0));
    check('EPS = 50/30/20 of the reported components',
      Math.abs(metrics.eps - Math.round((metrics.positive_sentiment_pct ?? 50) * 0.5 + (metrics.visibility_pct ?? 0) * 0.3 + (metrics.relevance_pct ?? 0) * 0.2)) <= 1);
    checkPresentation('get_company_metrics', metrics);
  }

  const { parsed: overview } = await callTool('get_company_overview', { company_id: cid });
  check('get_company_overview has _coverage + _meta', !!overview._coverage && !!overview._meta);
  if (overview._coverage?.status === 'found') {
    check('overview attributes lead with % of answers', (overview.top_attributes || []).every((a: any) => 'mentioned_in_pct_of_answers' in a));
    check('overview competitors and sources are shares',
      (overview.top_competitors || []).every((c: any) => 'named_in_pct_of_answers' in c) &&
      (overview.top_sources || []).every((s: any) => 'cited_in_pct_of_answers' in s));
    checkPresentation('get_company_overview', overview);
  }

  // The three tools that read theme rows: they must come back complete
  // within the statement budget on a brand-wide scope (a timeout used to
  // surface as a tool error here and as silently empty themes elsewhere).
  check('overview carries top themes (theme read did not time out)',
    !overview.error && (overview.top_themes || []).length > 0 && !overview._coverage?.themes_note,
    String(overview._coverage?.themes_note || overview.error || ''));

  const { parsed: themes } = await callTool('get_themes', { company_id: cid });
  check('get_themes returns without error', !themes.error, String(themes.error || ''));
  if (themes._coverage?.status === 'found') {
    check('themes non-empty', (themes.themes || []).length > 0);
    check('themes lead with % of answers', (themes.themes || []).every((t: any) => Object.keys(t)[1] === 'mentioned_in_pct_of_answers'));
    check('themes state their sample', (themes.sample_size?.answers_sampled_for_themes ?? 0) > 0);
    checkPresentation('get_themes', themes);
  }

  const { parsed: models } = await callTool('get_model_breakdown', { company_id: cid });
  check('get_model_breakdown returns without error', !models.error, String(models.error || ''));
  if (models._coverage?.status === 'found') {
    check('platform rows carry visibility_pct + positive_sentiment_pct',
      (models.model_breakdown || []).every((m: any) => 'visibility_pct' in m && 'positive_sentiment_pct' in m));
    check('per-platform sentiment is populated (theme read did not time out)',
      (models.model_breakdown || []).some((m: any) => Number.isInteger(m.positive_sentiment_pct)) && !models._coverage?.sentiment_note,
      String(models._coverage?.sentiment_note || ''));
    checkPresentation('get_model_breakdown', models);
  }

  // Tenant isolation: a foreign UUID must be rejected, never resolved.
  const { parsed: foreign } = await callTool('get_visibility', { company_id: '00000000-0000-4000-8000-000000000000' });
  check('foreign company_id rejected', typeof foreign.error === 'string' && foreign.error.toLowerCase().includes('not in your organization') || typeof foreign.error === 'string');
}

// ─── Phase B: tool-selection eval (optional) ────────────────────────────────
if (ANTHROPIC_API_KEY) {
  console.log('\n━━ Phase B: tool-selection eval (claude-haiku-4-5) ━━');
  const questionsPath = new URL('./questions.json', import.meta.url).pathname;
  const { questions } = JSON.parse(await Deno.readTextFile(questionsPath));
  const anthropicTools = (toolsList.tools || []).map((t: any) => ({
    name: t.name, description: t.description, input_schema: t.inputSchema,
  }));

  let hits = 0;
  for (const { q, expect_any } of questions) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        tools: anthropicTools,
        tool_choice: { type: 'any' },
        system: 'You answer employer-brand data questions by calling tools. The user\'s company id is 11111111-1111-4111-8111-111111111111 (already known). Pick the single best tool for the question.',
        messages: [{ role: 'user', content: q }],
      }),
    });
    const body = await res.json();
    const chosen = (body.content || []).find((b: any) => b.type === 'tool_use')?.name || '(none)';
    const ok = expect_any.includes(chosen);
    if (ok) hits++;
    console.log(`  ${ok ? '✓' : '✗'} "${q}" → ${chosen}${ok ? '' : ` (expected one of: ${expect_any.join(', ')})`}`);
  }
  const score = Math.round((hits / questions.length) * 100);
  console.log(`\n  Tool-selection score: ${hits}/${questions.length} (${score}%)`);
  check('tool-selection score ≥ 80%', score >= 80, `${score}%`);
} else {
  console.log('\n(Phase B skipped — set ANTHROPIC_API_KEY to run the tool-selection eval.)');
}

console.log(`\n━━ Result: ${passed} passed, ${failed} failed ━━`);
Deno.exit(failed > 0 ? 1 : 0);
