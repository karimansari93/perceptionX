import { assertEquals, assertRejects } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { _resetClaudeKeysForTest, claudeApiKeys, claudeFetch, isCreditExhausted, withClaudeKey } from './claude-keys.ts';

const CREDIT_BODY = {
  type: 'error',
  error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' },
};

function setKeys(primary: string | null, next: string | null) {
  _resetClaudeKeysForTest();
  primary === null ? Deno.env.delete('CLAUDE_API_KEY') : Deno.env.set('CLAUDE_API_KEY', primary);
  next === null ? Deno.env.delete('CLAUDE_API_KEY_NEXT') : Deno.env.set('CLAUDE_API_KEY_NEXT', next);
}

Deno.test('isCreditExhausted: credit-balance and billing errors only', () => {
  assertEquals(isCreditExhausted(CREDIT_BODY), true);
  assertEquals(isCreditExhausted(CREDIT_BODY.error), true);
  assertEquals(isCreditExhausted({ type: 'error', error: { type: 'billing_error', message: 'x' } }), true);
  assertEquals(isCreditExhausted({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }), false);
  assertEquals(isCreditExhausted({ type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens too large' } }), false);
  assertEquals(isCreditExhausted(null), false);
});

Deno.test('claudeApiKeys: order, dedupe, missing keys', () => {
  setKeys('old', 'new');
  assertEquals(claudeApiKeys(), ['old', 'new']);
  setKeys('old', null);
  assertEquals(claudeApiKeys(), ['old']);
  setKeys(null, 'new');
  assertEquals(claudeApiKeys(), ['new']);
  setKeys('same', 'same');
  assertEquals(claudeApiKeys(), ['same']);
  setKeys(null, null);
  assertEquals(claudeApiKeys(), []);
});

Deno.test('withClaudeKey: moves to the next key on a credit error and remembers it', async () => {
  setKeys('old', 'new');
  const seen: string[] = [];
  const call = async (key: string) => {
    seen.push(key);
    if (key === 'old') throw Object.assign(new Error('400 credit'), { status: 400, error: CREDIT_BODY });
    return 'ok';
  };
  assertEquals(await withClaudeKey(call), 'ok');
  assertEquals(await withClaudeKey(call), 'ok');
  assertEquals(seen, ['old', 'new', 'new']);
});

Deno.test('withClaudeKey: other errors are not retried on the next key', async () => {
  setKeys('old', 'new');
  const seen: string[] = [];
  await assertRejects(() => withClaudeKey(async (key) => {
    seen.push(key);
    throw Object.assign(new Error('429 rate limited'), { status: 429, error: { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } } });
  }));
  assertEquals(seen, ['old']);
});

Deno.test('withClaudeKey: credit error with no next key is thrown', async () => {
  setKeys('old', null);
  await assertRejects(() => withClaudeKey(async () => { throw Object.assign(new Error('400'), { error: CREDIT_BODY }); }));
});

Deno.test('claudeFetch: retries on the next key and returns its response', async () => {
  setKeys('old', 'new');
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const key = new Headers(init.headers).get('x-api-key')!;
    seen.push(key);
    return key === 'old'
      ? new Response(JSON.stringify(CREDIT_BODY), { status: 400 })
      : new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  try {
    const res = await claudeFetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'anthropic-version': '2023-06-01' }, body: '{}' });
    assertEquals(res.status, 200);
    assertEquals(seen, ['old', 'new']);
    // A non-credit 400 on the new key comes back to the caller untouched.
    globalThis.fetch = (async () => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }), { status: 400 })) as typeof fetch;
    const bad = await claudeFetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}' });
    assertEquals(bad.status, 400);
    assertEquals((await bad.json()).error.message, 'bad');
  } finally {
    globalThis.fetch = realFetch;
  }
});
