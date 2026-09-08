import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { normalizeScope, scopeNote } from './scope.ts';

Deno.test('scope: brand-wide questions carry no note; filtered ones name the tool filters', () => {
  assertEquals(scopeNote({ company: 'Ford', locations: [], jobFunctions: [] }), null);
  const one = scopeNote({ company: 'Ford', locations: ['Germany'], jobFunctions: ['Finance'] })!;
  assertStringIncludes(one, 'company: Ford');
  assertStringIncludes(one, 'pass location "Germany"');
  assertStringIncludes(one, 'pass job_function "Finance"');
  assertStringIncludes(one, 'brand-wide figure');
  const many = scopeNote({ locations: ['Germany', 'India'], jobFunctions: [] })!;
  assertStringIncludes(many, 'markets: Germany, India');
  assertStringIncludes(many, 'once per market (location "Germany", "India"');
  assertEquals(many.includes('job_function'), false);
});

Deno.test('scope: body values are trimmed, deduped, capped, and the old single-value shape still works', () => {
  assertEquals(
    normalizeScope({ company: ' Ford ', locations: [' Germany ', 'Germany', 42], jobFunctions: '' }),
    { company: 'Ford', locations: ['Germany'], jobFunctions: [] },
  );
  assertEquals(normalizeScope({ location: 'India', jobFunction: 'HR' }), { company: null, locations: ['India'], jobFunctions: ['HR'] });
  assertEquals(normalizeScope('nope'), { locations: [], jobFunctions: [] });
  assertEquals(normalizeScope({ locations: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }).locations.length, 6);
});
