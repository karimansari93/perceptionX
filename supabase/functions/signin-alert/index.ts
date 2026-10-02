// signin-alert: posts "X signed in" to the #users Slack channel.
//
// Called only by the notify_signin_slack() trigger on auth.users (service
// role key from vault). The trigger decides who counts (the founders' and
// Rodrigo's own accounts are skipped there); this function looks up the
// person's name and organizations and formats the message.
//
// Slack webhook: SIGNIN_ALERTS_SLACK_WEBHOOK, else INVITE_ALERTS_SLACK_WEBHOOK
// (the #users channel, which already gets invite alerts).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// The gateway has already verified the JWT signature; only the service role may call this.
const isServiceRole = (token: string) => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!isServiceRole(token)) return json({ error: 'unauthorized' }, 401);

  const webhook = Deno.env.get('SIGNIN_ALERTS_SLACK_WEBHOOK') || Deno.env.get('INVITE_ALERTS_SLACK_WEBHOOK');
  if (!webhook) return json({ ok: true, skipped: 'no webhook configured' });

  let body: { user_id?: string; first_sign_in?: boolean };
  try { body = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }
  if (!body.user_id) return json({ error: 'user_id is required' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: { user } } = await admin.auth.admin.getUserById(body.user_id);
  if (!user) return json({ error: 'user not found' }, 404);

  const { data: profile } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
  const { data: memberships } = await admin
    .from('organization_members')
    .select('organizations(name)')
    .eq('user_id', user.id);

  const name = (profile as any)?.full_name || (user.user_metadata as any)?.full_name || user.email || user.id;
  const orgs = (memberships ?? []).map((m: any) => m.organizations?.name).filter(Boolean).join(', ') || 'No organization';
  const title = body.first_sign_in ? '🆕 First sign-in to PerceptionX' : '👋 Sign-in to PerceptionX';

  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `${name} signed in (${orgs})`,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: title, emoji: true } },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Who*\n${name}` },
              { type: 'mrkdwn', text: `*Email*\n${user.email ?? '—'}` },
              { type: 'mrkdwn', text: `*Organization*\n${orgs}` },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error('slack webhook failed:', res.status, await res.text());
      return json({ ok: false, slackStatus: res.status }, 502);
    }
  } catch (err) {
    console.error('slack webhook error:', err);
    return json({ ok: false }, 502);
  }

  return json({ ok: true });
});
