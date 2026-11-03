// Offline tests, run with: cd supabase/functions && deno test _shared/source-platforms_test.ts
import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  buildSourceLines, canonicalHost, isOwnedHost, isOwnedUrl, lineCoverageSpec, normalizeSourceUrl,
  parseOwnedEntries, parseOwnedEntry, pathMatches, pathRule, sourceDisplayName, sourceIdentity,
} from './source-platforms.ts';

// ─── Grouping ───────────────────────────────────────────────────────────────

Deno.test('grouping: in.linkedin.com equals linkedin.com', () => {
  assertEquals(sourceIdentity('in.linkedin.com').key, sourceIdentity('linkedin.com').key);
  assertEquals(canonicalHost('in.linkedin.com'), 'linkedin.com');
  for (const h of ['hu.linkedin.com', 'au.linkedin.com', 'ro.linkedin.com', 'www.linkedin.com', 'business.linkedin.com', 'LinkedIn.com']) {
    assertEquals(canonicalHost(h), 'linkedin.com', h);
  }
});

Deno.test('grouping: glassdoor.co.in equals glassdoor.com, with every regional and service host', () => {
  assertEquals(sourceIdentity('glassdoor.co.in').key, sourceIdentity('glassdoor.com').key);
  for (const h of ['glassdoor.co.uk', 'glassdoor.sg', 'glassdoor.ie', 'glassdoor.com.hk', 'www2.glassdoor.co.in',
    'static.glassdoor.co.in', 'api.glassdoor.com', 'stage.glassdoor.com']) {
    assertEquals(canonicalHost(h), 'glassdoor.com', h);
  }
});

Deno.test('grouping: Indeed and AmbitionBox country sites are one platform each', () => {
  for (const h of ['mx.indeed.com', 'hu.indeed.com', 'in.indeed.com', 'indeed.com', 'de.indeed.com']) {
    assertEquals(sourceIdentity(h).key, 'indeed', h);
  }
  for (const h of ['ambitionbox.com', 'app.ambitionbox.com', 'static.ambitionbox.com']) {
    assertEquals(sourceIdentity(h).key, 'ambitionbox', h);
  }
  assertEquals(sourceDisplayName('mx.indeed.com'), 'Indeed');
});

Deno.test('grouping: client-owned domains stay separate', () => {
  assertEquals(sourceIdentity('careers.ford.com'), { key: 'careers.ford.com', name: 'careers.ford.com', domain: 'careers.ford.com', platform: false });
  assert(sourceIdentity('careers.ford.com').key !== sourceIdentity('india.ford.com').key);
  assert(sourceIdentity('india.ford.com').key !== sourceIdentity('ford.com').key);
  assertEquals(canonicalHost('es.ford.com'), 'es.ford.com');
  assertEquals(canonicalHost('www.careers.ford.com'), 'careers.ford.com');
});

Deno.test('grouping: lookalike hosts do not fold', () => {
  assertEquals(sourceIdentity('thermofisher.dejobs.org').platform, false);
  assertEquals(sourceIdentity('linkedin.example.com').platform, false);   // label is "example"
  assertEquals(sourceIdentity('notlinkedin.com').platform, false);
  assertEquals(sourceIdentity('indeed.jobs').platform, false);            // not .com or a country suffix
  assertEquals(sourceIdentity('x.co').platform, false);                   // short label never matches
  assertEquals(sourceIdentity('twitter.com').key, 'x');
  assertEquals(sourceIdentity('en.wikipedia.org').key, 'wikipedia');
});

// ─── URLs ───────────────────────────────────────────────────────────────────

Deno.test('urls: case, scheme, www, country subdomain, query and trailing slash are normalised', () => {
  assertEquals(normalizeSourceUrl('https://in.linkedin.com/Showcase/Ford-India/?utm_source=x#top'), { host: 'linkedin.com', path: '/showcase/ford-india' });
  assertEquals(normalizeSourceUrl('LinkedIn.com/company/Ford-India'), { host: 'linkedin.com', path: '/company/ford-india' });
  assertEquals(normalizeSourceUrl('https://careers.ford.com'), { host: 'careers.ford.com', path: '' });
  assertEquals(normalizeSourceUrl('not a url'), null);
});

// ─── Owned entries ──────────────────────────────────────────────────────────

const FORD_OWNED = parseOwnedEntries([
  'careers.ford.com', 'india.ford.com', 'fordpro.com',
  'careers.ford.com', 'careers.ford.com',                // the same domain on sibling companies is one entry
  'linkedin.com/company/ford-india',
  'linkedin.com/showcase/ford-india',
  'linkedin.com/posts/ford-india_',
]);

Deno.test('owned: the same entry on many sibling companies collapses to one', () => {
  assertEquals(FORD_OWNED.length, 6);
});

Deno.test('owned: entries parse as whole hosts or page prefixes', () => {
  assertEquals(parseOwnedEntry('careers.ford.com'), { kind: 'domain', host: 'careers.ford.com' });
  assertEquals(parseOwnedEntry('https://www.careers.ford.com/'), { kind: 'domain', host: 'careers.ford.com' });
  assertEquals(parseOwnedEntry('LinkedIn.com/Company/Ford-India/'), { kind: 'page', host: 'linkedin.com', path: '/company/ford-india' });
  assertEquals(parseOwnedEntry('in.linkedin.com/showcase/ford-india'), { kind: 'page', host: 'linkedin.com', path: '/showcase/ford-india' });
});

Deno.test('owned pages: Ford India showcase, company pages and posts on any LinkedIn country site', () => {
  for (const u of [
    'https://in.linkedin.com/showcase/ford-india',
    'https://www.linkedin.com/showcase/ford-india',
    'https://hu.linkedin.com/company/ford-india/life',
    'https://www.linkedin.com/posts/ford-india_fordfeature-fordculture-weareford-activity-7246481741295599631-Om5Y',
    'https://www.LinkedIn.com/Company/Ford-India?trk=x',
  ]) assert(isOwnedUrl(u, FORD_OWNED), u);
});

Deno.test('owned pages: other people\'s LinkedIn pages and posts are not owned', () => {
  for (const u of [
    'https://www.linkedin.com/posts/analytics-india-magazine_at-ford-business-solutions-indias-team-activity-7241808192672858114-K7Db',
    'https://www.linkedin.com/posts/ford-motor-company_ford-business-solutions-activity-6937237219346710528-PrXC',
    'https://www.linkedin.com/company/ford-india-fans',      // segment boundary: a different page
    'https://www.linkedin.com/company/ford-indiana',
    'https://in.linkedin.com/jobs/view/data-scientist-at-ford-motor-company-4226194531',
    'https://www.glassdoor.com/company/ford-india',          // right path, wrong platform
  ]) assert(!isOwnedUrl(u, FORD_OWNED), u);
});

Deno.test('owned pages: a post prefix ending in "_" is a raw prefix, a page prefix is segment-aware', () => {
  assertEquals(pathRule('/posts/ford-india_').mode, 'raw');
  assertEquals(pathRule('/company/ford-india').mode, 'segment');
  assert(pathMatches('/posts/ford-india_abc', pathRule('/posts/ford-india_')));
  assert(pathMatches('/company/ford-india', pathRule('/company/ford-india')));
  assert(!pathMatches('/company/ford-indiana', pathRule('/company/ford-india')));
});

Deno.test('owned hosts: whole-host entries cover subdomains, page entries never own a whole host', () => {
  assert(isOwnedHost('careers.ford.com', FORD_OWNED));
  assert(isOwnedHost('static.careers.ford.com', FORD_OWNED));
  assert(isOwnedHost('india.ford.com', FORD_OWNED));
  assert(!isOwnedHost('ford.com', FORD_OWNED));            // a sub-host being owned does not make its parent owned
  assert(!isOwnedHost('linkedin.com', FORD_OWNED));
  assert(!isOwnedHost('in.linkedin.com', FORD_OWNED));
});

// ─── Lines ──────────────────────────────────────────────────────────────────

const CITED = [
  'linkedin.com', 'in.linkedin.com', 'hu.linkedin.com', 'glassdoor.co.in', 'glassdoor.com', 'www2.glassdoor.co.in',
  'in.indeed.com', 'indeed.com', 'ambitionbox.com', 'careers.ford.com', 'india.ford.com', 'reddit.com',
];

Deno.test('lines: platforms merge, client domains stay separate', () => {
  const lines = buildSourceLines(CITED, parseOwnedEntries(['careers.ford.com', 'india.ford.com']));
  const byKey = new Map(lines.map(l => [l.key, l]));
  assertEquals(byKey.get('glassdoor')?.members, ['glassdoor.co.in', 'glassdoor.com', 'www2.glassdoor.co.in']);
  assertEquals(byKey.get('glassdoor')?.needsUnion, true);
  assertEquals(byKey.get('glassdoor')?.owned, false);
  assertEquals(byKey.get('indeed')?.members, ['in.indeed.com', 'indeed.com']);
  assertEquals(byKey.get('ambitionbox')?.needsUnion, false);   // one host: the cube count is exact
  assertEquals(byKey.get('careers.ford.com')?.owned, true);
  assertEquals(byKey.get('india.ford.com')?.owned, true);
  assertEquals(byKey.get('careers.ford.com')?.needsUnion, false);
  assert(!byKey.has('linkedin:owned'));                         // no owned pages, no split
  assertEquals(byKey.get('linkedin')?.name, 'LinkedIn');
});

Deno.test('lines: a platform with owned pages shows as two lines', () => {
  const lines = buildSourceLines(CITED, FORD_OWNED);
  const li = lines.filter(l => l.domain === 'linkedin.com');
  assertEquals(li.map(l => [l.key, l.name, l.owned]), [
    ['linkedin:owned', 'LinkedIn: your pages and posts', true],
    ['linkedin:other', 'LinkedIn: other', false],
  ]);
  assertEquals(li[0].members, ['hu.linkedin.com', 'in.linkedin.com', 'linkedin.com']);
  assertEquals(li[0].include?.length, 3);
  assertEquals(li[0].exclude, null);
  assertEquals(li[1].exclude?.length, 3);
  assertEquals(li[1].include, null);
  assert(li.every(l => l.needsUnion));
  // Other platforms are untouched.
  assertEquals(lines.filter(l => l.key === 'glassdoor').length, 1);
});

Deno.test('lines: the coverage spec carries raw hosts and path rules for the SQL union', () => {
  const ownedLine = buildSourceLines(CITED, FORD_OWNED).find(l => l.key === 'linkedin:owned')!;
  const spec = lineCoverageSpec(ownedLine);
  assertEquals(spec.key, 'linkedin:owned');
  assertEquals(spec.domains, ['hu.linkedin.com', 'in.linkedin.com', 'linkedin.com']);
  assertEquals(spec.include, [
    { prefix: '/company/ford-india', mode: 'segment' },
    { prefix: '/showcase/ford-india', mode: 'segment' },
    { prefix: '/posts/ford-india_', mode: 'raw' },
  ]);
});

Deno.test('lines: a bare owned platform host makes the whole platform one owned line', () => {
  const lines = buildSourceLines(['linkedin.com', 'in.linkedin.com'], parseOwnedEntries(['linkedin.com', 'linkedin.com/company/ford-india']));
  assertEquals(lines.length, 1);
  assertEquals(lines[0].owned, true);
});

Deno.test('owned pages: "*" covers an employer ID that sits at the end of the slug', () => {
  const owned = parseOwnedEntries(['glassdoor.com/*-e152871']);
  assertEquals(owned, [{ kind: 'page', host: 'glassdoor.com', path: '/*-e152871' }]);
  assertEquals(pathRule('/*-e152871').mode, 'wild');
  for (const u of [
    'https://www.glassdoor.co.in/Reviews/Ford-India-Reviews-E152871.htm',
    'https://www2.glassdoor.co.in/Reviews/Ford-India-Reviews-E152871.htm',
    'https://www.glassdoor.com/Interview/Ford-India-Interview-Questions-E152871.htm',
    'https://www.glassdoor.co.in/Culture/Ford-India-Diversity-E152871.htm',
    'https://www.glassdoor.com/Reviews/Employee-Review-Ford-India-E152871-RVW104382580.htm',
  ]) assert(isOwnedUrl(u, owned), u);
  for (const u of [
    'https://www.glassdoor.com/Reviews/Ford-Motor-Company-Reviews-E263.htm',        // the parent profile: not this entry
    'https://www.glassdoor.com/Reviews/Other-Reviews-E1528719.htm',                  // an ID that merely starts the same: not a match
    'https://www.indeed.com/cmp/Ford-India-E152871',                                 // right ID text, wrong platform
  ]) assert(!isOwnedUrl(u, owned), u);
});

Deno.test('owned pages: characters in a pattern are literal except "*", and a wildcard match ends on a boundary', () => {
  assert(pathMatches('/a.b/c', pathRule('/a.b*')));
  assert(!pathMatches('/axb/c', pathRule('/a.b*')));
  assert(pathMatches('/reviews/x-e1', pathRule('/*-e1')));
  assert(pathMatches('/reviews/x-e1.htm', pathRule('/*-e1')));
  assert(!pathMatches('/reviews/x-e12.htm', pathRule('/*-e1')));
  // The rule carries the pattern the SQL union applies, so both sides agree.
  assertEquals(pathRule('/*-e152871').regex, '^/.*-e152871(?![a-z0-9])');
});
