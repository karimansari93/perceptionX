import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { scrapingdogAiOverview } from './google-serp.ts';

// Scrapingdog's advance_search call fails intermittently with a 400; the
// search must be retried rather than recorded as a missing AI overview.
function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const FAIL = { status: 400, body: { message: 'Something went wrong, please try again', status: 400 } };
const INLINE_AIO = {
  status: 200,
  body: { ai_overview: { text_blocks: [{ type: 'paragraph', snippet: 'Walmart pays cashiers about $17/hr.' }], references: [{ link: 'https://www.indeed.com/cmp/Walmart', title: 'Indeed' }] } },
};

Deno.test('scrapingdog AIO: retries a failed search and returns the overview', async () => {
  Deno.env.set('SCRAPINGDOG_API_KEY', 'test-key');
  const m = mockFetch([FAIL, FAIL, INLINE_AIO]);
  try {
    const r = await scrapingdogAiOverview('How is Walmart as an employer?');
    assertEquals(m.calls.length, 3);
    assertStringIncludes(r.response, 'Walmart pays cashiers');
    assertEquals(r.citations.map((c) => c.url), ['https://www.indeed.com/cmp/Walmart']);
  } finally {
    m.restore();
  }
});

Deno.test('scrapingdog AIO: does not retry an auth failure', async () => {
  Deno.env.set('SCRAPINGDOG_API_KEY', 'test-key');
  const m = mockFetch([{ status: 401, body: { message: 'Invalid API key' } }]);
  try {
    const r = await scrapingdogAiOverview('How is Walmart as an employer?');
    assertEquals(m.calls.length, 1);
    assertStringIncludes(r.response, 'Google search API error: Invalid API key');
  } finally {
    m.restore();
  }
});

const RATE_LIMITED = { status: 429, body: { message: 'Too many requests, please wait for sometime.' } };

Deno.test('scrapingdog AIO: waits out a rate-limited search and returns the overview', async () => {
  Deno.env.set('SCRAPINGDOG_API_KEY', 'test-key');
  Deno.env.set('SCRAPINGDOG_START_JITTER_MS', '0');
  Deno.env.set('SCRAPINGDOG_RATE_LIMIT_BACKOFF_MS', '50');
  const m = mockFetch([RATE_LIMITED, INLINE_AIO]);
  try {
    const r = await scrapingdogAiOverview('How is Walmart as an employer?');
    assertEquals(m.calls.length, 2);
    assertStringIncludes(r.response, 'Walmart pays cashiers');
  } finally {
    m.restore();
  }
});

Deno.test('scrapingdog AIO: retries a rate-limited overview fetch', async () => {
  Deno.env.set('SCRAPINGDOG_API_KEY', 'test-key');
  Deno.env.set('SCRAPINGDOG_START_JITTER_MS', '0');
  Deno.env.set('SCRAPINGDOG_RATE_LIMIT_BACKOFF_MS', '50');
  const LINKED = { status: 200, body: { ai_overview: { scrapingdog_link: 'https://api.scrapingdog.com/google/ai_overview?x=1' } } };
  const m = mockFetch([LINKED, RATE_LIMITED, INLINE_AIO]);
  try {
    const r = await scrapingdogAiOverview('How is Walmart as an employer?');
    assertEquals(m.calls.length, 3);
    assertStringIncludes(r.response, 'Walmart pays cashiers');
  } finally {
    m.restore();
  }
});

Deno.test('scrapingdog AIO: gives up on a fetch that stays rate-limited', async () => {
  Deno.env.set('SCRAPINGDOG_API_KEY', 'test-key');
  Deno.env.set('SCRAPINGDOG_START_JITTER_MS', '0');
  Deno.env.set('SCRAPINGDOG_RATE_LIMIT_BACKOFF_MS', '50');
  const LINKED = { status: 200, body: { ai_overview: { scrapingdog_link: 'https://api.scrapingdog.com/google/ai_overview?x=1' } } };
  const m = mockFetch([LINKED, RATE_LIMITED]);
  try {
    const r = await scrapingdogAiOverview('How is Walmart as an employer?');
    assertEquals(m.calls.length, 4);
    assertStringIncludes(r.response, 'Google AI Overview API error: Too many requests');
  } finally {
    m.restore();
  }
});
