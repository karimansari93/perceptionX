import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import {
  anthropicTools, executeTool, genRequestId, toolLabels,
} from "../_shared/px-tools/mod.ts"
import type { ToolContext } from "../_shared/px-tools/mod.ts"

// The in-app "Employer Perception Analyst". Tool definitions, executors, and
// tenancy checks live in _shared/px-tools — the SAME layer the MCP server
// exposes to ChatGPT/Claude — so this chat doubles as the development/eval
// harness for that surface: same tools, same numbers, same coverage signals.
// What stays here: Supabase-JWT auth, the Anthropic streaming loop, SSE
// framing, and the analyst system prompt.

// ─── System Prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(orgName: string): string {
  return `You are a senior employer brand analyst for ${orgName}, with access to their PerceptionX data — a platform that tracks how AI models like ChatGPT, Claude, Gemini, and Perplexity describe the company to job seekers.

Your job is to give insightful, data-grounded answers that feel like they're coming from a knowledgeable analyst who's reviewed the data — not from a query engine.

## HARD RULES — NON-NEGOTIABLE

1. **Only answer from tool results.** Never use general knowledge about ${orgName} or any company, industry, or market. If a tool didn't return it, you don't know it. Do not hallucinate metrics, sources, competitors, themes, or quotes.

2. **Honor coverage signals.** Every tool return includes a \`_coverage\` field with \`status\` of \`found\`, \`partial\`, or \`no_data\`. You MUST read this field on every tool result.
   - \`no_data\` → Tell the user directly that this data isn't tracked yet for their organization. Example phrasings: "We haven't collected data on that yet." / "There are no AI responses for [topic] in your dataset." / "That market isn't covered in your current tracking." Do NOT invent an answer.
   - \`partial\` → Answer from what's available and explicitly name what's missing (e.g. "3 of your 5 companies have no response data yet, so this comparison excludes them").
   - \`found\` → Answer normally.

3. **Tenant isolation — strict.** You are scoped to ${orgName} only. You do not have visibility into any other organization's data. Never mention, reference, speculate about, or imply the existence of other customers, companies outside this organization, or cross-tenant comparisons. If asked something like "how do we compare to other PerceptionX customers?", respond that you can only see this organization's data.

4. **No speculation about missing markets or segments.** If the user asks about a country, language, market, time period, or segment that the tools don't return, say so plainly. Do not extrapolate, estimate, or use world knowledge to fill gaps.

5. **Refusal is honest.** A clear "we don't have data for X" is a correct answer. It is strictly better than inventing one.

## HOW TO USE TOOLS

**Batch calls aggressively.** Call multiple tools in parallel when you need data from different angles.

**Preferred workflow:**
1. If you don't know company IDs: call \`list_companies\` first. This also reveals which companies have zero data yet.
2. "How are we doing?" → \`get_company_overview\` (metrics + themes + competitors + citations in one shot)
3. Market/location questions ("how's our culture in India?", "visibility in Japan?") → the location-aware tools: \`get_attribute_themes\`, \`get_visibility\`, \`get_sources\`, \`get_competitor_landscape\`, \`get_trends\`. They aggregate the brand scope (same-name market profiles) and match the dashboard.
4. "What do AI models say about X" → \`get_responses\` with a relevant \`prompt_type\`, or \`search_responses\` for a specific topic
5. Citation/source questions → \`get_citations\` (single profile) or \`get_sources\` (brand scope, location filter, answer-gap ranking). Use \`gap_only: true\` for "where should we be mentioned but aren't?"
6. Competitor questions → \`get_competitor_landscape\` (supports location + attribute lens); \`get_competitors\` for one raw profile
7. Employer brand depth → \`get_attribute_breakdown\`, or \`get_attribute_themes\` for one attribute with quotes
8. Comparing locations/subsidiaries → \`compare_companies\`
9. Trends over time → \`get_trends\`

**Honesty notes baked into the data (repeat them when relevant):**
- Competitor "share of voice on an attribute" = who gets NAMED when that attribute comes up. It is NOT a claim that the competitor is rated better. Competitor-sentiment triples only accrue from Aug 2026 forward.
- Sentiment (methodology v2) = positive / (positive + negative) theme labels; neutral themes are excluded. The numeric sentiment_score column is internal-only and never quoted.
- Models claude, gemini and deepseek are excluded from all published metrics (the tools already filter them).
- Results carry \`_meta.data_as_of\` (rollup freshness) and the exact market spellings matched — mention freshness when the user asks about "now".
- EPS = 50% sentiment + 30% visibility + 20% relevance.

## HOW TO RESPOND

- Lead with insight, not raw data dumps. Tell a story about what the data means.
- Use specific numbers and quote/paraphrase actual AI model responses when relevant.
- Be direct about weaknesses — users need honest analysis, not spin.
- Use markdown for readability but keep it concise.
- When a tool result is \`partial\` or \`no_data\`, state the gap before discussing what you do have.
- If you notice something surprising or concerning, call it out proactively.
- Max 2–3 tool rounds before producing your answer.`;
}

// ─── SSE helpers ────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

function sseEvent(data: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

function sseDone(): Uint8Array {
  return encoder.encode(`data: [DONE]\n\n`);
}

// ─── Auth ───────────────────────────────────────────────────────────────────

async function authenticateAndAuthorize(
  req: Request,
  supabaseAdmin: any,
  organizationId: string
): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: 'Missing authorization header' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: 'Invalid authentication' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const { data: membership, error: memberError } = await supabaseAdmin
    .from('organization_members')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (memberError || !membership) {
    return new Response(
      JSON.stringify({ error: 'You do not have access to this organization' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return { userId: user.id };
}

// ─── Main Handler ───────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const requestId = genRequestId();
  try {
    const { message, conversationHistory, organizationId } = await req.json();

    if (!message) throw new Error('Message is required');
    if (!organizationId) throw new Error('Organization ID is required');

    const claudeApiKey = Deno.env.get('CLAUDE_API_KEY');
    if (!claudeApiKey) throw new Error('Claude API key not configured');

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) throw new Error('Supabase configuration missing');

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Auth: verify JWT, then verify caller belongs to the claimed org.
    // The caller passes organizationId in the body for routing, but we
    // validate membership against the token's user — the body is never
    // trusted on its own. Every tool call is subsequently scoped to the
    // verified organizationId, and every company_id argument is re-checked
    // for ownership inside executeTool.
    const authResult = await authenticateAndAuthorize(req, supabaseAdmin, organizationId);
    if (authResult instanceof Response) return authResult;

    const { data: orgData } = await supabaseAdmin
      .from('organizations')
      .select('name')
      .eq('id', organizationId)
      .single();

    const orgName = orgData?.name || 'Your Organization';
    const systemPrompt = buildSystemPrompt(orgName);

    console.log(`[${requestId}] chat start org="${orgName}" user=${authResult.userId} msg="${message.substring(0, 100)}"`);

    const toolCtx: ToolContext = { admin: supabaseAdmin, organizationId, requestId };

    const apiMessages: any[] = [];
    if (conversationHistory && Array.isArray(conversationHistory)) {
      for (const msg of conversationHistory) {
        apiMessages.push({ role: msg.role, content: msg.content });
      }
    }
    apiMessages.push({ role: 'user', content: message });

    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { streamController = controller; },
    });

    const responsePromise = (async () => {
      const ctrl = streamController!;
      const tStart = Date.now();
      try {
        let currentMessages = [...apiMessages];
        const MAX_TOOL_ROUNDS = 10;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          console.log(`[${requestId}] round ${round + 1}`);

          const streamResult = await handleStreamingRound(
            ctrl, claudeApiKey, systemPrompt, currentMessages, toolCtx, requestId
          );

          if (streamResult.done) {
            ctrl.enqueue(sseDone());
            ctrl.close();
            console.log(`[${requestId}] chat done rounds=${round + 1} ms=${Date.now() - tStart}`);
            return;
          }

          currentMessages = streamResult.messages;
        }

        console.error(`[${requestId}] exhausted tool rounds`);
        ctrl.enqueue(sseEvent({ text: "I couldn't complete the analysis in time. Please try a more specific question." }));
        ctrl.enqueue(sseDone());
        ctrl.close();
      } catch (err: any) {
        console.error(`[${requestId}] stream error:`, err);
        try {
          ctrl.enqueue(sseEvent({ error: err.message || 'An unexpected error occurred.' }));
          ctrl.enqueue(sseDone());
          ctrl.close();
        } catch { /* already closed */ }
      }
    })();

    responsePromise.catch(err => console.error('Unhandled stream error:', err));

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: any) {
    console.error(`[${requestId}] fatal:`, error);
    return new Response(
      JSON.stringify({ error: error.message, requestId }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ─── Streaming Round Handler ────────────────────────────────────────────────

async function handleStreamingRound(
  ctrl: ReadableStreamDefaultController<Uint8Array>,
  claudeApiKey: string,
  systemPrompt: string,
  currentMessages: any[],
  toolCtx: ToolContext,
  requestId: string
): Promise<{ done: boolean; messages: any[] }> {
  // Default to Opus 4.7 — best reasoning + refusal judgment for this
  // feature. Operators can override via CLAUDE_MODEL env var if needed.
  const model = Deno.env.get('CLAUDE_MODEL') || 'claude-opus-4-7';
  const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': claudeApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: currentMessages,
      tools: anthropicTools,
      stream: true,
    }),
  });

  if (!claudeResponse.ok) {
    const errorText = await claudeResponse.text();
    console.error(`[${requestId}] claude error ${claudeResponse.status}:`, errorText);
    throw new Error('AI service error');
  }

  const reader = claudeResponse.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let stopReason = '';
  const contentBlocks: any[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      let event: any;
      try { event = JSON.parse(data); } catch { continue; }

      switch (event.type) {
        case 'content_block_start':
          if (event.content_block?.type === 'tool_use') {
            contentBlocks[event.index] = {
              type: 'tool_use',
              id: event.content_block.id,
              name: event.content_block.name,
              input: '',
            };
          } else if (event.content_block?.type === 'text') {
            contentBlocks[event.index] = { type: 'text', text: '' };
          }
          break;

        case 'content_block_delta':
          if (event.delta?.type === 'text_delta' && event.delta.text) {
            if (contentBlocks[event.index]) contentBlocks[event.index].text += event.delta.text;
            ctrl.enqueue(sseEvent({ text: event.delta.text }));
          } else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
            if (contentBlocks[event.index]) contentBlocks[event.index].input += event.delta.partial_json;
          }
          break;

        case 'message_delta':
          stopReason = event.delta?.stop_reason || '';
          break;
      }
    }
  }

  for (const block of contentBlocks) {
    if (block?.type === 'tool_use' && typeof block.input === 'string') {
      try { block.input = JSON.parse(block.input || '{}'); } catch { block.input = {}; }
    }
  }

  console.log(`[${requestId}] round done stop=${stopReason} blocks=${contentBlocks.filter(Boolean).length}`);

  if (stopReason !== 'tool_use') {
    return { done: true, messages: currentMessages };
  }

  const toolBlocks = contentBlocks.filter((b: any) => b?.type === 'tool_use');
  if (!toolBlocks.length) return { done: true, messages: currentMessages };

  const updatedMessages = [...currentMessages, { role: 'assistant', content: contentBlocks.filter(Boolean) }];

  const toolNames = toolBlocks.map((b: any) => toolLabels[b.name] || b.name);
  ctrl.enqueue(sseEvent({ status: toolNames.join(' + ') + '...' }));

  const toolResults = await Promise.all(
    toolBlocks.map(async (block: any) => {
      const output = await executeTool(toolCtx, block.name, block.input);
      return { type: 'tool_result' as const, tool_use_id: block.id, content: output };
    })
  );

  updatedMessages.push({ role: 'user', content: toolResults });
  return { done: false, messages: updatedMessages };
}
