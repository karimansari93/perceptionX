// Offline tests, run with: cd supabase/functions && deno test _shared/px-tools/source-lines_test.ts
//
// The point of these: coverage of a merged or split source line is a UNION of
// answers read from mcp_get_source_line_coverage. It is never the sum of the
// member hosts' counts, because one answer often cites several of them.
import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { buildSourceLines, parseOwnedEntries } from '../source-platforms.ts';
import {
  MAX_UNION_SCOPE_ANSWERS, ownershipOf, pagesForLine, readLineCounts, readToolSourceLines, UNION_UNAVAILABLE_NOTE,
} from './source-lines.ts';
import type { DomainStatRow } from './source-lines.ts';

const COMPANY = '6013cdc4-5936-4436-86fe-852382469f94';
const MONTHS = ['2026-10-01'];

// Domain-cube rows: LinkedIn is cited under three hosts, Glassdoor under two.
// Summed they would read 300 + 100 + 20 = 420 answers on LinkedIn (42%).
const DOMAIN_ROWS: DomainStatRow[] = [
  { domain: 'linkedin.com', responses_citing: 300, mentioned_responses_citing: 200, citation_count: 800 },
  { domain: 'in.linkedin.com', responses_citing: 100, mentioned_responses_citing: 60, citation_count: 150 },
  { domain: 'hu.linkedin.com', responses_citing: 20, mentioned_responses_citing: 10, citation_count: 25 },
  { domain: 'glassdoor.co.in', responses_citing: 200, mentioned_responses_citing: 100, citation_count: 400 },
  { domain: 'glassdoor.com', responses_citing: 70, mentioned_responses_citing: 40, citation_count: 90 },
  { domain: 'careers.ford.com', responses_citing: 150, mentioned_responses_citing: 150, citation_count: 300 },
];

interface Fake { ctx: any; rpcCalls: Array<{ name: string; params: any }> }

function fake(opts: { owned?: string[]; union?: Record<string, [number, number]>; rpcError?: string; ownedError?: string } = {}): Fake {
  const rpcCalls: Fake['rpcCalls'] = [];
  const admin = {
    from(table: string) {
      assertEquals(table, 'company_owned_domains');
      return {
        select: () => ({
          in: () => Promise.resolve(opts.ownedError
            ? { data: null, error: { message: opts.ownedError } }
            : { data: (opts.owned || []).map(domain => ({ domain })), error: null }),
        }),
      };
    },
    rpc(name: string, params: any) {
      rpcCalls.push({ name, params });
      if (opts.rpcError) return Promise.resolve({ data: null, error: { message: opts.rpcError } });
      const lines = (params.p_lines as any[]).map(l => {
        const [citing, mentioned] = opts.union?.[l.key] ?? [0, 0];
        return { key: l.key, responses_citing: citing, mentioned_responses_citing: mentioned };
      });
      return Promise.resolve({ data: { lines, answers_in_scope: 1000 }, error: null });
    },
  };
  return { ctx: { admin, organizationId: 'org', requestId: 'req' }, rpcCalls };
}

const scope: any = { scope: { companyIds: [COMPANY], brandName: 'Ford Business Solutions', entryCompanyId: COMPANY }, buckets: null, jobFunctions: null, months: MONTHS };

Deno.test('coverage of a merged platform is the union read, not the sum of its hosts', async () => {
  const { ctx, rpcCalls } = fake({ union: { linkedin: [335, 220], glassdoor: [262, 130] } });
  const lines = buildSourceLines(DOMAIN_ROWS.map(d => d.domain), []);
  const out = await readLineCounts(ctx, scope, { months: MONTHS, lines, domainRows: DOMAIN_ROWS, owned: [], answersInScope: 1000 });

  assertEquals(out.note, null);
  assertEquals(out.counts.get('linkedin')?.citing, 335);          // not 420
  assertEquals(out.counts.get('glassdoor')?.citing, 262);         // not 270
  assertEquals(out.counts.get('linkedin')?.mentioned, 220);
  // Links ARE additive across hosts (they are link counts, not answers).
  assertEquals(out.counts.get('linkedin')?.citations, 975);
  // The union read gets the raw hosts as the cube spells them.
  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0].name, 'mcp_get_source_line_coverage');
  const sent = rpcCalls[0].params.p_lines.find((l: any) => l.key === 'linkedin');
  assertEquals(sent.domains, ['hu.linkedin.com', 'in.linkedin.com', 'linkedin.com']);
});

Deno.test('a single-host line needs no union: the cube count is exact and careers.ford.com stays separate', async () => {
  const { ctx, rpcCalls } = fake({ union: { linkedin: [335, 220], glassdoor: [262, 130] }, owned: ['careers.ford.com'] });
  const owned = parseOwnedEntries(['careers.ford.com']);
  const lines = buildSourceLines(DOMAIN_ROWS.map(d => d.domain), owned);
  const out = await readLineCounts(ctx, scope, { months: MONTHS, lines, domainRows: DOMAIN_ROWS, owned, answersInScope: 1000 });
  assertEquals(out.counts.get('careers.ford.com')?.citing, 150);
  assert(!rpcCalls[0].params.p_lines.some((l: any) => l.key === 'careers.ford.com'));
  assertEquals(out.lines.find(l => l.key === 'careers.ford.com')?.owned, true);
});

Deno.test('a platform with owned pages is read as two lines that overlap', async () => {
  const entries = ['linkedin.com/company/ford-india', 'linkedin.com/showcase/ford-india', 'linkedin.com/posts/ford-india_'];
  const { ctx, rpcCalls } = fake({ owned: entries, union: { 'linkedin:owned': [290, 190], 'linkedin:other': [330, 215], glassdoor: [262, 130] } });
  const owned = parseOwnedEntries(entries);
  const lines = buildSourceLines(DOMAIN_ROWS.map(d => d.domain), owned);
  const out = await readLineCounts(ctx, scope, { months: MONTHS, lines, domainRows: DOMAIN_ROWS, owned, answersInScope: 1000 });

  assertEquals(out.counts.get('linkedin:owned')?.citing, 290);
  assertEquals(out.counts.get('linkedin:other')?.citing, 330);
  // 290 + 330 = 620 > the 335 answers that cite LinkedIn at all: the halves
  // overlap, so their percentages must never be added.
  assertEquals(out.counts.get('linkedin:owned')?.citations, null);   // links are not cut by page
  const sentOwned = rpcCalls[0].params.p_lines.find((l: any) => l.key === 'linkedin:owned');
  assertEquals(sentOwned.include.length, 3);
  assertEquals(sentOwned.exclude, null);
  const sentOther = rpcCalls[0].params.p_lines.find((l: any) => l.key === 'linkedin:other');
  assertEquals(sentOther.include, null);
  assertEquals(sentOther.exclude.length, 3);
});

Deno.test('lines that cannot reach the display floor skip the union read', async () => {
  const { ctx, rpcCalls } = fake({ union: { linkedin: [335, 220], glassdoor: [262, 130] } });
  const lines = buildSourceLines(DOMAIN_ROWS.map(d => d.domain), []);
  await readLineCounts(ctx, scope, { months: MONTHS, lines, domainRows: DOMAIN_ROWS, owned: [], answersInScope: 1000, minAnswers: 300 });
  // Glassdoor's members add to only 270: it cannot reach 300, so it is not read.
  assertEquals(rpcCalls[0].params.p_lines.map((l: any) => l.key), ['linkedin']);
});

Deno.test('if the union cannot be read the tools list each host on its own and say so', async () => {
  const { ctx } = fake({ rpcError: 'function mcp_get_source_line_coverage does not exist' });
  const lines = buildSourceLines(DOMAIN_ROWS.map(d => d.domain), []);
  const out = await readLineCounts(ctx, scope, { months: MONTHS, lines, domainRows: DOMAIN_ROWS, owned: [], answersInScope: 1000 });
  assertEquals(out.note, UNION_UNAVAILABLE_NOTE);
  const keys = out.lines.map(l => l.key).sort();
  assert(keys.includes('in.linkedin.com') && keys.includes('glassdoor.co.in'));
  assert(!keys.includes('linkedin'));                              // no merged line, so no invented sum
  assertEquals(out.counts.get('in.linkedin.com')?.citing, 100);
});

Deno.test('the email build is strict: no union, no email', async () => {
  const { ctx } = fake({ rpcError: 'boom' });
  const lines = buildSourceLines(DOMAIN_ROWS.map(d => d.domain), []);
  await assertRejects(
    () => readLineCounts(ctx, scope, { months: MONTHS, lines, domainRows: DOMAIN_ROWS, owned: [], answersInScope: 1000, strict: true }),
    Error, 'Source lines could not be merged',
  );
});

Deno.test('a scope too large for the 20 s budget skips the union read instead of timing out', async () => {
  const { ctx, rpcCalls } = fake();
  const lines = buildSourceLines(DOMAIN_ROWS.map(d => d.domain), []);
  const out = await readLineCounts(ctx, scope, { months: MONTHS, lines, domainRows: DOMAIN_ROWS, owned: [], answersInScope: MAX_UNION_SCOPE_ANSWERS + 1 });
  assertEquals(rpcCalls.length, 0);
  assertEquals(out.note, UNION_UNAVAILABLE_NOTE);
});

Deno.test('a union larger than its own members is refused, not shown', async () => {
  const { ctx } = fake({ union: { linkedin: [999, 500], glassdoor: [262, 130] } });   // members add to 420
  const lines = buildSourceLines(DOMAIN_ROWS.map(d => d.domain), []);
  const out = await readLineCounts(ctx, scope, { months: MONTHS, lines, domainRows: DOMAIN_ROWS, owned: [], answersInScope: 1000 });
  assertEquals(out.note, UNION_UNAVAILABLE_NOTE);
  assert(!out.counts.has('linkedin'));
});

Deno.test('tool lines: owned marked, platforms merged, ownership read failure is flagged not fatal', async () => {
  const ok = fake({ owned: ['careers.ford.com', 'careers.ford.com', 'linkedin.com/company/ford-india'], union: { 'linkedin:owned': [90, 60], 'linkedin:other': [330, 215], glassdoor: [262, 130] } });
  const { rows, notes } = await readToolSourceLines(ok.ctx, scope, DOMAIN_ROWS, 1000);
  assertEquals(notes, []);
  const byKey = new Map(rows.map(x => [x.line.key, x]));
  assertEquals(byKey.get('linkedin:owned')?.line.name, 'LinkedIn: your pages and posts');
  assertEquals(byKey.get('linkedin:owned')?.line.owned, true);
  assertEquals(byKey.get('linkedin:other')?.line.owned, false);
  assertEquals(ownershipOf(byKey.get('linkedin:owned')!.line), 'owned');
  assertEquals(ownershipOf(byKey.get('linkedin:other')!.line), 'partly_owned');
  assertEquals(ownershipOf(byKey.get('glassdoor')!.line), 'third_party');
  assertEquals(byKey.get('careers.ford.com')?.line.owned, true);
  assertEquals(byKey.get('glassdoor')?.citing, 262);
  assertEquals(rows[0].line.key, 'linkedin:other');                 // sorted by coverage, largest first

  const bad = fake({ ownedError: 'permission denied', union: { linkedin: [335, 220], glassdoor: [262, 130] } });
  const r2 = await readToolSourceLines(bad.ctx, scope, DOMAIN_ROWS, 1000);
  assertEquals(r2.notes.length, 1);
  assert(r2.rows.every(x => !x.line.owned));
});

Deno.test('top pages: merged across hosts, and a split half shows only its own pages', () => {
  const owned = parseOwnedEntries(['linkedin.com/showcase/ford-india', 'linkedin.com/posts/ford-india_']);
  const lines = buildSourceLines(DOMAIN_ROWS.map(d => d.domain), owned);
  const mine = lines.find(l => l.key === 'linkedin:owned')!;
  const other = lines.find(l => l.key === 'linkedin:other')!;
  const pages = [
    { domain: 'in.linkedin.com', url: 'https://in.linkedin.com/showcase/ford-india', title: 'Ford India', answers_citing: 119 },
    { domain: 'linkedin.com', url: 'https://www.linkedin.com/posts/analytics-india-magazine_x', title: 'AIM', answers_citing: 50 },
    { domain: 'linkedin.com', url: 'https://www.linkedin.com/posts/ford-india_fordfeature-abc', title: 'FBS post', answers_citing: 56 },
    { domain: 'glassdoor.com', url: 'https://www.glassdoor.com/Reviews/x', title: 'GD', answers_citing: 99 },
  ];
  assertEquals(pagesForLine(mine, pages, 1000, 'cited_in_pct_of_answers').map(p => p.url), [
    'https://in.linkedin.com/showcase/ford-india',
    'https://www.linkedin.com/posts/ford-india_fordfeature-abc',
  ]);
  assertEquals(pagesForLine(other, pages, 1000, 'cited_in_pct_of_answers').map(p => p.url), [
    'https://www.linkedin.com/posts/analytics-india-magazine_x',
  ]);
  assertEquals(pagesForLine(mine, pages, 1000, 'cited_in_pct_of_answers')[0].cited_in_pct_of_answers, 12);
});
