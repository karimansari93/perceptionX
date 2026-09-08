// ─── chat-with-data: the in-app "Ask PerceptionX" analyst ───────────────────
// Every PerceptionX user gets the same analyst ChatGPT and Claude get through
// the MCP connector: the same px-tools registry (numbers, links, job-function
// filters) and the same rulebook (_shared/px-tools/instructions.ts, imported
// verbatim by prompt.ts). What lives here is the transport:
//   * Supabase-JWT auth, then organization_members check for the claimed
//     organizationId — every tool call is scoped to that verified org and
//     every company_id is re-checked for ownership inside executeTool;
//   * the Claude loop on the official SDK (streaming, adaptive thinking,
//     prompt caching on the system block, refusal handling);
//   * SSE framing: {text}, {status}, {competitors}, {sources}, {error}, [DONE];
//   * a request log (chat_request_log) and a per-org daily cap
//     (chat_org_settings.daily_cap, default 300);
//   * the data-grounded starter questions (action: "starters") and the
//     scope options for the chat's scope bar (action: "scope");
//   * the question scope (body.scope: company / location / jobFunction from
//     the dashboard filters) appended to the user turn as an explicit
//     filter instruction — see scope.ts.
// Read-only: nothing here writes customer data.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";
import { corsHeaders } from "../_shared/cors.ts";
import { anthropicTools, executeTool, genRequestId, toolLabels } from "../_shared/px-tools/mod.ts";
import type { ToolContext } from "../_shared/px-tools/mod.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { getStarterQuestions } from "./starters.ts";
import { getScopeOptions, normalizeScope, scopeNote } from "./scope.ts";
import { collectCompetitors, collectSources } from "./sources.ts";
import type { SourceLink } from "./sources.ts";

const MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-opus-5';
const EFFORT = (Deno.env.get('CLAUDE_EFFORT') || 'high') as 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const MAX_TOKENS = 16000;
const MAX_TOOL_ROUNDS = 10;
const DEFAULT_DAILY_CAP = 300;
const HISTORY_WINDOW = 20;
const MAX_SOURCES = 40;
const REFUSAL_TEXT = "I can't help with that here.";

// ─── SSE helpers ────────────────────────────────────────────────────────────

const encoder = new TextEncoder();
const sseEvent = (data: Record<string, unknown>) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
const sseDone = () => encoder.encode(`data: [DONE]\n\n`);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─── Auth ───────────────────────────────────────────────────────────────────

async function authenticateAndAuthorize(
  req: Request,
  admin: any,
  organizationId: string,
): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'Missing authorization header' }, 401);

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) return jsonResponse({ error: 'Invalid authentication' }, 401);

  // The caller names the organization for routing; membership is verified
  // against the token's user, never trusted from the body.
  const { data: membership, error: memberError } = await admin
    .from('organization_members')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (memberError || !membership) return jsonResponse({ error: 'You do not have access to this organization' }, 403);

  return { userId: user.id };
}

// ─── Per-org settings + daily cap ───────────────────────────────────────────

async function checkDailyCap(admin: any, organizationId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: settings } = await admin
    .from('chat_org_settings')
    .select('enabled, daily_cap')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (settings && settings.enabled === false) {
    return { ok: false, message: 'Ask PerceptionX is switched off for your organisation. Contact team@perceptionx.ai if you think this is a mistake.' };
  }
  const cap = Number(settings?.daily_cap) > 0 ? Number(settings.daily_cap) : DEFAULT_DAILY_CAP;
  const dayStart = new Date().toISOString().slice(0, 10) + 'T00:00:00Z';
  const { count } = await admin
    .from('chat_request_log')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .neq('status', 'rate_limited')
    .gte('ts', dayStart);
  if ((count ?? 0) >= cap) {
    return {
      ok: false,
      message: `Your organisation has used today's ${cap} Ask PerceptionX questions. The limit resets at midnight UTC — the dashboard has the same numbers in the meantime.`,
    };
  }
  return { ok: true };
}

interface RequestLog {
  organization_id: string;
  user_id: string;
  conversation_id: string | null;
  model: string;
  tool_names: string[];
  rounds: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  first_token_ms: number | null;
  duration_ms: number;
  status: 'ok' | 'refusal' | 'rate_limited' | 'error';
  error: string | null;
}

async function writeLog(admin: any, entry: RequestLog): Promise<void> {
  const { error } = await admin.from('chat_request_log').insert(entry);
  if (error) console.error('chat_request_log insert failed:', error.message);
}

// ─── Main handler ───────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const requestId = genRequestId();
  try {
    const body = await req.json().catch(() => ({}));
    const { message, conversationHistory, organizationId, conversationId, action, scope: rawScope } = body ?? {};
    if (!organizationId || typeof organizationId !== 'string') return jsonResponse({ error: 'Organization ID is required' }, 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) return jsonResponse({ error: 'Server misconfigured' }, 500);
    const admin = createClient(supabaseUrl, supabaseServiceKey);

    const auth = await authenticateAndAuthorize(req, admin, organizationId);
    if (auth instanceof Response) return auth;
    const toolCtx: ToolContext = { admin, organizationId, requestId };

    // Starter questions for the welcome screen: cheap, cached, not capped.
    if (action === 'starters') {
      const result = await getStarterQuestions(toolCtx);
      return jsonResponse(result);
    }
    if (action === 'scope') {
      const result = await getScopeOptions(toolCtx, normalizeScope(rawScope).company);
      return jsonResponse(result);
    }

    if (!message || typeof message !== 'string' || !message.trim()) return jsonResponse({ error: 'Message is required' }, 400);

    const claudeApiKey = Deno.env.get('CLAUDE_API_KEY');
    if (!claudeApiKey) return jsonResponse({ error: 'AI service not configured' }, 500);

    const { data: orgData } = await admin.from('organizations').select('name').eq('id', organizationId).single();
    const orgName = orgData?.name || 'Your Organization';
    const systemPrompt = buildSystemPrompt(orgName);

    const logBase: RequestLog = {
      organization_id: organizationId,
      user_id: auth.userId,
      conversation_id: typeof conversationId === 'string' && /^[0-9a-f-]{36}$/i.test(conversationId) ? conversationId : null,
      model: MODEL,
      tool_names: [],
      rounds: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      first_token_ms: null,
      duration_ms: 0,
      status: 'ok',
      error: null,
    };

    const streamHeaders = {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    };

    // Daily cap: a friendly in-chat message, streamed like an answer.
    const cap = await checkDailyCap(admin, organizationId);
    if (!cap.ok) {
      console.warn(`[${requestId}] rate_limited org=${organizationId}`);
      await writeLog(admin, { ...logBase, status: 'rate_limited' });
      const capped = new ReadableStream<Uint8Array>({
        start(ctrl) { ctrl.enqueue(sseEvent({ text: cap.message })); ctrl.enqueue(sseDone()); ctrl.close(); },
      });
      return new Response(capped, { headers: streamHeaders });
    }

    console.log(`[${requestId}] chat start org="${orgName}" user=${auth.userId} scope=${JSON.stringify(normalizeScope(rawScope))} msg="${message.substring(0, 100)}"`);

    // History: the last N turns the client sent, as plain text turns.
    const messages: Anthropic.MessageParam[] = [];
    if (Array.isArray(conversationHistory)) {
      for (const m of conversationHistory.slice(-HISTORY_WINDOW)) {
        if ((m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string' && m.content.trim()) {
          messages.push({ role: m.role, content: m.content });
        }
      }
    }
    // The dashboard filters travel as a second text block on the user turn
    // (after the cached prefix), never inside the system prompt.
    const scope = normalizeScope(rawScope);
    const note = scopeNote(scope);
    messages.push({
      role: 'user',
      content: note
        ? [{ type: 'text', text: message.trim() }, { type: 'text', text: note }]
        : message.trim(),
    });

    const client = new Anthropic({ apiKey: claudeApiKey });
    let cancelled = false;
    let current: ReturnType<typeof client.messages.stream> | null = null;

    const runAnalyst = async (ctrl: ReadableStreamDefaultController<Uint8Array>) => {
      const tStart = Date.now();
      const log = { ...logBase };
      const sources = new Map<string, SourceLink>();
      const competitors = new Set<string>();
      let streamedText = '';
      const enqueue = (chunk: Uint8Array) => { if (!cancelled) { try { ctrl.enqueue(chunk); } catch { cancelled = true; } } };
      const finish = () => {
        if (cancelled) return;
        try { enqueue(sseDone()); ctrl.close(); } catch { /* closed */ }
      };

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          if (cancelled) break;
          log.rounds = round + 1;
          console.log(`[${requestId}] round ${round + 1}`);

          const turn = client.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            thinking: { type: 'adaptive' },
            output_config: { effort: EFFORT },
            // tools → system → messages is the cache render order; the
            // breakpoint on the system block caches both, and the prompt is
            // byte-stable per org.
            system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
            tools: anthropicTools as unknown as Anthropic.Tool[],
            messages,
          });
          current = turn;
          turn.on('text', (delta: string) => {
            if (log.first_token_ms === null) log.first_token_ms = Date.now() - tStart;
            streamedText += delta;
            enqueue(sseEvent({ text: delta }));
          });

          const reply = await turn.finalMessage();
          log.input_tokens += reply.usage.input_tokens ?? 0;
          log.output_tokens += reply.usage.output_tokens ?? 0;
          log.cache_read_tokens += reply.usage.cache_read_input_tokens ?? 0;
          console.log(`[${requestId}] round done stop=${reply.stop_reason} in=${reply.usage.input_tokens} cached=${reply.usage.cache_read_input_tokens ?? 0} out=${reply.usage.output_tokens}`);

          if (reply.stop_reason === 'refusal') {
            log.status = 'refusal';
            if (!streamedText.trim()) enqueue(sseEvent({ text: REFUSAL_TEXT }));
            break;
          }

          if (reply.stop_reason === 'pause_turn') {
            messages.push({ role: 'assistant', content: reply.content });
            continue;
          }

          const toolUses = reply.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
          if (reply.stop_reason !== 'tool_use' || toolUses.length === 0) break;

          // Keep thinking blocks intact: the assistant turn goes back verbatim.
          messages.push({ role: 'assistant', content: reply.content });
          enqueue(sseEvent({ status: toolUses.map(t => toolLabels[t.name] || t.name).join(' + ') + '...' }));

          // Every parallel tool_result returns in ONE user message; a failed
          // tool is an is_error result, never a dropped block.
          const results: Anthropic.ToolResultBlockParam[] = await Promise.all(toolUses.map(async (t) => {
            log.tool_names.push(t.name);
            const output = await executeTool(toolCtx, t.name, t.input);
            let parsed: any = null;
            try { parsed = JSON.parse(output); } catch { /* raw text */ }
            const isError = !!(parsed && typeof parsed === 'object' && parsed.error);
            if (parsed && !isError) { collectSources(parsed, sources); collectCompetitors(parsed, competitors); }
            return { type: 'tool_result', tool_use_id: t.id, content: output, ...(isError ? { is_error: true } : {}) };
          }));
          messages.push({ role: 'user', content: results });

          if (round === MAX_TOOL_ROUNDS - 1) {
            enqueue(sseEvent({ text: "I couldn't complete the analysis in time. Please try a more specific question." }));
          }
        }

        if (competitors.size) enqueue(sseEvent({ competitors: Array.from(competitors).slice(0, 40) }));
        if (sources.size) {
          const list = Array.from(sources.values())
            .sort((a, b) => (b.share ?? -1) - (a.share ?? -1))
            .slice(0, MAX_SOURCES)
            .map(({ title, url, domain }) => ({ title, url, domain }));
          enqueue(sseEvent({ sources: list }));
        }
      } catch (err: any) {
        if (!cancelled) {
          log.status = 'error';
          log.error = String(err?.message || err).slice(0, 500);
          const detail = err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : String(err?.message || err);
          console.error(`[${requestId}] stream error:`, detail);
          enqueue(sseEvent({ error: 'The analyst hit a problem answering that. Please try again.' }));
        }
      } finally {
        log.duration_ms = Date.now() - tStart;
        log.tool_names = Array.from(new Set(log.tool_names));
        finish();
        console.log(`[${requestId}] chat done status=${log.status} rounds=${log.rounds} tools=${log.tool_names.join(',')} ttft=${log.first_token_ms}ms ms=${log.duration_ms}`);
        await writeLog(admin, log);
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        runAnalyst(ctrl).catch(err => console.error(`[${requestId}] unhandled:`, err));
      },
      cancel() {
        cancelled = true;
        try { current?.abort(); } catch { /* already finished */ }
      },
    });

    return new Response(stream, { headers: streamHeaders });
  } catch (error: any) {
    console.error(`[${requestId}] fatal:`, error);
    return jsonResponse({ error: error?.message || 'Unexpected error' }, 500);
  }
});
