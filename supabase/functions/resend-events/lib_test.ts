import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { cleanLink, slackText, verifySignature } from './lib.ts';

const secret = 'whsec_' + btoa('a-test-secret-of-some-length');
const sign = async (id: string, ts: string, body: string) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('a-test-secret-of-some-length'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`)))));
};

Deno.test('signature: accepts a fresh, correctly signed delivery and rejects the rest', async () => {
  const ts = String(Math.floor(Date.now() / 1000));
  const body = '{"type":"email.opened"}';
  const sig = await sign('msg_1', ts, body);
  assert(await verifySignature(secret, 'msg_1', ts, `v1,${sig}`, body));
  assert(await verifySignature(secret, 'msg_1', ts, `v1,bogus v1,${sig}`, body), 'any matching v1 entry passes');
  assert(!await verifySignature(secret, 'msg_1', ts, `v1,${sig}`, body + ' '), 'body changed');
  assert(!await verifySignature(secret, 'msg_2', ts, `v1,${sig}`, body), 'id changed');
  assert(!await verifySignature(secret, 'msg_1', String(Number(ts) - 3600), `v1,${await sign('msg_1', String(Number(ts) - 3600), body)}`, body), 'too old');
  assert(!await verifySignature(secret, null, ts, `v1,${sig}`, body), 'missing header');
});

const send = { email: 'm@ford.example', name: 'Manjola Tahiri', org: 'Ford', period: 'Q3 2026', scope: 'Germany', created_at: new Date(Date.now() - 12 * 60000).toISOString() };

Deno.test('slack line: first open and first click only, bounces and complaints always', () => {
  assertEquals(slackText('opened', send, true), '📬 Manjola Tahiri (Ford, Germany) opened the Q3 2026 update, 12 min after sending.');
  assertEquals(slackText('opened', send, false), null);
  assertEquals(slackText('clicked', send, true, 'https://app.perceptionx.ai/chat?c=abc'), '🔗 Manjola Tahiri (Ford, Germany) clicked through from the Q3 2026 update to https://app.perceptionx.ai/chat?c=abc, 12 min after sending.');
  assertEquals(slackText('clicked', send, false, 'https://app.perceptionx.ai/chat?c=abc'), null);
  assertEquals(slackText('bounced', send, false, null, 'Mailbox full'), '⚠️ the Q3 2026 update to m@ford.example (Ford) bounced: Mailbox full');
  assertEquals(slackText('complained', send, false), '🚫 m@ford.example (Ford) marked the Q3 2026 update as spam.');
  assertEquals(slackText('delivered', send, true), null);
  assertEquals(slackText('opened', { ...send, name: null }, true)?.startsWith('📬 m@ford.example (Ford, Germany)'), true);
  assertEquals(slackText('opened', send, true, null, null, true), '📬 Manjola Tahiri (Ford, Germany) opened the Q3 2026 update (test send), 12 min after sending.');
});

Deno.test('links lose our campaign parameters and nothing else', () => {
  assertEquals(cleanLink('https://app.perceptionx.ai/chat?c=abc&utm_source=perceptionx&utm_medium=email&utm_campaign=quarterly-update-q3-2026'), 'https://app.perceptionx.ai/chat?c=abc');
  assertEquals(cleanLink('https://perceptionx.ai?utm_source=perceptionx&utm_medium=email'), 'https://perceptionx.ai/');
  assertEquals(cleanLink(null), null);
});
