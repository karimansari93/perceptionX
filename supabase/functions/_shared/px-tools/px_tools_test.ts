// Offline tests for the shared data-tool layer, run with:
//   cd supabase/functions && deno test _shared/px-tools/
//
// A fake service-role client replays a Ford-shaped fixture (one brand across
// two markets, waves in Apr/May and July 2026, nothing since) through the
// real executors. These pin the guardrails the Ford pilot depends on:
//   * periods are MEASURED quarters — the window starts at the first quarter
//     with data, never at a calendar quarter, and a completed wave is never
//     labeled "(in progress)";
//   * percentages lead and every raw count sits under sample_size;
//   * change is in points vs the previous measured period;
//   * EPS carries relevance from the relevance MV;
//   * no ISO dates or timestamps leak into any payload.

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { executeTool } from './mod.ts';
import { changeBlock, labelQuarter, selectRecentQuarters } from './helpers.ts';
import type { ToolContext } from './scope.ts';

// ─── Fixture ────────────────────────────────────────────────────────────────
const ORG = '00000000-0000-4000-8000-00000000000a';
const FORD_US = '11111111-1111-4111-8111-111111111111';
const FORD_IN = '22222222-2222-4222-8222-222222222222';
const FORD_CREDIT = '33333333-3333-4333-8333-333333333333';
const NOT_MINE = '99999999-9999-4999-8999-999999999999';

const tables: Record<string, any[]> = {
  companies: [
    { id: FORD_US, name: 'Ford', country: 'US' },
    { id: FORD_IN, name: 'Ford', country: 'IN' },
    { id: FORD_CREDIT, name: 'Ford Credit', country: 'US' },
  ],
  organization_companies: [
    { organization_id: ORG, company_id: FORD_US, companies: { id: FORD_US, name: 'Ford' } },
    { organization_id: ORG, company_id: FORD_IN, companies: { id: FORD_IN, name: 'Ford' } },
    { organization_id: ORG, company_id: FORD_CREDIT, companies: { id: FORD_CREDIT, name: 'Ford Credit' } },
  ],
  company_industries: [],
  ai_themes: [
    {
      company_id: FORD_IN, attribute_id: 'wellbeing-balance', theme_name: 'Hybrid Work Flexibility', sentiment: 'positive',
      context_snippets: ['Employees value the hybrid arrangement.'], keywords: ['hybrid', 'flexible'], created_at: '2026-07-20T00:00:00Z',
      prompt_responses: { ai_model: 'openai', response_month: '2026-07-01', confirmed_prompts: { location_context: 'India' } },
    },
    {
      company_id: FORD_US, attribute_id: 'wellbeing-balance', theme_name: 'Long Hours in Plants', sentiment: 'negative',
      context_snippets: ['Shift work can mean long hours.'], keywords: ['hours'], created_at: '2026-07-18T00:00:00Z',
      prompt_responses: { ai_model: 'perplexity', response_month: '2026-07-01', confirmed_prompts: { location_context: 'United States' } },
    },
  ],
  competitor_themes: [],
  prompt_responses: [],
};

// Scope stats: one wave assigned to April (US + India), one in July. No May,
// no June, nothing after July — exactly the shape that produced "May is
// missing" and "Q3 is still in progress" misreads.
const SCOPE_STATS = [
  { company_id: FORD_US, response_month: '2026-04-01', job_function_context: '', location_context: 'United States', total_responses: 1000, mentioned_responses: 800, total_citations: 8000, distinct_domains: 50, positive_themes: 300, negative_themes: 100, neutral_themes: 40 },
  { company_id: FORD_US, response_month: '2026-07-01', job_function_context: '', location_context: 'United States', total_responses: 1000, mentioned_responses: 850, total_citations: 9000, distinct_domains: 55, positive_themes: 280, negative_themes: 120, neutral_themes: 40 },
  { company_id: FORD_IN, response_month: '2026-04-01', job_function_context: '', location_context: 'India', total_responses: 500, mentioned_responses: 300, total_citations: 4000, distinct_domains: 30, positive_themes: 100, negative_themes: 50, neutral_themes: 20 },
  { company_id: FORD_IN, response_month: '2026-07-01', job_function_context: '', location_context: 'India', total_responses: 500, mentioned_responses: 350, total_citations: 5000, distinct_domains: 32, positive_themes: 90, negative_themes: 60, neutral_themes: 20 },
];
const LLM_STATS = [
  { ai_model: 'openai', response_month: '2026-07-01', location_context: 'United States', total_responses: 500, mentions: 450 },
  { ai_model: 'perplexity', response_month: '2026-07-01', location_context: 'United States', total_responses: 500, mentions: 400 },
  { ai_model: 'openai', response_month: '2026-04-01', location_context: 'United States', total_responses: 500, mentions: 420 },
  { ai_model: 'perplexity', response_month: '2026-04-01', location_context: 'United States', total_responses: 500, mentions: 380 },
];
const ATTRIBUTE_THEMES = [
  { attribute_id: 'wellbeing-balance', response_month: '2026-04-01', job_function_context: '', total_themes: 200, positive_themes: 150, negative_themes: 30, neutral_themes: 20, response_count: 300 },
  { attribute_id: 'wellbeing-balance', response_month: '2026-07-01', job_function_context: '', total_themes: 260, positive_themes: 160, negative_themes: 80, neutral_themes: 20, response_count: 345 },
  { attribute_id: 'compensation', response_month: '2026-04-01', job_function_context: '', total_themes: 300, positive_themes: 200, negative_themes: 50, neutral_themes: 50, response_count: 400 },
  { attribute_id: 'compensation', response_month: '2026-07-01', job_function_context: '', total_themes: 300, positive_themes: 210, negative_themes: 60, neutral_themes: 30, response_count: 420 },
  // Retired v1 id — must never surface as an attribute row.
  { attribute_id: 'overall-candidate-experience', response_month: '2026-07-01', job_function_context: '', total_themes: 50, positive_themes: 30, negative_themes: 10, neutral_themes: 10, response_count: 60 },
];
const RELEVANCE = [
  { response_month: '2026-04-01', valid_citations: 1000, weighted_relevance: 65000 },
  { response_month: '2026-07-01', valid_citations: 2000, weighted_relevance: 132000 },
];

const inMonths = (row: any, months: string[] | null) => !months || months.includes(String(row.response_month).slice(0, 10));
const inBuckets = (row: any, buckets: string[] | null) => !buckets || buckets.includes(row.location_context);

let activeCollection = false;

function rpc(name: string, params: any): { data: any; error: any } {
  const months: string[] | null = params.p_months ?? null;
  const buckets: string[] | null = params.p_buckets ?? null;
  switch (name) {
    case 'mcp_list_location_buckets':
      return { data: ['India', 'United States'], error: null };
    case 'mcp_get_measurement_periods': {
      const rows = SCOPE_STATS.filter(r => params.p_company_ids.includes(r.company_id) && inBuckets(r, buckets));
      const byCompany = new Map<string, { months: Set<string>; answers: number }>();
      for (const r of SCOPE_STATS.filter(r => params.p_company_ids.includes(r.company_id))) {
        const e = byCompany.get(r.company_id) || { months: new Set(), answers: 0 };
        e.months.add(r.response_month); e.answers += r.total_responses;
        byCompany.set(r.company_id, e);
      }
      return {
        data: {
          months: Array.from(new Set(rows.map(r => r.response_month))).sort(),
          by_company: Array.from(byCompany.entries()).map(([company_id, v]) => ({ company_id, months: Array.from(v.months), answers: v.answers })),
          last_collected_day: '2026-07-30',
          active_collection: activeCollection,
        },
        error: null,
      };
    }
    case 'mcp_get_rollups':
      return {
        data: {
          scope_stats: SCOPE_STATS.filter(r => params.p_company_ids.includes(r.company_id) && inMonths(r, months) && inBuckets(r, buckets)),
          llm_stats: LLM_STATS.filter(r => inMonths(r, months) && inBuckets(r, buckets)),
          attribute_themes: ATTRIBUTE_THEMES.filter(r => inMonths(r, months)),
          relevance: RELEVANCE.filter(r => inMonths(r, months)),
          data_as_of: '2026-09-03T00:00:00Z',
        },
        error: null,
      };
    case 'mcp_get_attribute_sources':
      return {
        data: {
          answers_sampled: 345, attribute_answers_pool: 645,
          rows: [
            { domain: 'glassdoor.com', answers_citing: 138, top_pages: [
              { url: 'https://www.glassdoor.com/Reviews/Ford-Motor-Company-Reviews-E263.htm', title: 'Ford Motor Company Reviews | Glassdoor', answers_citing: 90 },
            ] },
            { domain: 'careers.ford.com', answers_citing: 100, top_pages: [
              { url: 'https://www.careers.ford.com/benefits', title: null, answers_citing: 60 },
              { url: 'not-a-link', title: 'junk', answers_citing: 5 },
            ] },
          ],
        },
        error: null,
      };
    case 'mcp_get_cited_pages':
      return {
        data: {
          distinct_pages: 3, data_as_of: '2026-09-03T00:00:00Z',
          rows: [
            { domain: 'careers.ford.com', url: 'https://www.careers.ford.com/benefits', title: 'Employee Benefits at Ford', answers_citing: 200 },
            { domain: 'glassdoor.com', url: 'https://www.glassdoor.com/Reviews/Ford-Motor-Company-Reviews-E263.htm', title: 'Ford Motor Company Reviews | Glassdoor', answers_citing: 120 },
            { domain: 'glassdoor.com', url: 'https://www.glassdoor.com/Salary/Ford-Motor-Company-Salaries-E263.htm', title: null, answers_citing: 40 },
          ].filter(r => !params.p_domain || r.domain === params.p_domain),
        },
        error: null,
      };
    case 'mcp_get_theme_stats':
      return {
        data: {
          themes: [{ theme_name: 'Hybrid Work Flexibility', responses: 300, positive: 290, negative: 5, neutral: 5, attribute_ids: ['wellbeing-balance'], platforms: ['openai', 'perplexity'], description: 'Hybrid work is valued.', keywords: ['hybrid'], snippet: 'x' }],
          by_platform: [
            { ai_model: 'openai', responses_with_themes: 400, positive: 200, negative: 100, neutral: 20 },
            { ai_model: 'perplexity', responses_with_themes: 350, positive: 170, negative: 80, neutral: 20 },
          ],
          attribute_top_themes: { 'wellbeing-balance': ['Hybrid Work Flexibility'] },
          answers_sampled: 1500,
          pool_answers: 2600,
          responses_with_themes: 750,
          theme_total: 1200,
        },
        error: null,
      };
    case 'mcp_get_domain_stats':
      return {
        data: {
          rows: [
            { domain: 'glassdoor.com', response_month: '2026-07-01', responses_citing: 450, mentioned_responses_citing: 300, citation_count: 900 },
            { domain: 'careers.ford.com', response_month: '2026-07-01', responses_citing: 600, mentioned_responses_citing: 600, citation_count: 700 },
          ].filter(r => inMonths(r, months)),
          domain_total: 2,
          data_as_of: '2026-09-03T00:00:00Z',
        },
        error: null,
      };
    case 'mcp_get_competitor_stats':
      return {
        data: {
          rows: [
            { competitor_name: 'General Motors', response_month: '2026-07-01', prompt_type: 'competitive', responses_mentioning: 300, co_mentions: 250 },
            { competitor_name: 'Toyota', response_month: '2026-07-01', prompt_type: 'discovery', responses_mentioning: 150, co_mentions: 100 },
          ].filter(r => inMonths(r, months)),
          competitor_total: 2,
        },
        error: null,
      };
    case 'mcp_get_attribute_competitors':
      return { data: { rows: [{ competitor_name: 'General Motors', responses_naming: 80 }], attribute_responses: 400, attribute_responses_with_competitors: 120 }, error: null };
    default:
      return { data: null, error: { message: `unknown rpc ${name}` } };
  }
}

// Minimal PostgREST-builder stand-in: applies eq/in on plain columns, ignores
// embedded-resource filters, resolves to { data, error } when awaited.
class FakeQuery {
  constructor(private rows: any[]) {}
  select() { return this; }
  order() { return this; }
  limit(n: number) { this.rows = this.rows.slice(0, n); return this; }
  ilike() { return this; }
  not() { return this; }
  eq(col: string, v: any) { if (!col.includes('.')) this.rows = this.rows.filter(r => r[col] === v); return this; }
  in(col: string, vs: any[]) { if (!col.includes('.')) this.rows = this.rows.filter(r => vs.includes(r[col])); return this; }
  maybeSingle() { return Promise.resolve({ data: this.rows[0] ?? null, error: null }); }
  single() { return Promise.resolve({ data: this.rows[0] ?? null, error: this.rows[0] ? null : { message: 'no rows' } }); }
  then(res: any, rej?: any) { return Promise.resolve({ data: this.rows, error: null }).then(res, rej); }
}

const admin = {
  from: (table: string) => new FakeQuery([...(tables[table] || [])]),
  rpc: (name: string, params: any) => Promise.resolve(rpc(name, params)),
};
const ctx: ToolContext = { admin, organizationId: ORG, requestId: 'test' };
const call = async (tool: string, input: any) => JSON.parse(await executeTool(ctx, tool, input));

// ─── Payload lints (mirror the live eval) ───────────────────────────────────
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
// Share-shaped keys: "..._pct", "..._pct_of_answers", "..._points",
// "..._per_answer", and the EPS composite. Anything else numeric inside a
// list entry is a raw count and must live under sample_size.
const SHARE_KEY = /(_pct(_|$)|_points$|_per_answer$|^eps$)/;
const SERIES_KEYS = new Set(['top_pages', 'quarterly', 'series', 'sources', 'competitors', 'attributes', 'attribute_summary', 'top_attributes', 'top_themes', 'top_competitors', 'top_sources', 'citations', 'themes', 'model_breakdown', 'by_platform', 'share_of_voice', 'comparison']);

function assertNoRawCountsLead(payload: any, path = '$') {
  if (Array.isArray(payload)) { payload.forEach((v, i) => assertNoRawCountsLead(v, `${path}[${i}]`)); return; }
  if (!payload || typeof payload !== 'object') return;
  for (const [k, v] of Object.entries(payload)) {
    if (k === 'sample_size' || k === '_coverage' || k === '_meta') continue;
    if (SERIES_KEYS.has(k) && Array.isArray(v)) {
      for (const [i, entry] of v.entries()) {
        if (!entry || typeof entry !== 'object') continue;
        for (const [ek, ev] of Object.entries(entry)) {
          if (typeof ev === 'number') {
            assert(SHARE_KEY.test(ek), `${path}.${k}[${i}].${ek} is a bare number (${ev}) outside sample_size`);
          }
        }
      }
    }
    assertNoRawCountsLead(v, `${path}.${k}`);
  }
}

function lint(name: string, payload: any) {
  const text = JSON.stringify(payload);
  // Page URLs are the one place a date-shaped string is legitimate.
  const sansUrls = JSON.stringify(payload, (k, v) => (k === 'url' ? undefined : v));
  assert(!ISO_DATE.test(sansUrls), `${name}: ISO date leaked: ${sansUrls.match(ISO_DATE)?.[0]}`);
  if (payload._meta?.collection_in_progress !== true) {
    assert(!text.includes('(in progress)'), `${name}: "(in progress)" without an active collection`);
  }
  assertNoRawCountsLead(payload);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

Deno.test('helpers: window counts measured quarters, not calendar quarters', () => {
  const months = ['2026-04-01', '2026-05-01', '2026-07-01'];
  assertEquals(selectRecentQuarters(months, 4).quarters, ['Q2 2026', 'Q3 2026']);
  assertEquals(selectRecentQuarters(months, 1), { months: ['2026-07-01'], quarters: ['Q3 2026'] });
  assertEquals(labelQuarter('Q3 2026', null), 'Q3 2026');
  assertEquals(labelQuarter('Q3 2026', 'Q3 2026'), 'Q3 2026 (in progress)');
});

Deno.test('helpers: change is vs the previous measured period, in points', () => {
  const c = changeBlock([{ quarter: 'Q4 2025', value: 60 }, { quarter: 'Q2 2026', value: 73 }, { quarter: 'Q3 2026', value: 80 }], null)!;
  assertEquals(c.previous_period, 'Q2 2026');
  assertEquals(c.delta_points_vs_previous, 7);
  assertEquals(c.delta_points_since_first, 20);
  assertEquals(c.note, undefined);
  assertEquals(changeBlock([{ quarter: 'Q3 2026', value: 80 }], null), null);
});

Deno.test('get_visibility: periods come from data, brand scope, shares first', async () => {
  const p = await call('get_visibility', { company_id: FORD_US, quarters_back: 4, by_model: true });
  lint('get_visibility', p);
  assertEquals(p._meta.periods, ['Q2 2026', 'Q3 2026']);
  assertEquals(p._meta.period_range, { from: 'Q2 2026', to: 'Q3 2026' });
  assertEquals(p._meta.latest_period, 'Q3 2026');
  assertEquals(p._meta.scope_companies, 2);                 // Ford US + Ford IN, not Ford Credit
  assertEquals(p.quarterly.map((q: any) => q.visibility_pct), [73, 80]);
  assertEquals(Object.keys(p.quarterly[0])[1], 'visibility_pct');
  assertEquals(p.quarterly[1].sample_size, { answers: 1500, answers_mentioning_company: 1200 });
  assertEquals(p.change.delta_points_vs_previous, 7);
  assertEquals(p.by_platform[0].platform, 'openai');
  assertStringIncludes(p._meta.methodology.join(' '), 'not a measurement period, not missing data');
});

Deno.test('get_visibility: market filter narrows periods to that market\'s waves', async () => {
  const p = await call('get_visibility', { company_id: FORD_US, location: 'india' });
  lint('get_visibility/india', p);
  assertEquals(p._meta.locations_matched, ['India']);
  assertEquals(p.quarterly.map((q: any) => q.visibility_pct), [60, 70]);
  const bad = await call('get_visibility', { company_id: FORD_US, location: 'Atlantis' });
  assertEquals(bad._coverage.status, 'no_data');
  assertEquals(bad._coverage.available_markets, ['India', 'United States']);
});

Deno.test('get_attribute_themes: % of answers leads, retired ids hidden, sources attached', async () => {
  const p = await call('get_attribute_themes', { company_id: FORD_US, attribute_id: 'well-being', quarters_back: 4 });
  lint('get_attribute_themes', p);
  assertEquals(p.focus_attribute, 'wellbeing-balance');
  const w = p.attributes[0];
  assertEquals(w.quarterly.map((q: any) => q.mentioned_in_pct_of_answers), [20, 23]);
  assertEquals(w.quarterly.map((q: any) => q.positive_sentiment_pct), [83, 67]);
  assertEquals(w.quarterly.map((q: any) => q.share_of_themes_pct), [40, 46]);
  assertEquals(w.change_vs_previous_period.mentioned_pct_points, 3);
  assertEquals(w.change_vs_previous_period.sentiment_points, -16);
  assertEquals(w.sample_size.answers_mentioning, 645);
  assertEquals(p.sources_in_attribute_answers.sources[0], {
    domain: 'glassdoor.com', cited_in_pct_of_attribute_answers: 40,
    top_pages: [{
      url: 'https://www.glassdoor.com/Reviews/Ford-Motor-Company-Reviews-E263.htm', title: 'Ford Motor Company Reviews | Glassdoor',
      cited_in_pct_of_attribute_answers: 26, sample_size: { answers_citing: 90 },
    }],
    sample_size: { answers_citing: 138 },
  });
  // A page without an http(s) url is dropped; a missing title stays null (the host shows the url).
  assertEquals(p.sources_in_attribute_answers.sources[1].top_pages.map((x: any) => [x.url, x.title]),
    [['https://www.careers.ford.com/benefits', null]]);
  assertStringIncludes(p._meta.methodology.join(' '), 'top_pages');
  assertEquals(p.example_themes.length, 2);
  assertEquals(p.example_themes[0].ai_platform, 'openai');

  const all = await call('get_attribute_themes', { company_id: FORD_US });
  assert(!all.attributes.some((a: any) => a.attribute_id === 'overall-candidate-experience'));
  assertEquals(all.attributes.map((a: any) => a.attribute_id), ['compensation', 'wellbeing-balance']);
  const unknown = await call('get_attribute_themes', { company_id: FORD_US, attribute_id: 'nonsense' });
  assertStringIncludes(unknown.error, 'compensation');
});

Deno.test('get_trends: sentiment and citations-per-answer series', async () => {
  const s = await call('get_trends', { company_id: FORD_US, metric: 'sentiment' });
  lint('get_trends/sentiment', s);
  assertEquals(s.series.map((x: any) => x.positive_sentiment_pct), [73, 67]);
  assertEquals(s.change.delta_points_vs_previous, -6);
  assertEquals(s.change.previous_period, 'Q2 2026');
  const c = await call('get_trends', { company_id: FORD_US, metric: 'citations' });
  lint('get_trends/citations', c);
  assertEquals(c.series.map((x: any) => x.citations_per_answer), [8, 9.3]);
});

Deno.test('get_company_metrics: relevance is real and EPS uses it', async () => {
  const p = await call('get_company_metrics', { company_id: FORD_US });
  lint('get_company_metrics', p);
  assertEquals(p.period, 'Q3 2026');
  assertEquals(p.visibility_pct, 80);
  assertEquals(p.positive_sentiment_pct, 67);
  assertEquals(p.relevance_pct, 66);
  assertEquals(p.eps, 71);
  assertEquals(p.change_vs_previous_period.previous_period, 'Q2 2026');
  assertEquals(p.change_vs_previous_period.visibility_points, 7);
  assertEquals(p._meta.periods, ['Q3 2026']);
});

Deno.test('get_company_overview: latest measured quarter, everything as shares', async () => {
  const p = await call('get_company_overview', { company_id: FORD_US });
  lint('get_company_overview', p);
  assertEquals(p.metrics.period, 'Q3 2026');
  assertEquals(p.top_attributes[0].attribute_id, 'compensation');
  assertEquals(p.top_attributes[1].mentioned_in_pct_of_answers, 23);
  assertEquals(p.top_attributes[1].change_vs_previous_period.mentioned_pct_points, 3);
  assertEquals(p.top_competitors[0], { name: 'General Motors', named_in_pct_of_answers: 20, sample_size: { answers_naming: 300 } });
  assertEquals(p.top_sources[0].cited_in_pct_of_answers, 40);
  assertEquals(p.top_sources[1].answer_gap_pct_of_answers, 10);
  assertEquals(p.top_themes[0].mentioned_in_pct_of_answers, 20);
  assertEquals(p._coverage.has_previous_period, true);
});

Deno.test('core tools default to the latest measured quarter, brand scope', async () => {
  const comp = await call('get_competitors', { company_id: FORD_US });
  lint('get_competitors', comp);
  assertEquals(comp._meta.periods, ['Q3 2026']);
  assertEquals(comp.competitors[0].named_in_pct_of_answers, 20);
  const cit = await call('get_citations', { company_id: FORD_US, domain_filter: 'glassdoor' });
  lint('get_citations', cit);
  assertEquals(cit.citations.length, 1);
  assertEquals(cit.citations[0].cited_in_pct_of_answers, 30);
  assertEquals(cit.citations[0].top_pages.map((x: any) => x.url), [
    'https://www.glassdoor.com/Reviews/Ford-Motor-Company-Reviews-E263.htm',
    'https://www.glassdoor.com/Salary/Ford-Motor-Company-Salaries-E263.htm',
  ]);
  // Page shares use the same denominator as the domain shares (the window's answers).
  assertEquals(cit.citations[0].top_pages[0].cited_in_pct_of_answers, Math.round(120 / cit.sample_size.answers * 100));
  assert(cit.citations[0].top_pages[0].cited_in_pct_of_answers <= cit.citations[0].cited_in_pct_of_answers);
  const mb = await call('get_model_breakdown', { company_id: FORD_US });
  lint('get_model_breakdown', mb);
  assertEquals(mb.model_breakdown[0], {
    platform: 'openai', visibility_pct: 90, positive_sentiment_pct: 67, dominant_sentiment: 'Positive',
    sample_size: { answers: 500, answers_mentioning_company: 450, answers_with_themes: 400, positive_themes: 200, negative_themes: 100, neutral_themes: 20 },
  });
  const th = await call('get_themes', { company_id: FORD_US, quarters_back: 2 });
  lint('get_themes', th);
  assertEquals(th._meta.periods, ['Q2 2026', 'Q3 2026']);
  assertEquals(th.themes[0].mentioned_in_pct_of_answers, 20);   // 300 of the 1,500 sampled answers
  assertEquals(th.sample_size.answers_sampled_for_themes, 1500);
  assertStringIncludes(th._meta.methodology.join(' '), 'random sample');
  const ab = await call('get_attribute_breakdown', { company_id: FORD_US });
  lint('get_attribute_breakdown', ab);
  assertEquals(ab.attributes[1].top_themes, ['Hybrid Work Flexibility']);
});

Deno.test('list_companies and compare_companies label each profile with its own period', async () => {
  const l = await call('list_companies', {});
  lint('list_companies', l);
  const ford = l.companies.find((c: any) => c.id === FORD_US);
  assertEquals(ford.latest_period, 'Q3 2026');
  assertEquals(ford.measured_periods, 2);
  assertEquals(l._coverage.status, 'partial');            // Ford Credit has no rows in the fixture
  assertEquals(l._coverage.not_yet_measured, ['Ford Credit']);
  const cmp = await call('compare_companies', { company_ids: [FORD_US, FORD_IN, FORD_CREDIT] });
  lint('compare_companies', cmp);
  assertEquals(cmp.comparison.length, 2);
  assertEquals(cmp.comparison[0].period, 'Q3 2026');
  assertEquals(cmp._coverage.not_yet_measured, ['Ford Credit']);
});

Deno.test('in-progress labeling comes from the pipeline, not the calendar', async () => {
  activeCollection = true;
  try {
    const p = await call('get_trends', { company_id: FORD_US, metric: 'visibility' });
    assertEquals(p._meta.collection_in_progress, true);
    assertEquals(p._meta.latest_period, 'Q3 2026 (in progress)');
    assertStringIncludes(p.change.note, 'still being collected');
    lint('get_trends/in-progress', p);
  } finally {
    activeCollection = false;
  }
});

Deno.test('tenancy: foreign company ids are rejected before any read', async () => {
  const p = await call('get_visibility', { company_id: NOT_MINE });
  assertStringIncludes(p.error, 'not in your organization');
  const bad = await call('get_visibility', { company_id: 'nope' });
  assertStringIncludes(bad.error, 'Invalid company_id');
});

Deno.test('get_sources: every domain carries its most-cited pages for linking', async () => {
  const s = await call('get_sources', { company_id: FORD_US, quarters_back: 4, limit: 10 });
  lint('get_sources', s);
  const ford = s.sources.find((x: any) => x.domain === 'careers.ford.com');
  assertEquals(ford.top_pages, [{
    url: 'https://www.careers.ford.com/benefits', title: 'Employee Benefits at Ford',
    cited_in_pct_of_answers: Math.round(200 / s.sample_size.answers * 100), sample_size: { answers_citing: 200 },
  }]);
  assertEquals(Object.keys(ford).indexOf('top_pages') < Object.keys(ford).indexOf('sample_size'), true);
  assertStringIncludes(s._meta.methodology.join(' '), 'top_pages');
});
