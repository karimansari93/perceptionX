// Pure helpers for resend-events, unit-tested in lib_test.ts.
const TOLERANCE_SECONDS = 5 * 60;

const b64 = {
  decode: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
  encode: (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))),
};

// Svix signature: HMAC-SHA256 over "<id>.<timestamp>.<body>" with the secret
// after "whsec_", base64; the header may carry several "v1,<sig>" entries.
export async function verifySignature(
  secret: string, id: string | null, timestamp: string | null, signature: string | null, body: string,
): Promise<boolean> {
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey(
    'raw', b64.decode(secret.replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const expected = b64.encode(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));
  return signature.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    return version === 'v1' && sig === expected;
  });
}

export interface ResendEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[];
    subject?: string;
    click?: { link?: string; timestamp?: string; userAgent?: string };
    bounce?: { message?: string; type?: string; subType?: string };
  };
}

export const SHORT_TYPE: Record<string, string> = {
  'email.delivered': 'delivered', 'email.opened': 'opened', 'email.clicked': 'clicked',
  'email.bounced': 'bounced', 'email.complained': 'complained', 'email.delivery_delayed': 'delayed',
  'email.sent': 'sent',
};

const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
const sinceText = (iso: string) => {
  const m = minutesSince(iso);
  if (m < 60) return `${m} min after sending`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h after sending`;
  return `${Math.round(m / 1440)} days after sending`;
};

// The Slack line for an event, or null when it is not worth posting.
export function slackText(
  type: string, send: { email: string; name: string | null; org: string; period: string; scope: string; created_at: string },
  firstOfKind: boolean, link?: string | null, bounce?: string | null, test = false,
): string | null {
  const who = `${send.name || send.email} (${send.org}, ${send.scope})`;
  const what = `the ${send.period} update${test ? ' (test send)' : ''}`;
  switch (type) {
    case 'opened': return firstOfKind ? `📬 ${who} opened ${what}, ${sinceText(send.created_at)}.` : null;
    case 'clicked': return firstOfKind ? `🔗 ${who} clicked through from ${what}${link ? ` to ${link}` : ''}, ${sinceText(send.created_at)}.` : null;
    case 'bounced': return `⚠️ ${what} to ${send.email} (${send.org}) bounced${bounce ? `: ${bounce}` : '.'}`;
    case 'complained': return `🚫 ${send.email} (${send.org}) marked ${what} as spam.`;
    default: return null;
  }
}

// Campaign parameters are ours; strip them so the Slack line reads as the page.
export const cleanLink = (link?: string | null) => {
  if (!link) return null;
  try {
    const u = new URL(link);
    for (const k of [...u.searchParams.keys()]) if (k.startsWith('utm_')) u.searchParams.delete(k);
    return u.toString().replace(/\?$/, '');
  } catch { return link; }
};

