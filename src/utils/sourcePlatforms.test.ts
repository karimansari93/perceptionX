import { describe, expect, it } from 'vitest';
import {
  buildSourceLines, canonicalHost, isOwnedHost, isOwnedUrl, parseOwnedEntries, PLATFORMS, sourceIdentity,
} from './sourcePlatforms';
import { enhanceCitations } from './citationUtils';
import { EMPLOYER_REVIEW_PLATFORMS } from './sourceConfig';

// The rule itself is tested next to its code in
// supabase/functions/_shared/source-platforms_test.ts; these pin what the
// dashboard sees through its re-export and through citationUtils.

describe('dashboard grouping uses the shared platform rule', () => {
  it('in.linkedin.com equals linkedin.com', () => {
    expect(sourceIdentity('in.linkedin.com').key).toBe(sourceIdentity('linkedin.com').key);
    expect(canonicalHost('in.linkedin.com')).toBe('linkedin.com');
  });

  it('glassdoor.co.in equals glassdoor.com', () => {
    expect(canonicalHost('glassdoor.co.in')).toBe(canonicalHost('glassdoor.com'));
  });

  it('careers.ford.com stays separate from india.ford.com and ford.com', () => {
    expect(canonicalHost('careers.ford.com')).toBe('careers.ford.com');
    expect(new Set(['careers.ford.com', 'india.ford.com', 'ford.com'].map(canonicalHost)).size).toBe(3);
  });

  it('owned pages match on any country site of the platform', () => {
    const owned = parseOwnedEntries(['careers.ford.com', 'linkedin.com/showcase/ford-india', 'glassdoor.com/*-e152871']);
    expect(isOwnedUrl('https://in.linkedin.com/showcase/ford-india', owned)).toBe(true);
    expect(isOwnedUrl('https://www.glassdoor.co.in/Reviews/Ford-India-Reviews-E152871.htm', owned)).toBe(true);
    expect(isOwnedUrl('https://www.linkedin.com/posts/someone-else_x', owned)).toBe(false);
    expect(isOwnedHost('careers.ford.com', owned)).toBe(true);
    expect(isOwnedHost('linkedin.com', owned)).toBe(false);
  });

  it('a platform with owned pages becomes two lines', () => {
    const lines = buildSourceLines(['linkedin.com', 'in.linkedin.com'], parseOwnedEntries(['linkedin.com/showcase/ford-india']));
    expect(lines.map(l => l.name)).toEqual(['LinkedIn: your pages and posts', 'LinkedIn: other']);
  });
});

describe('citationUtils folds platform hosts and leaves client domains alone', () => {
  const domainsOf = (urls: string[]) =>
    enhanceCitations(urls.map(url => ({ url, title: '' }))).map(c => c.domain);

  it('country sites of one platform share one domain', () => {
    expect(domainsOf([
      'https://in.linkedin.com/showcase/ford-india',
      'https://www.linkedin.com/company/ford-india',
      'https://www.glassdoor.co.in/Reviews/Ford-India-Reviews-E152871.htm',
      'https://mx.indeed.com/cmp/Ford',
    ])).toEqual(['linkedin.com', 'linkedin.com', 'glassdoor.com', 'indeed.com']);
  });

  it('a client\'s own country domain is not turned into .com', () => {
    expect(domainsOf(['https://www.ford.de/karriere', 'https://careers.ford.com/x', 'https://www.ford.co.uk/'])).toEqual([
      'ford.de', 'careers.ford.com', 'ford.co.uk',
    ]);
  });
});

describe('the dashboard platform lists agree with the shared registry', () => {
  it('every platform both lists know has the same logo domain', () => {
    const shared = new Map(PLATFORMS.map(p => [p.name.toLowerCase(), p.domain]));
    const shown = EMPLOYER_REVIEW_PLATFORMS.filter(p => shared.has(p.name.toLowerCase()));
    expect(shown.length).toBeGreaterThan(8);
    for (const p of shown) expect([p.name, p.canonical]).toEqual([p.name, shared.get(p.name.toLowerCase())]);
  });
});
