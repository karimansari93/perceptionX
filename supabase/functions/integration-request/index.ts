// integration-request: the what's-new modal's "which assistants does your
// team use?" form. Stores the request (integration_requests) and posts it to
// Slack. The row is written first, so a Slack outage never loses a request.
//
// Auth: the caller's Supabase JWT; the row is written for that user, with the
// organization only if they are a member of it. Slack webhook:
// INTEGRATION_REQUESTS_SLACK_WEBHOOK, else INVITE_ALERTS_SLACK_WEBHOOK (the
// channel that already gets invite alerts), else BATCH_ALERTS_SLACK_WEBHOOK.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const TOOL_NAMES: Record<string, string> = {
  chatgpt: 'ChatGPT', copilot: 'Microsoft Copilot', claude: 'Claude', gemini: 'Gemini', perplexity: 'Perplexity', slack: 'Slack',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'unauthorized' }, 401);
  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) return json({ error: 'unauthorized' }, 401);

  let body: { organizationId?: string | null; tools?: unknown; other?: unknown; note?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }

  const tools = Array.isArray(body.tools)
    ? body.tools.filter((t): t is string => typeof t === 'string' && t in TOOL_NAMES).slice(0, 10)
    : [];
  const other = typeof body.other === 'string' ? body.other.trim().slice(0, 500) : '';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : '';
  if (!tools.length && !other) return json({ error: 'pick a tool or say what else you use' }, 400);

  // The organization counts only if the caller belongs to it.
  let organizationId: string | null = null;
  let orgName: string | null = null;
  if (typeof body.organizationId === 'string' && body.organizationId) {
    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id, organizations(name)')
      .eq('user_id', user.id)
      .eq('organization_id', body.organizationId)
      .maybeSingle();
    if (membership) {
      organizationId = body.organizationId;
      orgName = (membership as any).organizations?.name ?? null;
    }
  }

  const replyTo = user.email ?? '';
  const { error: insertError } = await admin.from('integration_requests').insert({
    user_id: user.id, organization_id: organizationId, tools, other, note, reply_to: replyTo,
  });
  if (insertError) {
    console.error('integration_requests insert failed:', insertError);
    return json({ error: 'could not save the request' }, 500);
  }

  const { data: profile } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
  const who = [(profile as any)?.full_name, replyTo].filter(Boolean).join(' · ') || user.id;

  // Slack, best-effort.
  const webhook = Deno.env.get('INTEGRATION_REQUESTS_SLACK_WEBHOOK')
    || Deno.env.get('INVITE_ALERTS_SLACK_WEBHOOK')
    || Deno.env.get('BATCH_ALERTS_SLACK_WEBHOOK');
  let slack = false;
  if (webhook) {
    const toolList = tools.map(t => TOOL_NAMES[t]).join(', ') || '—';
    const fields = [
      `*Who:* ${who}`,
      `*Organization:* ${orgName ?? 'unknown'}`,
      `*Assistants:* ${toolList}`,
      ...(other ? [`*Anything else:* ${other}`] : []),
      ...(note ? [`*What they would ask:* ${note}`] : []),
    ];
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `AI integration request from ${who} (${orgName ?? 'unknown org'}): ${toolList}`,
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: '🔌 AI integration request', emoji: true } },
            { type: 'section', text: { type: 'mrkdwn', text: fields.join('\n') } },
            { type: 'context', elements: [{ type: 'mrkdwn', text: `Reply to ${replyTo || 'the user'} · stored in integration_requests` }] },
          ],
        }),
      });
      slack = res.ok;
      if (!res.ok) console.error('slack webhook failed:', res.status, await res.text());
    } catch (err) {
      console.error('slack webhook error:', err);
    }
  } else {
    console.warn('no Slack webhook configured; request stored only');
  }

  return json({ ok: true, slack });
});
