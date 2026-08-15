// Shared Google AI Overview / AI Mode fetching, provider-switched.
//
// Two edge functions (test-prompt-google-ai-overviews, test-prompt-google-ai-mode)
// collect Google's AI Overview and AI Mode answers. Both return the same
// { response, citations } shape that analyze-response / collect-company-responses
// expect, so the provider is an implementation detail behind this module.
//
// Provider selection:
//   1. GOOGLE_SERP_PROVIDER env var, when set ("serpapi" | "scrapingdog"),
//      always wins — this is the explicit rollback lever.
//   2. Otherwise: scrapingdog if SCRAPINGDOG_API_KEY is configured (the
//      2026-07 migration — SerpAPI plan lapsed), else serpapi.
//
// Localization: the prompt text is already in the target market's language
// (translate-prompts handles that at generation time). Additionally, the
// caller may pass the prompt's location_context; for Scrapingdog we resolve
// it to a two-letter `country` code — verified (2026-07-13) to roughly double
// AI Mode reference counts for Mexico/Thailand vs the default `us` geo.
// SerpAPI calls stay param-free, byte-for-byte like the original functions.

import { COUNTRY_NAME_TO_CODE } from "./countries.ts";
import { isUsableCitationUrl, unwrapRedirectUrl } from "./citation-extraction.ts";

export interface Citation {
  title?: string;
  url?: string;
  snippet?: string;
  source?: string;
}

export interface SerpResult {
  response: string;
  citations: Citation[];
}

function provider(): string {
  const explicit = (Deno.env.get("GOOGLE_SERP_PROVIDER") || "").toLowerCase();
  if (explicit) return explicit;
  return Deno.env.get("SCRAPINGDOG_API_KEY") ? "scrapingdog" : "serpapi";
}

// Free-text location_context ("Mexico", "the United Kingdom", "Burbank",
// "Global (All Countries)") → lowercase ISO country code, or null when the
// location isn't a country we know (cities, Global) — caller then omits the
// param and Scrapingdog defaults to `us`.
export function locationToScrapingdogCountry(location: string | null | undefined): string | null {
  if (!location) return null;
  const trimmed = location.trim();
  if (!trimmed || /^global/i.test(trimmed)) return null;
  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper.toLowerCase();
  const withoutThe = trimmed.replace(/^the\s+/i, "");
  const code = COUNTRY_NAME_TO_CODE[trimmed] || COUNTRY_NAME_TO_CODE[withoutThe];
  return code ? code.toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// Shared parsing helpers (tolerant to SerpAPI and Scrapingdog block shapes)
// ---------------------------------------------------------------------------

// Render one AI text_block to plain text. Handles both providers' shapes:
// - paragraph:  { type, snippet | text }
// - heading:    { type, snippet | text }
// - list:       SerpAPI uses `list: [{title?, snippet}]`; Scrapingdog AI Mode
//               uses `items: [{title?, snippet, text_blocks?}]`.
// - table:      { table: { headers, rows } } (SerpAPI AI Mode)
function renderTextBlock(block: any): string {
  if (!block || typeof block !== "object") return "";
  const text = block.snippet ?? block.text ?? "";

  const listItems = Array.isArray(block.list)
    ? block.list
    : Array.isArray(block.items)
    ? block.items
    : null;

  switch (block.type) {
    case "heading":
      return text ? `\n${text}\n` : "";
    case "list":
      if (listItems) {
        return listItems
          .map((item: any) => {
            // A list item may nest its own text_blocks (Scrapingdog AI Mode).
            if (Array.isArray(item?.text_blocks)) {
              const nested = item.text_blocks
                .map((tb: any) => tb?.snippet ?? tb?.text ?? "")
                .filter((s: string) => s && s.trim())
                .join(" ");
              if (nested) return `• ${nested}`;
            }
            const title = item?.title ? `${item.title}` : "";
            const snip = item?.snippet ?? item?.text ?? "";
            if (title && snip) return `• ${title}: ${snip}`;
            return `• ${title || snip}`;
          })
          .filter((s: string) => s && s.trim() && s !== "• ")
          .join("\n");
      }
      return text;
    case "table":
      if (block.table) {
        const headers = Array.isArray(block.table.headers)
          ? block.table.headers.join(" | ")
          : "";
        const rows = Array.isArray(block.table.rows)
          ? block.table.rows
              .map((row: any) => (Array.isArray(row) ? row.join(" | ") : String(row)))
              .join("\n")
          : "";
        return headers ? `${headers}\n${rows}` : rows;
      }
      return text;
    default:
      return text;
  }
}

function renderTextBlocks(blocks: any[]): string {
  return blocks
    .map(renderTextBlock)
    .filter((t: string) => t && t.trim())
    .join("\n\n");
}

// Collect citations from any references/sources/links array(s) at root or
// nested in blocks. Deduped by URL. Handles both `link` and `url` naming.
// `links` matters for Scrapingdog AI Mode: inline source links live in
// per-block `links: [{anchor, link}]` (verified live 2026-07-08).
//
// Google hands many of these back as redirect wrappers
// (www.google.com/url?sa=i&...&url=<real>&ved=...), so every URL is unwrapped
// to its real destination BEFORE the dedupe check — several wrappers routinely
// point at the same page, and deduping on the wrapper counted each one as a
// separate citation for google.com. Wrappers whose target is an opaque token
// (google.com/url?url=CAES...) or a search-UI surface (google.com/searchviewer)
// have no source behind them and are dropped.
function collectCitations(searchData: any, blocks: any[]): Citation[] {
  const citations: Citation[] = [];
  const seen = new Set<string>();

  const addRef = (ref: any) => {
    if (!ref || typeof ref !== "object") return;
    const rawUrl = ref.link || ref.url || ref.href;
    if (!rawUrl || typeof rawUrl !== "string") return;
    const url = unwrapRedirectUrl(rawUrl);
    if (!isUsableCitationUrl(url) || seen.has(url)) return;
    seen.add(url);
    citations.push({
      title: ref.title || ref.name || ref.anchor || undefined,
      url,
      snippet: ref.snippet || ref.description,
      source: ref.source || ref.displayed_link,
    });
  };

  for (const key of ["references", "sources"]) {
    if (Array.isArray(searchData?.[key])) searchData[key].forEach(addRef);
  }
  for (const block of blocks || []) {
    for (const key of ["references", "sources", "links"]) {
      if (Array.isArray(block?.[key])) block[key].forEach(addRef);
    }
    const listItems = Array.isArray(block?.list)
      ? block.list
      : Array.isArray(block?.items)
      ? block.items
      : [];
    for (const item of listItems) {
      for (const key of ["references", "sources", "links"]) {
        if (Array.isArray(item?.[key])) item[key].forEach(addRef);
      }
    }
  }
  return citations;
}

// ---------------------------------------------------------------------------
// SerpAPI provider (original behaviour, preserved)
// ---------------------------------------------------------------------------

async function serpapiAiOverview(prompt: string): Promise<SerpResult> {
  const key = Deno.env.get("SERP_API_KEY");
  if (!key) {
    return {
      response:
        "Google AI Overviews is not configured. Please set SERP_API_KEY to enable this feature.",
      citations: [],
    };
  }

  // Step 1: regular Google search to get ai_overview.page_token
  let searchData: any;
  try {
    const res = await fetch(
      `https://serpapi.com/search?engine=google&q=${encodeURIComponent(prompt)}&api_key=${key}`,
    );
    searchData = await res.json();
    if (!res.ok) {
      return {
        response: `Google search API error: ${searchData.error || "unexpected error"}`,
        citations: [],
      };
    }
  } catch (e: any) {
    return { response: `Failed to fetch search results: ${e.message}`, citations: [] };
  }

  if (!searchData.ai_overview || !searchData.ai_overview.page_token) {
    return {
      response:
        "No AI overview available for this query. This could be because the query is too specific or AI overviews are not available for this topic.",
      citations: [],
    };
  }

  // Step 2: fetch AI overview via page_token
  const res = await fetch(
    `https://serpapi.com/search?engine=google_ai_overview&page_token=${searchData.ai_overview.page_token}&api_key=${key}`,
  );
  const data = await res.json();
  if (!res.ok) {
    return {
      response: `Google AI Overview API error: ${data.error || "unexpected error"}`,
      citations: [],
    };
  }

  if (data.ai_overview?.text_blocks) {
    return {
      response: renderTextBlocks(data.ai_overview.text_blocks),
      citations: collectCitations(data.ai_overview, data.ai_overview.text_blocks),
    };
  }
  if (data.ai_overview?.error) {
    return { response: `AI Overview error: ${data.ai_overview.error}`, citations: [] };
  }
  return { response: "No response generated", citations: [] };
}

async function serpapiAiMode(prompt: string): Promise<SerpResult> {
  const key = Deno.env.get("SERP_API_KEY");
  if (!key) {
    return {
      response:
        "Google AI Mode is not configured. Please set SERP_API_KEY to enable this feature.",
      citations: [],
    };
  }

  let data: any;
  try {
    const res = await fetch(
      `https://serpapi.com/search?engine=google_ai_mode&q=${encodeURIComponent(prompt)}&api_key=${key}`,
    );
    data = await res.json();
    if (!res.ok) {
      return {
        response: `Google AI Mode API error: ${data.error || "unexpected error"}`,
        citations: [],
      };
    }
  } catch (e: any) {
    return { response: `Failed to fetch Google AI Mode results: ${e.message}`, citations: [] };
  }

  if (Array.isArray(data.text_blocks)) {
    return {
      response: renderTextBlocks(data.text_blocks),
      citations: collectCitations(data, data.text_blocks),
    };
  }
  if (data.error) return { response: `Google AI Mode error: ${data.error}`, citations: [] };
  return { response: "No response generated", citations: [] };
}

// ---------------------------------------------------------------------------
// Scrapingdog provider
// ---------------------------------------------------------------------------

// Scrapingdog surfaces AI Overviews two ways (docs: ai-overviews-result):
//  - rendered inline: search response carries ai_overview.text_blocks +
//    references directly — no second call (and no second credit) needed;
//  - not rendered: ai_overview carries a fallback URL (google.com/async/...)
//    to pass to the /google/ai_overview endpoint. It expires in ~2 minutes.
function findScrapingdogAioUrl(searchData: any): string | null {
  const candidates = [
    searchData?.ai_overview?.url,
    searchData?.ai_overview?.link,
    searchData?.ai_overview_url,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

// Exported for the parity test harness (zz-temp-serp-parity) so acceptance
// tests exercise this exact parsing code rather than a copy.
export async function scrapingdogAiOverview(prompt: string, country?: string | null): Promise<SerpResult> {
  const key = Deno.env.get("SCRAPINGDOG_API_KEY");
  if (!key) {
    return {
      response:
        "Google AI Overviews is not configured. Please set SCRAPINGDOG_API_KEY to enable this feature.",
      citations: [],
    };
  }

  // Step 1: Google search to obtain the AI-overview URL. advance_search=true
  // is REQUIRED — without it Scrapingdog omits the ai_overview block entirely
  // (verified live 2026-07-08; costs 10 credits instead of 5).
  const countryParam = country ? `&country=${country}` : "";
  let searchData: any;
  try {
    const res = await fetch(
      `https://api.scrapingdog.com/google?api_key=${key}&query=${encodeURIComponent(prompt)}&advance_search=true${countryParam}`,
    );
    searchData = await res.json();
    if (!res.ok) {
      return {
        response: `Google search API error: ${searchData?.message || searchData?.error || "unexpected error"}`,
        citations: [],
      };
    }
  } catch (e: any) {
    return { response: `Failed to fetch search results: ${e.message}`, citations: [] };
  }

  // Inline AI overview: content is already in the search response — done in
  // one call (SerpAPI always needs two; this is Scrapingdog's cost edge).
  if (Array.isArray(searchData?.ai_overview?.text_blocks)) {
    return {
      response: renderTextBlocks(searchData.ai_overview.text_blocks),
      citations: collectCitations(searchData.ai_overview, searchData.ai_overview.text_blocks),
    };
  }

  const aioUrl = findScrapingdogAioUrl(searchData);
  if (!aioUrl) {
    return {
      response:
        "No AI overview available for this query. This could be because the query is too specific or AI overviews are not available for this topic.",
      citations: [],
    };
  }

  // Step 2: fetch the AI overview via its URL (expires ~2 min).
  const res = await fetch(
    `https://api.scrapingdog.com/google/ai_overview?api_key=${key}&url=${encodeURIComponent(aioUrl)}`,
  );
  const data = await res.json();
  if (!res.ok) {
    return {
      response: `Google AI Overview API error: ${data?.message || data?.error || "unexpected error"}`,
      citations: [],
    };
  }

  const ao = data.ai_overview ?? data;
  if (Array.isArray(ao?.text_blocks)) {
    return {
      response: renderTextBlocks(ao.text_blocks),
      citations: collectCitations(ao, ao.text_blocks),
    };
  }
  if (ao?.error) return { response: `AI Overview error: ${ao.error}`, citations: [] };
  return { response: "No response generated", citations: [] };
}

export async function scrapingdogAiMode(prompt: string, country?: string | null): Promise<SerpResult> {
  const key = Deno.env.get("SCRAPINGDOG_API_KEY");
  if (!key) {
    return {
      response:
        "Google AI Mode is not configured. Please set SCRAPINGDOG_API_KEY to enable this feature.",
      citations: [],
    };
  }

  const countryParam = country ? `&country=${country}` : "";
  let data: any;
  try {
    const res = await fetch(
      `https://api.scrapingdog.com/google/ai_mode?api_key=${key}&query=${encodeURIComponent(prompt)}${countryParam}`,
    );
    data = await res.json();
    if (!res.ok) {
      return {
        response: `Google AI Mode API error: ${data?.message || data?.error || "unexpected error"}`,
        citations: [],
      };
    }
  } catch (e: any) {
    return { response: `Failed to fetch Google AI Mode results: ${e.message}`, citations: [] };
  }

  if (Array.isArray(data.text_blocks)) {
    return {
      response: renderTextBlocks(data.text_blocks),
      citations: collectCitations(data, data.text_blocks),
    };
  }
  if (data.error) return { response: `Google AI Mode error: ${data.error}`, citations: [] };
  return { response: "No response generated", citations: [] };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchGoogleAiOverview(
  prompt: string,
  locationContext?: string | null,
): Promise<SerpResult> {
  return provider() === "scrapingdog"
    ? scrapingdogAiOverview(prompt, locationToScrapingdogCountry(locationContext))
    : serpapiAiOverview(prompt);
}

export async function fetchGoogleAiMode(
  prompt: string,
  locationContext?: string | null,
): Promise<SerpResult> {
  return provider() === "scrapingdog"
    ? scrapingdogAiMode(prompt, locationToScrapingdogCountry(locationContext))
    : serpapiAiMode(prompt);
}
