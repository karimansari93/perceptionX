// ─── quarterly-digest: the quarterly update email, admin side ───────────────
// Platform admins preview, test and send the quarterly update email. Each
// member on an organization's send list (organization_members
// .quarterly_digest) gets the email for their own saved view: the brand and
// location selection on their profile, the same two columns the dashboard
// reads. Numbers come from the cubes through the analyst tool scope
// (_shared/digest/payload.ts), prose from the analyst model
// (_shared/digest/narrative.ts), HTML from the template
// (_shared/digest/template.ts). Delivery is Resend.
//
// Body: { action: "preview" | "send_test" | "send", memberId?, organizationId?, confirm? }
//   preview   {memberId}        → { html, subject, payload }  (nothing sent, no chat created)
//   send_test {memberId}        → the member's email, sent to the CALLER only,
//                                  with a chat thread created for the caller
//   send      {organizationId, confirm: true}
//                               → every member on the list, each with their
//                                  own pre-created chat thread; one row per
//                                  send in quarterly_digest_sends
//
// Env: RESEND_API_KEY, DIGEST_FROM_EMAIL ("Karim at PerceptionX <karim@perceptionx.ai>"),
//      DIGEST_REPLY_TO, APP_URL (https://app.perceptionx.ai), DIGEST_ASSET_URL (images; defaults
//      to APP_URL), LOGO_DEV_TOKEN, CLAUDE_API_KEY.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { genRequestId } from '../_shared/px-tools/mod.ts';
import type { ToolContext } from '../_shared/px-tools/mod.ts';
import { buildDigestPayload } from '../_shared/digest/payload.ts';
import { digestMarkdown, writeNarrative } from '../_shared/digest/narrative.ts';
import { digestSubject, renderDigestHtml } from '../_shared/digest/template.ts';
import type { DigestPayload } from '../_shared/digest/types.ts';

const APP_URL = (Deno.env.get('APP_URL') || 'https://app.perceptionx.ai').replace(/\/+$/, '');
// Where the email's images live (the PerceptionX logo, the attribute icon
// PNGs). Defaults to the app; set to a deploy preview while the icons are
// not yet on the live app.
const ASSET_URL = (Deno.env.get('DIGEST_ASSET_URL') || APP_URL).replace(/\/+$/, '');
const LOGO_DEV_TOKEN = Deno.env.get('LOGO_DEV_TOKEN') || 'pk_ekarmbf-SbmRJ537a9wdxA';
const FROM = Deno.env.get('DIGEST_FROM_EMAIL') || 'Karim at PerceptionX <karim@perceptionx.ai>';
const REPLY_TO = Deno.env.get('DIGEST_REPLY_TO') || 'karim@perceptionx.ai';
const SEND_BATCH = 20;

type Action = 'preview' | 'send_test' | 'send';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

interface MemberView {
  memberId: string;
  organizationId: string;
  userId: string;
  email: string;
  firstName: string;
  companyId: string | null;
  locationKey: string | null;
  onList: boolean;
}

const firstNameOf = (fullName: string | null | undefined, email: string) => {
  const n = (fullName || '').trim();
  if (n) return n.split(/\s+/)[0];
  return email.split('@')[0].split(/[._-]/)[0].replace(/^\w/, c => c.toUpperCase());
};

// The dashboard's canonical key for a stored location context.
const canonicalLocation = (raw: string | null | undefined): string | null => {
  const v = (raw || '').trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  return lower.startsWith('region:') || lower.startsWith('set:') ? lower : lower;
};

async function loadMembers(admin: any, where: { memberId?: string; organizationId?: string }): Promise<MemberView[]> {
  let q = admin.from('organization_members').select('id, organization_id, user_id, quarterly_digest');
  if (where.memberId) q = q.eq('id', where.memberId);
  if (where.organizationId) q = q.eq('organization_id', where.organizationId);
  const { data: members, error } = await q;
  if (error) throw new Error(`Members read failed: ${error.message}`);
  const ids = (members || []).map((m: any) => m.user_id);
  if (!ids.length) return [];
  const { data: profiles, error: pErr } = await admin.from('profiles')
    .select('id, email, full_name, default_company_id, default_location_context').in('id', ids);
  if (pErr) throw new Error(`Profiles read failed: ${pErr.message}`);
  const byId = new Map<string, any>((profiles || []).map((p: any) => [p.id, p]));
  return (members || []).map((m: any) => {
    const p = byId.get(m.user_id) || {};
    const email = String(p.email || '');
    return {
      memberId: m.id, organizationId: m.organization_id, userId: m.user_id, email,
      firstName: firstNameOf(p.full_name, email),
      companyId: p.default_company_id || null,
      locationKey: canonicalLocation(p.default_location_context),
      onList: !!m.quarterly_digest,
    };
  });
}

// The pre-created chat thread the email's button opens: the update as the
// first assistant turn, scoped like the member's view, owned by `userId`.
async function createDigestChat(
  admin: any, organizationId: string, userId: string, payload: DigestPayload,
): Promise<string | null> {
  const title = `${payload.period.quarter} update: ${payload.brand.name}, ${payload.scope.locationLabel}`;
  const scope = { company: payload.brand.name, locations: payload.scope.markets, jobFunctions: [] as string[] };
  const { data: conv, error } = await admin.from('chat_conversations')
    .insert({ organization_id: organizationId, user_id: userId, title, scope }).select('id').single();
  if (error || !conv) { console.error('digest chat create failed', error?.message); return null; }
  const { error: mErr } = await admin.from('chat_messages')
    .insert({ conversation_id: conv.id, role: 'assistant', content: digestMarkdown(payload) });
  if (mErr) console.error('digest chat message failed', mErr.message);
  return conv.id as string;
}

async function sendEmail(to: string, subject: string, html: string): Promise<string> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) throw new Error('RESEND_API_KEY is not set.');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend API error (${res.status}): ${await res.text()}`);
  const body = await res.json().catch(() => ({}));
  return String(body?.id || '');
}

// Numbers, prose, and (when a thread owner is given) the chat thread.
async function compose(
  admin: any, member: MemberView, chatOwnerUserId: string | null,
): Promise<{ payload: DigestPayload; html: string; subject: string; conversationId: string | null }> {
  if (!member.companyId) throw new Error(`${member.email} has no brand on their view yet.`);
  const ctx: ToolContext = { admin, organizationId: member.organizationId, requestId: genRequestId() };
  const payload = await buildDigestPayload(ctx, {
    companyId: member.companyId, locationKey: member.locationKey,
    recipient: { firstName: member.firstName, email: member.email },
    chatUrl: `${APP_URL}/chat`,
    chatNote: '',
  });
  payload.narrative = await writeNarrative(ctx, payload, member.companyId, member.locationKey);
  payload.chatNote = `A saved chat with this summary, scoped to ${payload.brand.name} ${payload.scope.preposition} ${payload.scope.locationLabel}. Ask it what sits behind any number.`;
  let conversationId: string | null = null;
  if (chatOwnerUserId) {
    conversationId = await createDigestChat(admin, member.organizationId, chatOwnerUserId, payload);
    if (conversationId) payload.chatUrl = `${APP_URL}/chat?c=${conversationId}`;
  }
  const html = renderDigestHtml(payload, { appUrl: ASSET_URL, logoDevToken: LOGO_DEV_TOKEN });
  return { payload, html, subject: digestSubject(payload), conversationId };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401);
    const { data: { user }, error: authError } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) return json({ error: 'Invalid authentication' }, 401);
    const { data: platformRole } = await admin.from('user_roles').select('user_id')
      .eq('user_id', user.id).eq('role', 'admin').maybeSingle();
    if (!platformRole) return json({ error: 'Platform admins only' }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body?.action as Action;

    if (action === 'preview' || action === 'send_test') {
      const [member] = await loadMembers(admin, { memberId: String(body?.memberId || '') });
      if (!member) return json({ error: 'Member not found' }, 404);
      if (action === 'preview') {
        const { payload, html, subject } = await compose(admin, member, null);
        return json({ html, subject, payload });
      }
      const callerEmail = user.email || '';
      if (!callerEmail) return json({ error: 'Your account has no email address' }, 400);
      const { payload, html, subject, conversationId } = await compose(admin, member, user.id);
      const resendId = await sendEmail(callerEmail, subject, html);
      return json({ sentTo: callerEmail, subject, resendId, conversationId, period: payload.period.quarter });
    }

    if (action === 'send') {
      if (body?.confirm !== true) return json({ error: 'Pass confirm: true to send to the list' }, 400);
      const organizationId = String(body?.organizationId || '');
      if (!organizationId) return json({ error: 'organizationId is required' }, 400);
      const members = (await loadMembers(admin, { organizationId })).filter(m => m.onList);
      if (!members.length) return json({ error: 'Nobody is on the send list for this organization' }, 400);
      const results: Array<Record<string, unknown>> = [];
      for (const member of members.slice(0, SEND_BATCH)) {
        const started = Date.now();
        try {
          const { payload, html, subject, conversationId } = await compose(admin, member, member.userId);
          const resendId = await sendEmail(member.email, subject, html);
          const { error: logErr } = await admin.from('quarterly_digest_sends').insert({
            organization_id: organizationId, member_id: member.memberId, user_id: member.userId,
            email: member.email, period: payload.period.quarter, subject, payload, resend_id: resendId,
            conversation_id: conversationId, sent_by: user.id, status: 'sent',
          });
          if (logErr) console.warn(`[digest] send log failed for ${member.email}: ${logErr.message}`);
          results.push({ email: member.email, status: 'sent', resendId, conversationId, ms: Date.now() - started });
        } catch (err: any) {
          console.error(`[digest] send failed for ${member.email}:`, err?.message || err);
          results.push({ email: member.email, status: 'failed', error: err?.message || String(err) });
        }
      }
      return json({ organizationId, attempted: results.length, results });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    console.error('quarterly-digest error:', err);
    return json({ error: err?.message || 'Unexpected error' }, 500);
  }
});
