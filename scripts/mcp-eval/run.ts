// MCP server eval — run against a deployed mcp-server with an org PAT.
//
//   MCP_URL=https://<ref>.supabase.co/functions/v1/mcp-server \
//   MCP_TOKEN=pxk_... \
//   deno run --allow-net --allow-env --allow-read scripts/mcp-eval/run.ts
//
// Phase A (always): deterministic protocol + tool-shape smoke tests against
// the live server — initialize, tools/list, and a battery of tools/call
// invariants (coverage signals present, _meta freshness present, values in
// range). Uses whichever org the PAT is scoped to; picks its busiest company.
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
check('serverInfo.name = perceptionx', init.serverInfo?.name === 'perceptionx');

const toolsList = await rpc('tools/list');
const toolNames: string[] = (toolsList.tools || []).map((t: any) => t.name);
check('tools/list returns 16 tools', toolNames.length === 16, `got ${toolNames.length}`);
for (const required of ['list_companies', 'get_attribute_themes', 'get_visibility', 'get_sources', 'get_competitor_landscape', 'get_trends']) {
  check(`tool present: ${required}`, toolNames.includes(required));
}

const { parsed: companies } = await callTool('list_companies', {});
check('list_companies has _coverage', !!companies._coverage);
const busiest = (companies.companies || []).sort((a: any, b: any) => b.total_responses - a.total_responses)[0];
check('org has at least one company with data', !!busiest && busiest.total_responses > 0,
  JSON.stringify(companies).slice(0, 200));

if (busiest) {
  const cid = busiest.id;

  const { parsed: vis } = await callTool('get_visibility', { company_id: cid, months_back: 6 });
  check('get_visibility has _coverage + _meta', !!vis._coverage && !!vis._meta);
  if (vis._coverage?.status === 'found') {
    check('visibility_pct in [0,100]', vis.visibility_pct >= 0 && vis.visibility_pct <= 100, String(vis.visibility_pct));
    check('visibility monthly series non-empty', Array.isArray(vis.monthly) && vis.monthly.length > 0);
    check('data_as_of present', !!vis._meta?.data_as_of);
  }

  const { parsed: attrs } = await callTool('get_attribute_themes', { company_id: cid, months_back: 6 });
  check('get_attribute_themes has _coverage + _meta', !!attrs._coverage && !!attrs._meta);
  if (attrs._coverage?.status === 'found') {
    check('attributes ranked non-empty', Array.isArray(attrs.attributes) && attrs.attributes.length > 0);
    const ratios = (attrs.attributes || []).map((a: any) => a.sentiment_ratio).filter((x: any) => x !== null);
    check('sentiment ratios in [0,1]', ratios.every((x: number) => x >= 0 && x <= 1));
  }

  const { parsed: focus } = await callTool('get_attribute_themes', { company_id: cid, attribute_id: 'company-culture', months_back: 6 });
  if (focus._coverage?.status === 'found') {
    check('focused attribute returns example_themes', Array.isArray(focus.example_themes));
  }

  const { parsed: badAttr } = await callTool('get_attribute_themes', { company_id: cid, attribute_id: 'nonsense-attribute' });
  check('unknown attribute → recoverable error listing valid ids', typeof badAttr.error === 'string' && badAttr.error.includes('compensation'));

  const { parsed: badLoc } = await callTool('get_visibility', { company_id: cid, location: 'Atlantis' });
  check('unknown market → no_data with available_markets', badLoc._coverage?.status === 'no_data' && Array.isArray(badLoc._coverage?.available_markets));

  const { parsed: sources } = await callTool('get_sources', { company_id: cid, months_back: 6, limit: 10 });
  check('get_sources has _coverage + _meta', !!sources._coverage && !!sources._meta);
  if (sources._coverage?.status === 'found') {
    check('sources have answer_gap fields', (sources.sources || []).every((s: any) => typeof s.answer_gap === 'number'));
  }

  const { parsed: comp } = await callTool('get_competitor_landscape', { company_id: cid, attribute_id: 'compensation', months_back: 6 });
  check('get_competitor_landscape has _coverage', !!comp._coverage);
  if (comp.attribute_lens) {
    check('attribute lens carries SOV-not-sentiment note', String(comp.attribute_lens.note || '').includes('not competitor sentiment'));
    check('attribute lens carries sentiment-accrual note', String(comp.attribute_lens.competitor_sentiment_note || '').length > 0);
  }

  const { parsed: trend } = await callTool('get_trends', { company_id: cid, metric: 'sentiment', months_back: 12 });
  check('get_trends has series', Array.isArray(trend.series) || trend._coverage?.status === 'no_data');

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
