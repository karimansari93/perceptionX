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
//   * the model cannot pick the organization through tool input.

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { anthropicTools, executeTool, mcpTools } from './mod.ts';
import { dateInWords } from './executors-report.ts';
import type { ToolContext } from './scope.ts';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORG_EMPTY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PUBLISHED = '2026-10-14T07:40:00Z';

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
    action(ORG_A, 'a2', 2, 'act_now', 'Put Singapore pay facts where AI reads them', ['Singapore']),
    action(ORG_A, 'a1', 1, 'act_now', 'Add response times to the German interview guide page', ['Germany']),
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

function action(org: string, id: string, n: number | null, register: string, title: string, markets: string[]) {
  return {
    id, organization_id: org, key: `2026-09-01:${id}`, register, title, cycle_raised: '2026-09-01', action_number: n,
    problem: `${title}: problem`, ai_says: 'What AI says.', ai_reads: [{ source: 'kununu', market: 'Germany', coverage_pct: 65 }],
    urls: ['https://example.com/page'], recommendation: 'What to do.', lanes: ['owned', 'people'], timing: 'act_next',
    lifts: [{ metric: 'Sentiment' }], proof_status: null,
    verified_facts: [{ fact: 'Page lists four stages.', checked_on: '2026-10-12' }],
    owner_name: null, tracking_status: 'open', work_status: 'open', markets, functions: [], notes: null, published_at: PUBLISHED,
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

Deno.test('own organization: snapshot, numbered actions, watch items, cited with period and as-of date', async () => {
  const p = await call(ctxFor(ORG_A));
  assertEquals(p._coverage.status, 'found');
  assertEquals(p.report.report, 'Q3 2026 baseline');
  assertEquals(p.report.as_of, '13 Oct 2026');
  assertEquals(p._meta.cite_as, 'Q3 2026 baseline, as of 13 Oct 2026');
  assertEquals(p.report.headline.sentiment_pct, 62);
  assertEquals(p.report.metric_status.sentiment.status, 'provisional');
  assertEquals(p.report.metric_status.visibility.since, '13 Oct 2026');
  assertEquals(p.actions.map((a: any) => a.number), ['01', '02']);
  assertEquals(p.actions[0].raised_in, 'Q3 2026');
  assertEquals(p.actions[0].timing, 'Act next');
  assertEquals(p.actions[0].lanes, ['Owned', 'People']);
  assertEquals(p.actions[0].verified_facts[0].checked_on, '12 Oct 2026');
  assertEquals(p.actions[0].latest_check.metric_readings[0].metric_status, 'provisional');
  assertEquals(p.actions[0].latest_check.checked_on, '14 Oct 2026');
  assertEquals(p.watch_items.map((w: any) => w.title), ['Take the QA test site out of reach']);
  assert(!ISO_DATE.test(JSON.stringify(p.actions)), 'action dates are in words');
  assertStringIncludes(p._meta.methodology.join(' '), 'provisional');
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
  assertEquals(p.actions.map((a: any) => a.title), ['Org B secret action']);
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

Deno.test('filters: market keeps that market plus organization-wide items; action number narrows', async () => {
  const de = await call(ctxFor(ORG_A), { market: 'germany' });
  assertEquals(de.actions.map((a: any) => a.number), ['01']);
  assertEquals(de.watch_items.length, 1);
  const two = await call(ctxFor(ORG_A), { action_number: 2, include: 'actions' });
  assertEquals(two.actions.map((a: any) => a.number), ['02']);
  assertEquals(two.report, undefined);
  const none = await call(ctxFor(ORG_A), { market: 'Japan', include: 'actions' });
  assertEquals(none.actions, []);
});

Deno.test('registered on both surfaces, read-only', () => {
  assert(anthropicTools.some(t => t.name === 'get_report_actions'));
  const mcp = mcpTools.find(t => t.name === 'get_report_actions')!;
  assertEquals(mcp.annotations.readOnlyHint, true);
  assertEquals(mcp.annotations.destructiveHint, false);
  assertEquals(dateInWords('2026-10-13'), '13 Oct 2026');
});
