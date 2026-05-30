import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        ...corsHeaders,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
      }
    })
  }

  try {
    const body = await req.json();

    const {
      prompt,
      enableWebSearch = true,
      batch = false,
      // Optional caller-overrides. Defaults preserve existing behaviour for
      // backend pipelines (Sonnet 4, 1500 max tokens). Dashboard AI summaries
      // pass `model: 'claude-haiku-4-5'` to use Haiku's higher rate-limit tier
      // and a smaller `maxTokens` for short structured outputs.
      model: requestedModel,
      maxTokens: requestedMaxTokens,
      // When true, also return the raw Claude content array for debugging.
      debug = false,
    } = body;

    if (!prompt) {
      throw new Error('Prompt is required');
    }

    const claudeApiKey = Deno.env.get('CLAUDE_API_KEY')

    if (!claudeApiKey) {
      console.error('CLAUDE_API_KEY not found in environment variables');
      throw new Error('Claude API key not configured')
    }

    // In batch mode (or when web search is explicitly disabled), omit tools entirely
    // to keep responses fast (~5-10s) and within Supabase edge function timeout limits.
    const useWebSearch = enableWebSearch && !batch;
    const model = typeof requestedModel === 'string' && requestedModel.length > 0
      ? requestedModel
      : 'claude-sonnet-4-20250514';
    const maxTokens = typeof requestedMaxTokens === 'number' && requestedMaxTokens > 0
      ? requestedMaxTokens
      : (batch ? 800 : 1500);

    console.log(`Making request to Claude API (model=${model}, batch=${batch}, webSearch=${useWebSearch}, maxTokens=${maxTokens})...`)

    const requestBody: Record<string, any> = {
      model,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
    };

    // Only include tools when web search is enabled. Pairing the tool with a
    // system instruction that asks Claude to search and cite produces
    // Perplexity-style answers grounded in (and citing) web sources.
    if (useWebSearch) {
      requestBody.tools = [{
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 5
      }];
      requestBody.system = "You are a research assistant. Use the web_search tool to find current, factual information before answering, and ground your answer in the sources you find. Always cite the sources you used.";
    }

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    })

    console.log('Claude API response status:', claudeResponse.status)

    const data = await claudeResponse.json()

    if (!claudeResponse.ok) {
      // Handle specific Claude API errors
      if (data.error?.type === 'authentication_error') {
        console.error('Claude API authentication error:', data.error);
        throw new Error('Claude API authentication failed - check API key')
      } else if (data.error?.type === 'rate_limit_error') {
        console.error('Claude API rate limit error:', data.error);
        return new Response(
          JSON.stringify({
            error: 'Claude API rate limit exceeded. Please wait a moment and try again.',
            details: data.error.message,
            retryAfter: 60000
          }),
          {
            status: 429,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Retry-After': '60'
            }
          }
        )
      } else if (data.error?.type === 'invalid_request_error') {
        console.error('Claude API invalid request error:', data.error);
        throw new Error(`Claude API invalid request: ${data.error.message}`)
      } else {
        console.error('Claude API error:', data.error);
        throw new Error(data.error?.message || `Claude API error: ${claudeResponse.status}`)
      }
    }

    const contentArray = data.content || [];

    // Build the full answer by concatenating ALL text blocks in order.
    // Web search responses interleave text blocks with server_tool_use and
    // web_search_tool_result blocks: Claude writes a sentence, searches,
    // writes more, searches again, etc. The complete answer is the
    // concatenation of every text block — NOT just the last one (the previous
    // implementation returned only the last block, which truncated most
    // web-search answers down to the final sentence or two).
    const response = contentArray
      .filter((block: any) => block.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text)
      .join('')
      .trim() || 'No response generated';

    // Extract Claude's native citations.
    const citations = extractClaudeCitations(contentArray);
    console.log(`Extracted ${citations.length} Claude citations`);

    if (data.usage?.server_tool_use?.web_search_requests) {
      console.log(`Web search requests made: ${data.usage.server_tool_use.web_search_requests}`);
    }

    const responseBody: Record<string, any> = {
      response,
      citations,
      webSearchEnabled: enableWebSearch,
      model: data.model,
      usage: data.usage,
    };

    // Optional raw payload for debugging/inspection of the citation structure.
    if (debug) {
      responseBody.rawContent = contentArray;
    }

    return new Response(
      JSON.stringify(responseBody),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    )
  } catch (error) {
    console.error('Error in Claude function:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    )
  }
})

/**
 * Extract Claude's native web-search citations from the response content array.
 *
 * IMPORTANT — Anthropic API response shape (web_search_20250305):
 * Citations are NOT top-level blocks. They are nested inside `text` blocks
 * under a `citations` array, where each citation object has the shape:
 *   { type: "web_search_result_location", url, title, cited_text, encrypted_index }
 *
 * The top-level `web_search_tool_result` blocks contain the raw search results
 * (`web_search_result` items with url/title/page_age) — these are every result
 * Claude looked at, not necessarily the ones it cited. We use the nested
 * citations as the primary source (these are what Claude actually grounded its
 * answer on, matching Perplexity's `citations`) and fall back to the raw search
 * results only when no inline citations are present.
 *
 * The previous implementation looked for top-level blocks of type
 * 'web_search_result_location' — which never exist at the top level — so
 * citations always came back empty. That was the root cause of this function
 * "never working".
 *
 * Output format matches Perplexity's citation structure for consistency with
 * how collect-company-responses and analyze-response consume citations.
 */
function extractClaudeCitations(contentArray: any[]): any[] {
  const citations: any[] = [];
  const seenUrls = new Set<string>();

  if (!Array.isArray(contentArray)) {
    return citations;
  }

  const toDomain = (url: string): string => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url || '';
    }
  };

  const push = (entry: { url?: string; title?: string; cited_text?: string }) => {
    const url = entry.url;
    if (!url || seenUrls.has(url)) return;
    seenUrls.add(url);
    citations.push({
      url,
      domain: toDomain(url),
      title: entry.title || toDomain(url),
      cited_text: entry.cited_text,
      type: 'website',
      confidence: 'high',
    });
  };

  // Primary: inline citations nested inside text blocks.
  for (const block of contentArray) {
    if (block?.type === 'text' && Array.isArray(block.citations)) {
      for (const c of block.citations) {
        if (c?.type === 'web_search_result_location' && c.url) {
          push({ url: c.url, title: c.title, cited_text: c.cited_text });
        }
      }
    }
  }

  // Fallback: if the model didn't emit inline citations but did run searches,
  // surface the raw search results so we still capture sources.
  if (citations.length === 0) {
    for (const block of contentArray) {
      if (block?.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const result of block.content) {
          if (result?.type === 'web_search_result' && result.url) {
            push({ url: result.url, title: result.title });
          }
        }
      }
    }
  }

  return citations;
}
