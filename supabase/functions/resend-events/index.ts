// resend-events: Resend's webhook for the quarterly update email.
//
// Resend posts delivery events (delivered, opened, clicked, bounced,
// complained) here. Each one is checked against Resend's signing secret,
// matched to a row in quarterly_digest_sends by the Resend message id (events
// for any other email are acknowledged and dropped), stored in
// quarterly_digest_events, and the ones worth a glance are posted to the
// #users Slack channel: the first open and the first click per message, and
// any bounce or complaint. Repeat opens are stored, not posted.
//
// The gateway does not check a JWT on this function (config.toml): Resend
// cannot send one. The Svix signature is the authentication.
//
// Env: RESEND_WEBHOOK_SECRET (whsec_..., from the webhook's page in Resend),
//      DIGEST_ALERTS_SLACK_WEBHOOK, else INVITE_ALERTS_SLACK_WEBHOOK (#users).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cleanLink, SHORT_TYPE, slackText, verifySignature, type ResendEvent } from './lib.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  if (!secret) return json({ error: 'RESEND_WEBHOOK_SECRET is not set' }, 500);

  const raw = await req.text();
  const ok = await verifySignature(
    secret, req.headers.get('svix-id'), req.headers.get('svix-timestamp'), req.headers.get('svix-signature'), raw,
  );
  if (!ok) return json({ error: 'bad signature' }, 401);

  let event: ResendEvent;
  try { event = JSON.parse(raw); } catch { return json({ error: 'invalid json' }, 400); }
  const type = SHORT_TYPE[event.type] ?? null;
  const emailId = event.data?.email_id;
  if (!type || !emailId) return json({ ok: true, ignored: 'not an email event' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: send } = await admin
    .from('quarterly_digest_sends')
    .select('id, organization_id, user_id, email, period, payload, created_at, organizations(name)')
    .eq('resend_id', emailId)
    .maybeSingle();
  if (!send) return json({ ok: true, ignored: 'not a quarterly update' });

  const svixId = req.headers.get('svix-id')!;
  const link = cleanLink(event.data?.click?.link);
  const { data: inserted, error: insErr } = await admin
    .from('quarterly_digest_events')
    .insert({
      send_id: send.id, resend_id: emailId, type, link, event_at: event.created_at || new Date().toISOString(),
      svix_id: svixId, raw: event,
    })
    .select('id')
    .maybeSingle();
  if (insErr) {
    // A retry of an event we already stored: acknowledge so Resend stops.
    if (/duplicate key|unique/i.test(insErr.message)) return json({ ok: true, duplicate: true });
    console.error('[resend-events] insert failed', insErr.message);
    return json({ error: insErr.message }, 500);
  }

  // Keep the send's status at the furthest step reached.
  const RANK: Record<string, number> = { sent: 0, delayed: 0, delivered: 1, opened: 2, clicked: 3, bounced: 4, complained: 4 };
  const { data: cur } = await admin.from('quarterly_digest_sends').select('status').eq('id', send.id).maybeSingle();
  if ((RANK[type] ?? 0) > (RANK[String(cur?.status || 'sent')] ?? 0)) {
    await admin.from('quarterly_digest_sends').update({ status: type }).eq('id', send.id);
  }

  const { count } = await admin
    .from('quarterly_digest_events')
    .select('id', { count: 'exact', head: true })
    .eq('send_id', send.id)
    .eq('type', type);
  const firstOfKind = (count ?? 1) <= 1;

  const webhook = Deno.env.get('DIGEST_ALERTS_SLACK_WEBHOOK') || Deno.env.get('INVITE_ALERTS_SLACK_WEBHOOK');
  const { data: profile } = await admin.from('profiles').select('full_name').eq('id', send.user_id).maybeSingle();
  const text = slackText(type, {
    email: send.email, name: (profile as any)?.full_name || null,
    org: (send as any).organizations?.name || 'Unknown organisation',
    period: send.period, scope: String((send.payload as any)?.scope?.locationLabel || 'all markets'),
    created_at: send.created_at,
  }, firstOfKind, link, event.data?.bounce?.message || null);

  if (webhook && text) {
    try {
      const res = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      if (!res.ok) console.warn('[resend-events] slack post failed', res.status);
    } catch (err) {
      console.warn('[resend-events] slack post failed', (err as Error).message);
    }
  }
  return json({ ok: true, type, stored: inserted?.id, posted: Boolean(webhook && text) });
});
