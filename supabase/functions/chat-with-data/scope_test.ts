import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { normalizeScope, scopeNote } from './scope.ts';

Deno.test('scope: brand-wide questions carry no note; filtered ones name the tool filters', () => {
  assertEquals(scopeNote({ company: 'Ford' }), null);
  assertEquals(scopeNote({}), null);
  const note = scopeNote({ company: 'Ford', location: 'Germany', jobFunction: 'Finance' })!;
  assertStringIncludes(note, 'company: Ford');
  assertStringIncludes(note, 'location "Germany"');
  assertStringIncludes(note, 'job_function "Finance"');
  assertStringIncludes(note, 'brand-wide figure');
  const fnOnly = scopeNote({ jobFunction: 'Engineering' })!;
  assertStringIncludes(fnOnly, 'job_function "Engineering"');
  assertEquals(fnOnly.includes('location "'), false);
});

Deno.test('scope: body values are trimmed strings or null', () => {
  assertEquals(normalizeScope({ company: ' Ford ', location: '', jobFunction: 42 }), { company: 'Ford', location: null, jobFunction: null });
  assertEquals(normalizeScope('nope'), {});
});
