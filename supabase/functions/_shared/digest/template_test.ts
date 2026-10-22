import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { digestSubject, renderDigestHtml } from './template.ts';
import { coverageRows, describeLocation, groupRows, previousWaveLabel, shortQuarter } from './payload.ts';
import { digestMarkdown, validateNarrative } from './narrative.ts';
import type { DigestPayload } from './types.ts';

const payload: DigestPayload = {
  recipient: { firstName: 'Sreesha', email: 'sreesha@example.com' },
  brand: { name: 'Ford Business Solutions', domain: 'careers.ford.com' },
  scope: { locationLabel: 'India', preposition: 'in', markets: ['India'], jobFunctions: ['Data Insights & Analytics', 'Integrated ERP'] },
  period: { quarter: 'Q4 2026', short: 'Q4 26', previousQuarter: 'Q3 2026', previousLabel: 'July' },
  metrics: {
    eps: { value: 78, delta: 1, grade: 'Good' },
    sentiment: { value: 84, delta: -4 },
    visibility: { value: 68, delta: 2 },
    relevance: { value: 80, delta: 11 },
  },
  comparisonNote: 'Change since July compares this quarter with the previous one.',
  sentimentChangeHidden: false,
  byFunction: [
    { name: 'Data Insights & Analytics', positivePct: 84, sentimentDelta: -5, namedPct: 92, visibilityDelta: 1 },
    { name: 'Integrated ERP', positivePct: 84, sentimentDelta: -6, namedPct: 91, visibilityDelta: 0 },
  ],
  byMarket: [],
  employers: [
    { domain: 'infosys.com', name: 'Infosys', pct: 21, delta: -3 },
    { domain: 'careers.ford.com', name: 'Ford Business Solutions', pct: 68, delta: 2, you: true },
  ],
  sources: [
    { domain: 'linkedin.com', name: 'LinkedIn', pct: 49, delta: -2 },
    { domain: 'careers.ford.com', name: 'careers.ford.com', pct: 44, delta: 11, owned: true },
  ],
  attributes: [
    { attributeId: 'career-opportunities', name: 'Career Opportunities', raisedPct: 36, positivePct: 72, delta: -4 },
    { attributeId: 'wellbeing-balance', name: 'Wellbeing & Balance', raisedPct: 25, positivePct: 93, delta: -2 },
  ],
  narrative: {
    preheader: 'Score 78, Good. Career growth is what pulls sentiment down.',
    callouts: [{ title: 'Your careers site is now the second source AI reads.', body: 'careers.ford.com appears in 44% of answers, up 11 points.' },
               { title: 'Career growth pulls sentiment down.', body: 'Career Opportunities is 72% positive, down 4 points.' }],
    functionsNote: 'The dip is a Data and iERP story.',
    marketsNote: null,
    action: 'Add a progression section to the India careers page.',
  },
  chatUrl: 'https://app.perceptionx.ai/chat?c=abc',
  chatNote: 'A saved chat with this summary.',
};
const opts = { appUrl: 'https://app.perceptionx.ai', logoDevToken: 'pk_test' };

Deno.test('subject and title carry the short quarter', () => {
  assertEquals(digestSubject(payload), 'Your PerceptionX Q4 26 Update');
  assertStringIncludes(renderDigestHtml(payload, opts), '<title>Your PerceptionX Q4 26 Update</title>');
});

Deno.test('marks come from logo.dev and icons from the app, never Google', () => {
  const html = renderDigestHtml(payload, opts);
  assertStringIncludes(html, 'https://img.logo.dev/careers.ford.com?token=pk_test');
  assertStringIncludes(html, 'https://app.perceptionx.ai/email/attributes/career-opportunities.png');
  assertStringIncludes(html, 'https://app.perceptionx.ai/logos/PerceptionX-PrimaryLogo.png');
  assert(!html.includes('gstatic'));
  assert(!html.includes('google.com/s2'));
});

Deno.test('deltas render as point pills against the previous wave', () => {
  const html = renderDigestHtml(payload, opts);
  assertStringIncludes(html, '↑ 11 pts vs July');
  assertStringIncludes(html, '↓ 4 pts vs July');
  assertStringIncludes(html, 'Ford Business Solutions (You)');
  assertStringIncludes(html, 'Where to act next');
  assert(!html.includes('—'));
});

Deno.test('a classifier change hides sentiment and theme change', () => {
  const html = renderDigestHtml({ ...payload, sentimentChangeHidden: true }, opts);
  assertStringIncludes(html, 'classifier updated');
  assertStringIncludes(html, 'comparison resumes next quarter');
  assert(!html.includes('↓ 4 pts vs July'));
});

Deno.test('escapes recipient and brand text', () => {
  const html = renderDigestHtml({ ...payload, recipient: { firstName: '<b>x</b>', email: 'x@y' } }, opts);
  assert(!html.includes('<b>x</b>'));
  assertStringIncludes(html, '&lt;b&gt;x&lt;/b&gt;');
});

Deno.test('payload helpers', () => {
  assertEquals(shortQuarter('Q4 2026'), 'Q4 26');
  assertEquals(previousWaveLabel(['2026-07-01', '2026-08-01', '2026-10-01'], 'Q3 2026'), 'August');
  assertEquals(previousWaveLabel(['2026-10-01'], null), null);
  assertEquals(describeLocation('region:emea', ['Germany', 'Poland']), { label: 'EMEA', preposition: 'across' });
  assertEquals(describeLocation('india', ['India']), { label: 'India', preposition: 'in' });
  assertEquals(describeLocation('set:india|united states', ['India', 'United States']), { label: 'India, United States', preposition: 'across' });
});

Deno.test('groupRows reads the latest and previous quarter per function', () => {
  const stats = [
    { response_month: '2026-10-01', job_function_context: 'Finance', total_responses: 100, mentioned_responses: 90, positive_themes: 80, negative_themes: 20 },
    { response_month: '2026-07-01', job_function_context: 'Finance', total_responses: 100, mentioned_responses: 85, positive_themes: 85, negative_themes: 15 },
    { response_month: '2026-10-01', job_function_context: '', total_responses: 50, mentioned_responses: 10, positive_themes: 1, negative_themes: 1 },
  ];
  const rows = groupRows(stats, r => String(r.job_function_context || ''), 'Q4 2026', 'Q3 2026');
  assertEquals(rows, [{ name: 'Finance', positivePct: 80, sentimentDelta: -5, namedPct: 90, visibilityDelta: 5 }]);
});

Deno.test('coverageRows turns per-quarter counts into shares with change', () => {
  const totals = new Map([['Q4 2026', 200], ['Q3 2026', 100]]);
  const rows = coverageRows([
    { key: 'linkedin.com', quarter: 'Q4 2026', count: 98 },
    { key: 'linkedin.com', quarter: 'Q3 2026', count: 51 },
    { key: 'youtube.com', quarter: 'Q4 2026', count: 18 },
  ], totals, 'Q4 2026', 'Q3 2026');
  assertEquals(rows, [{ key: 'linkedin.com', pct: 49, delta: -2 }, { key: 'youtube.com', pct: 9, delta: 9 }]);
});

Deno.test('validateNarrative strips dashes, caps lengths and drops notes that do not apply', () => {
  const n = validateNarrative({
    preheader: 'Score 78 — Good',
    callouts: [{ title: 'A', body: 'b' }, { title: 'C', body: 'd' }, { title: '', body: 'x' }],
    functionsNote: 'note', marketsNote: 'markets', action: 'Do the thing.',
  }, payload);
  assertEquals(n.preheader, 'Score 78, Good');
  assertEquals(n.callouts.length, 2);
  assertEquals(n.functionsNote, 'note');
  assertEquals(n.marketsNote, null);
});

Deno.test('digestMarkdown carries the figures for the chat thread', () => {
  const md = digestMarkdown(payload);
  assertStringIncludes(md, '**Employer Perception Score:** 78 (Good) (up 1 points)');
  assertStringIncludes(md, '- LinkedIn: 49% of answers (down 2 points)');
  assertStringIncludes(md, 'Where to act next');
});

Deno.test('domains in prose become navy links, never client auto-links', () => {
  const html = renderDigestHtml({
    ...payload,
    narrative: { ...payload.narrative!, action: 'The page AI reads most, jobs.netflix.com/culture, says nothing about workload.' },
  }, opts);
  assertStringIncludes(html, '<a href="https://jobs.netflix.com/culture" style="color:#13274F;text-decoration:none;font-weight:600;" target="_blank">jobs.netflix.com/culture</a>');
  assertStringIncludes(html, '<a href="https://careers.ford.com" style="color:#0F172A;text-decoration:none;" target="_blank">careers.ford.com</a>');
  assertStringIncludes(html, '>OWNED</span>');
  assert(!html.includes('October'));
});
