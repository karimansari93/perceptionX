import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"

// DeepSeek only runs server-side web search on its Anthropic-compatible
// endpoint; the OpenAI-compatible /v1/chat/completions silently ignores search
// tools. So we speak the Anthropic Messages format here and read citations the
// same way test-prompt-claude does.
const DEEPSEEK_ANTHROPIC_URL = 'https://api.deepseek.com/anthropic/v1/messages'

// deepseek-flash is DeepSeek's default chat model (deepseek-v4-pro is the
// heavier option), so it is the closer match to what DeepSeek app users get.
const PRIMARY_MODEL = 'deepseek-flash'

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
      model: requestedModel,
      maxTokens: requestedMaxTokens,
      debug = false,
    } = body;

    if (!prompt) {
      throw new Error('Prompt is required');
    }

    const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY')
    if (!deepseekApiKey) {
      throw new Error('DeepSeek API key not configured')
    }

    const model = typeof requestedModel === 'string' && requestedModel.length > 0
      ? requestedModel
      : PRIMARY_MODEL;
    const maxTokens = typeof requestedMaxTokens === 'number' && requestedMaxTokens > 0
      ? requestedMaxTokens
      : 1500;

    const requestBody: Record<string, any> = {
      model,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
    };

    if (enableWebSearch) {
      requestBody.tools = [{
        type: "web_search_20250305",
        name: "web_search",
        // Same cap as test-prompt-claude: each extra search round re-bills the
        // retrieved pages as input tokens for little extra citation coverage.
        max_uses: 3
      }];
      requestBody.system = "You are a research assistant. Use the web_search tool to find current, factual information before answering, and ground your answer in the sources you find. Always cite the sources you used.";
    }

    console.log(`Making request to DeepSeek API (model=${model}, webSearch=${enableWebSearch}, maxTokens=${maxTokens})...`)

    const deepseekResponse = await fetch(DEEPSEEK_ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': deepseekApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    })

    console.log('DeepSeek API response status:', deepseekResponse.status)
    const data = await deepseekResponse.json()

    if (!deepseekResponse.ok) {
      if (deepseekResponse.status === 429) {
        return new Response(
          JSON.stringify({
            error: 'DeepSeek API rate limit exceeded. Please wait a moment and try again.',
            details: data.error?.message,
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
      }
      console.error('DeepSeek API error:', data.error);
      throw new Error(data.error?.message || `DeepSeek API error: ${deepseekResponse.status}`)
    }

    const contentArray = data.content || [];

    const response = contentArray
      .filter((block: any) => block.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text)
      .join('')
      .trim() || 'No response generated';

    const citations = extractDeepSeekCitations(contentArray);
    console.log(`Extracted ${citations.length} DeepSeek citations`);

    const responseBody: Record<string, any> = {
      response,
      citations,
      webSearchEnabled: enableWebSearch,
      model: data.model,
      usage: data.usage,
    };

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
    console.error('Error in DeepSeek function:', error)
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

// Same shape as test-prompt-claude's extractor. DeepSeek documents
// web_search_tool_result support but not inline text citations, so the
// search-result fallback is what normally fires here.
function extractDeepSeekCitations(contentArray: any[]): any[] {
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

  // Fallback: surface the raw search results so we still capture sources.
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
