// Offline tests for get_report_actions, run with:
//   cd supabase/functions && deno test _shared/px-tools/report_actions_test.ts
//
// Two organizations, each with a published snapshot, published actions and a
// draft. Pins the guardrails the client knowledge base depends on:
//   * an organization only ever sees its own published rows, even if the
//     database ignored the organization filter (the in-code second check);
//   * drafts never appear;
//   * every item carries its cycle and the report's as-of date, in words;
//   * provisional metrics are marked provisional;
//   * the model cannot pick the organization through tool input;
//   * actions go by title: no number, timing or owner in the payload, steps
//     returned as stored, newest cycle first then title (2026-10-27);
//   * the market filter keeps Global actions and expands world regions
//     (the bug before 2026-10-27 dropped Global whenever a market was asked);
//   * priority (High, Medium, Low, with its reason) rides along, High first,
//     and the register's timing never reaches the chat.

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { anthropicTools, executeTool, mcpTools } from './mod.ts';
import { actionMatchesMarket, dateInWords } from './executors-report.ts';
import type { ToolContext } from './scope.ts';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORG_EMPTY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PUBLISHED = '2026-10-14T07:40:00Z';
const STEPS = [
  { label: 'Add the stages and typical timing to the interview guide', url: 'https://example.com/interview-guide' },
  { label: 'Say when candidates hear back', url: null },
];

const tables: Record<string, any[]> = {
  client_report_snapshots: [
    {
      organization_id: ORG_A, cycle: '2026-09-01', period_label: 'Q3 2026', report_type: 'baseline',
      scope: { assistants: ['ChatGPT', 'DeepSeek'], assistant_notes: 'DeepSeek is included for this client only.' },
      headline: { overall_score: 68, sentiment_pct: 62, visibility_pct: 68, relevance: 85 },
      metric_status: {
        visibility: { status: 'final', since: '2026-10-13', reason: 'Brand aliases applied.' },
        sentiment: { status: 'provisional', reason: 'Themes are not yet on one classifier version.' },
      },
      breakdowns: { visibility_by_market: [{ market: 'Germany', pct: 38, rank: 4 }] },
      as_of: '2026-10-13', source_report_name: 'Org A Q3 2026 baseline', published_at: PUBLISHED,
    },
    {
      organization_id: ORG_A, cycle: '2026-12-01', period_label: 'Q4 2026', report_type: 'quarterly',
      scope: {}, headline: { sentiment_pct: 99 }, metric_status: {}, breakdowns: {},
      as_of: '2027-01-10', source_report_name: 'DRAFT A Q4', published_at: null,
    },
    {
      organization_id: ORG_B, cycle: '2026-09-01', period_label: 'Q3 2026', report_type: 'quarterly',
      scope: {}, headline: { overall_score: 71, sentiment_pct: 70 }, metric_status: {}, breakdowns: {},
      as_of: '2026-10-01', source_report_name: 'Org B secret report', published_at: PUBLISHED,
    },
  ],
  company_actions: [
    action(ORG_A, 'a2', 2, 'act_now', 'Put Singapore pay facts where AI reads them', ['Singapore'], 'medium', 'Pay holds 9% of the negative opinions in Singapore.'),
    action(ORG_A, 'a1', 1, 'act_now', 'Add response times to the German interview guide page', ['Germany'], 'high', 'Application and communication holds 24% of the negative opinions in Germany and the page is Org A\'s own.'),
    action(ORG_A, 'ag', 4, 'act_now', 'Publish how hiring works on postings and the FAQ', ['Global'], 'high', 'The hiring topics hold 22% of the negative opinions.'),
    // Unlabelled and raised a cycle later: sorts after the labelled ones,
    // but before older unlabelled ones.
    { ...action(ORG_A, 'anew', null, 'regional', 'Zero in on the Hungary profession.hu page', ['Hungary']), cycle_raised: '2026-12-01' },
    action(ORG_A, 'a4', 5, 'act_now', 'Zero-label legacy action', ['Germany', 'France']),
    action(ORG_A, 'aw', null, 'watch', 'Take the QA test site out of reach', []),
    { ...action(ORG_A, 'adraft', 9, 'act_now', 'DRAFT A action', ['Germany']), published_at: null },
    { ...action(ORG_A, 'aret', 8, 'retired', 'Retired A action', ['Germany']), tracking_status: 'retired' },
    action(ORG_B, 'b1', 1, 'act_now', 'Org B secret action', ['Germany']),
  ],
  company_action_checks: [
    { action_id: 'a1', organization_id: ORG_A, cycle: '2026-09-01', checked_on: '2026-10-14', status: 'open',
      metric_readings: [{ metric: 'Sentiment', attribute: 'Application and Communication', market: 'Germany', value_pct: 24, metric_status: 'provisional' }], note: 'Baseline.' },
    { action_id: 'b1', organization_id: ORG_B, cycle: '2026-09-01', checked_on: '2026-10-02', status: 'stalled', metric_readings: [], note: 'Org B secret check' },
  ],
};

function action(org: string, id: string, n: number | null, register: string, title: string, markets: string[], priority: string | null = null, priorityReason: string | null = null) {
  return {
    id, organization_id: org, key: `2026-09-01:${id}`, register, title, cycle_raised: '2026-09-01', action_number: n,
    problem: `${title}: problem`, ai_says: 'What AI says.', ai_reads: [{ source: 'kununu', market: 'Germany', coverage_pct: 65 }],
    urls: ['https://example.com/page'], recommendation: 'What to do.', steps: STEPS, lanes: ['owned', 'people'], timing: 'act_next',
    priority, priority_reason: priorityReason,
    lifts: [{ metric: 'Sentiment' }], proof_status: null,
    verified_facts: [{ fact: 'Page lists four stages.', checked_on: '2026-10-12' }],
    owner_name: 'Someone at the client', tracking_status: 'open', work_status: 'open', markets, functions: [], notes: null, published_at: PUBLISHED,
  };
}

// PostgREST stand-in. `honourOrgFilter: false` simulates a query that lost
// its organization filter, to prove the in-code second check holds.
class FakeQuery {
  constructor(private rows: any[], private honourOrgFilter: boolean) {}
  select() { return this; }
  order() { return this; }
  not(col: string, op: string, v: any) {
    if (op === 'is' && v === null) this.rows = this.rows.filter(r => r[col] != null);
    return this;
  }
  eq(col: string, v: any) {
    if (col === 'organization_id' && !this.honourOrgFilter) return this;
    this.rows = this.rows.filter(r => r[col] === v); return this;
  }
  in(col: string, vs: any[]) { this.rows = this.rows.filter(r => vs.includes(r[col])); return this; }
  then(res: any, rej?: any) { return Promise.resolve({ data: this.rows, error: null }).then(res, rej); }
}

function ctxFor(org: string, honourOrgFilter = true): ToolContext {
  const admin = {
    from: (table: string) => new FakeQuery([...(tables[table] || [])], honourOrgFilter),
    rpc: () => Promise.resolve({ data: null, error: { message: 'no rpc in this test' } }),
  };
  return { admin, organizationId: org, requestId: 'test' };
}
const call = async (ctx: ToolContext, input: any = {}) => JSON.parse(await executeTool(ctx, 'get_report_actions', input));
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/;
const titles = (p: any) => p.actions.map((a: any) => a.title);

Deno.test('own organization: snapshot, actions by title, watch items, cited with period and as-of date', async () => {
  const p = await call(ctxFor(ORG_A));
  assertEquals(p._coverage.status, 'found');
  assertEquals(p.report.report, 'Q3 2026 baseline');
  assertEquals(p.report.as_of, '13 Oct 2026');
  assertEquals(p._meta.cite_as, 'Q3 2026 baseline, as of 13 Oct 2026');
  assertEquals(p.report.headline.sentiment_pct, 62);
  assertEquals(p.report.metric_status.sentiment.status, 'provisional');
  assertEquals(p.report.metric_status.visibility.since, '13 Oct 2026');
  // High first (newest cycle, then title within a label), then Medium,
  // then unlabelled.
  assertEquals(titles(p), [
    'Add response times to the German interview guide page',
    'Publish how hiring works on postings and the FAQ',
    'Put Singapore pay facts where AI reads them',
    'Zero in on the Hungary profession.hu page',
    'Zero-label legacy action',
  ]);
  const german = p.actions[0];
  assertEquals(german.priority, 'High');
  assertStringIncludes(german.priority_reason, '24% of the negative opinions in Germany');
  assertEquals(p.actions[2].priority, 'Medium');
  assertEquals(p.actions[3].priority, null);
  assertEquals(p.actions[3].priority_reason, null);
  assertStringIncludes(p._meta.methodology.join(' '), 'not timing');
  assertEquals(german.raised_in, 'Q3 2026');
  assertEquals(german.lanes, ['Owned', 'People']);
  assertEquals(german.steps, STEPS);
  assertEquals(german.verified_facts[0].checked_on, '12 Oct 2026');
  assertEquals(german.latest_check.metric_readings[0].metric_status, 'provisional');
  assertEquals(german.latest_check.checked_on, '14 Oct 2026');
  assertEquals(p.watch_items.map((w: any) => w.title), ['Take the QA test site out of reach']);
  assert(!ISO_DATE.test(JSON.stringify(p.actions)), 'action dates are in words');
  assertStringIncludes(p._meta.methodology.join(' '), 'provisional');
  assertStringIncludes(p._meta.methodology.join(' '), 'by their title');
});

Deno.test('actions carry no number, timing or owner', async () => {
  const p = await call(ctxFor(ORG_A));
  for (const a of [...p.actions, ...p.watch_items]) {
    for (const gone of ['number', 'timing', 'owner']) assert(!(gone in a), `${gone} still in the action payload`);
    assert(Array.isArray(a.steps));
  }
  const text = JSON.stringify(p);
  assert(!/act (now|next|later)/i.test(text), 'no act now / next / later wording');
  assert(!text.includes('Someone at the client'), 'no owner name');
});

Deno.test('drafts and retired actions never appear', async () => {
  const text = await executeTool(ctxFor(ORG_A), 'get_report_actions', {});
  assert(!text.includes('DRAFT'), 'no draft snapshot or action');
  assert(!text.includes('Retired A action'));
});

Deno.test('another organization cannot see this content, and sees only its own', async () => {
  const text = await executeTool(ctxFor(ORG_B), 'get_report_actions', {});
  for (const leaked of ['Org A', 'German interview guide', 'Singapore pay', 'QA test site', 'DeepSeek is included']) {
    assert(!text.includes(leaked), `org B payload leaked "${leaked}"`);
  }
  const p = JSON.parse(text);
  assertEquals(p.report.source_report_name, 'Org B secret report');
  assertEquals(titles(p), ['Org B secret action']);
  assertEquals(p.actions[0].latest_check.status, 'stalled');
});

Deno.test('isolation holds even if the database ignored the organization filter', async () => {
  const a = await executeTool(ctxFor(ORG_A, false), 'get_report_actions', {});
  assert(!a.includes('Org B secret'), 'org A never sees org B rows');
  const b = await executeTool(ctxFor(ORG_B, false), 'get_report_actions', {});
  for (const leaked of ['Org A', 'German interview guide', 'QA test site']) assert(!b.includes(leaked), `leaked "${leaked}"`);
});

Deno.test('the model cannot choose the organization through tool input', async () => {
  const text = await executeTool(ctxFor(ORG_B), 'get_report_actions', { organization_id: ORG_A, organizationId: ORG_A });
  assert(!text.includes('German interview guide'));
  assertStringIncludes(text, 'Org B secret action');
});

Deno.test('organization with nothing published gets no_data, not another organization\'s report', async () => {
  const p = await call(ctxFor(ORG_EMPTY));
  assertEquals(p._coverage.status, 'no_data');
  assertEquals(p.report, null);
  assertEquals(p.actions, []);
});

Deno.test('market filter: that market plus Global and organization-wide items; regions expand', async () => {
  const de = await call(ctxFor(ORG_A), { market: 'germany' });
  assertEquals(titles(de), [
    'Add response times to the German interview guide page',
    'Publish how hiring works on postings and the FAQ',
    'Zero-label legacy action',
  ]);
  assertEquals(de.watch_items.length, 1);
  const code = await call(ctxFor(ORG_A), { market: 'DE', include: 'actions' });
  assertEquals(titles(code), titles(de));
  const europe = await call(ctxFor(ORG_A), { market: 'Europe', include: 'actions' });
  assertEquals(titles(europe), [
    'Add response times to the German interview guide page',
    'Publish how hiring works on postings and the FAQ',
    'Zero in on the Hungary profession.hu page',
    'Zero-label legacy action',
  ]);
  const apac = await call(ctxFor(ORG_A), { market: 'APAC', include: 'actions' });
  assertEquals(titles(apac), [
    'Publish how hiring works on postings and the FAQ',
    'Put Singapore pay facts where AI reads them',
  ]);
  // A market with nothing of its own still gets the Global actions.
  const jp = await call(ctxFor(ORG_A), { market: 'Japan', include: 'actions' });
  assertEquals(titles(jp), ['Publish how hiring works on postings and the FAQ']);
  const global = await call(ctxFor(ORG_A), { market: 'Global', include: 'actions' });
  assertEquals(titles(global), ['Publish how hiring works on postings and the FAQ']);
  // ISO code spellings resolve to the same country.
  assert(actionMatchesMarket(['Germany'], 'DE'));
  assert(!actionMatchesMarket(['Germany'], 'France'));
  assert(actionMatchesMarket(['Global'], 'France'));
  assert(actionMatchesMarket([], 'France'));
  assert(actionMatchesMarket(['Canada'], 'north america'));
  assert(!actionMatchesMarket(['Canada'], 'europe'));
  assert(actionMatchesMarket(['Mexico'], 'latam'));
  assert(actionMatchesMarket(['Mexico'], undefined));
});

Deno.test('action filter: by title, case-insensitive, exact before contains; old action_number still honoured', async () => {
  const one = await call(ctxFor(ORG_A), { action: 'singapore', include: 'actions' });
  assertEquals(titles(one), ['Put Singapore pay facts where AI reads them']);
  assertEquals(one.report, undefined);
  const exact = await call(ctxFor(ORG_A), { action: 'publish how hiring works on postings and the faq', include: 'actions' });
  assertEquals(titles(exact), ['Publish how hiring works on postings and the FAQ']);
  const legacy = await call(ctxFor(ORG_A), { action_number: 2, include: 'actions' });
  assertEquals(titles(legacy), ['Put Singapore pay facts where AI reads them']);
  const none = await call(ctxFor(ORG_A), { action: 'nothing like this', include: 'actions' });
  assertEquals(none._coverage.status, 'no_data');
  assertStringIncludes(none._coverage.reason, 'action title');
});

Deno.test('registered on both surfaces, read-only', () => {
  assert(anthropicTools.some(t => t.name === 'get_report_actions'));
  const mcp = mcpTools.find(t => t.name === 'get_report_actions')!;
  assertEquals(mcp.annotations.readOnlyHint, true);
  assertEquals(mcp.annotations.destructiveHint, false);
  assertEquals(dateInWords('2026-10-13'), '13 Oct 2026');
});
