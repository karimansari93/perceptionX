import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { collectSources } from './sources.ts';
import type { SourceLink } from './sources.ts';

Deno.test('sources event: every top_pages url in a tool result, deduped, http(s) only', () => {
  const payload = {
    sources: [
      { domain: 'glassdoor.com', cited_in_pct_of_answers: 31, top_pages: [
        { url: 'https://www.glassdoor.com/Reviews/Ford-Reviews-E123.htm', title: 'Ford Reviews', cited_in_pct_of_answers: 12 },
        { url: 'javascript:alert(1)', title: 'bad', cited_in_pct_of_answers: 1 },
      ] },
    ],
    sources_in_attribute_answers: { sources: [
      { domain: 'indeed.com', cited_in_pct_of_attribute_answers: 9, top_pages: [
        { url: 'https://www.indeed.com/cmp/Ford', title: 'Ford \\"culture\\" Reviews', cited_in_pct_of_attribute_answers: 4 },
        { url: 'https://www.glassdoor.com/Reviews/Ford-Reviews-E123.htm', title: 'dup', cited_in_pct_of_attribute_answers: 2 },
      ] },
    ] },
  };
  const out = new Map<string, SourceLink>();
  collectSources(payload, out);
  assertEquals(Array.from(out.keys()), [
    'https://www.glassdoor.com/Reviews/Ford-Reviews-E123.htm',
    'https://www.indeed.com/cmp/Ford',
  ]);
  assertEquals(out.get('https://www.indeed.com/cmp/Ford')?.domain, 'indeed.com');
  assertEquals(out.get('https://www.indeed.com/cmp/Ford')?.share, 4);
  assertEquals(out.get('https://www.indeed.com/cmp/Ford')?.title, 'Ford "culture" Reviews');
});

import { collectCompetitors } from './sources.ts';

Deno.test('competitors event: every named competitor row, deduped', () => {
  const payload = {
    top_competitors: [
      { name: 'Amazon', named_in_pct_of_answers: 17, sample_size: { answers_naming: 120 } },
      { name: 'Disney', named_in_pct_of_answers: 15, sample_size: { answers_naming: 100 } },
    ],
    competitors: [{ competitor: 'Amazon', named_in_pct_of_answers: 20 }, { competitor: '', named_in_pct_of_answers: 1 }],
  };
  const out = new Set<string>();
  collectCompetitors(payload, out);
  assertEquals(Array.from(out), ['Amazon', 'Disney']);
});
