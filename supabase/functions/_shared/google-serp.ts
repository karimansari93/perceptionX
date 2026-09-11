// Shared Google AI Overview / AI Mode fetching, provider-switched.
//
// Two edge functions (test-prompt-google-ai-overviews, test-prompt-google-ai-mode)
// collect Google's AI Overview and AI Mode answers. Both return the same
// { response, citations } shape that analyze-response / collect-company-responses
// expect, so the provider is an implementation detail behind this module.
//
// Provider selection, per surface (decided 2026-09-11 after a like-for-like
// test: Scrapingdog's AI Mode payload carried ~2/3 of the references and ~1/2
// of the distinct source domains SerpAPI returned for the same queries on the
// same day, while its AI Overview capture was fine):
//   1. GOOGLE_AI_MODE_PROVIDER / GOOGLE_AI_OVERVIEW_PROVIDER, when set
//      ("serpapi" | "scrapingdog"), win for that surface.
//   2. Else GOOGLE_SERP_PROVIDER, when set — the global override / rollback lever.
//   3. Else the default for the surface:
//        AI Mode      → serpapi     if SERP_API_KEY is configured, else scrapingdog
//        AI Overviews → scrapingdog if SCRAPINGDOG_API_KEY is configured, else serpapi
//
// This file is the single source of truth. It merges the two hotfix bundles
// that were deployed without commits: 2026-08-04 (AI Mode: unwrap Google
// redirect wrappers, drop opaque ones, dedupe on destination) and 2026-08-05
// (AI Overviews: Scrapingdog block-capture retry, delayed fetch, and
// stripGoogleMarkers for the span markers its parser leaks into text).
//
// Localization: the prompt text is already in the target market's language
// (translate-prompts handles that at generation time). Additionally, the
// caller may pass the prompt's location_context; for Scrapingdog we resolve
// it to a two-letter `country` code — verified (2026-07-13) to roughly double
// AI Mode reference counts for Mexico/Thailand vs the default `us` geo.
// SerpAPI calls stay param-free, byte-for-byte like the original functions
// (and therefore like the July-2026 baselines they are compared against).

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

export type GoogleSurface = "ai_mode" | "ai_overview";

function normalizeProvider(v: string | undefined): "serpapi" | "scrapingdog" | null {
  const s = (v || "").trim().toLowerCase();
  return s === "serpapi" || s === "scrapingdog" ? s : null;
}

export function providerFor(surface: GoogleSurface): "serpapi" | "scrapingdog" {
  const perSurface = normalizeProvider(
    Deno.env.get(surface === "ai_mode" ? "GOOGLE_AI_MODE_PROVIDER" : "GOOGLE_AI_OVERVIEW_PROVIDER"),
  );
  if (perSurface) return perSurface;
  const global = normalizeProvider(Deno.env.get("GOOGLE_SERP_PROVIDER"));
  if (global) return global;
  const hasSerp = !!Deno.env.get("SERP_API_KEY");
  const hasDog = !!Deno.env.get("SCRAPINGDOG_API_KEY");
  if (surface === "ai_mode") return hasSerp ? "serpapi" : "scrapingdog";
  return hasDog ? "scrapingdog" : "serpapi";
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

// Strip Google's internal citation-position markers that Scrapingdog's AI
// Overview parser leaks into text (observed 2026-07-31, ~16% of AIO rows):
//   "CSL Seqirus18;"  "Behring0;"  ":0;423;"          — span indices glued to words
//   "write_to_target_document1a;"                      — internal directive tokens
//   "_zllsatHJNpKh5NoPr4ORoAw_70;"                     — internal ids
// AI Mode output does not contain these. Patterns are anchored to avoid
// eating legitimate text: markers are always digits (+ optional hex letter)
// directly glued to a non-space char and terminated by ";".
export function stripGoogleMarkers(text: string): string {
  if (!text) return text;
  let out = text;
  // Replace with a SPACE, not empty string: markers can sit BETWEEN two words
  // ("Regeneron Pharmaceuticals18;Genentech0;") and plain deletion silently
  // glues entity names together ("PharmaceuticalsGenentech") — worse for
  // entity detection than the marker itself. Tidy spacing afterwards.
  out = out.replace(/write_to_target_document[A-Za-z0-9]*;/g, " ");
  out = out.replace(/_[A-Za-z0-9_]{10,};/g, " ");
  // chains like ":0;423;" or "word0;423;" — repeat to consume sequences
  for (let i = 0; i < 3; i++) {
    out = out.replace(/(?<=[^\s;0-9])[0-9]{1,3}[a-f]?;/g, " ");
  }
  out = out.replace(/[ \t]{2,}/g, " ");      // collapse space runs (keep newlines)
  out = out.replace(/ ([.,;:!?%)\]])/g, "$1"); // no orphan space before punctuation
  out = out.replace(/([([]) /g, "$1");
  return out;
}

function renderTextBlocks(blocks: any[]): string {
  return stripGoogleMarkers(
    blocks
      .map(renderTextBlock)
      .filter((t: string) => t && t.trim())
      .join("\n\n"),
  );
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
//    plus a vendor-assembled scrapingdog_link (valid ~30s).
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
  //
  // Scrapingdog's capture of the block is non-deterministic per request: the
  // same query flips between block-present and block-absent call to call while
  // Google's UI serves the overview consistently (verified 2026-07-30 on CSL
  // queries: a single retry recovered 7/10 production misses). So when the
  // block is absent we retry the search once — this roughly triples first-pass
  // capture on flaky queries at +10 credits only on actual misses.
  const countryParam = country ? `&country=${country}` : "";
  let searchData: any;
  let aioUrl: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
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

    // Inline AI overview: content already in the search response — done in
    // one call (SerpAPI always needs two; this is Scrapingdog's cost edge).
    if (Array.isArray(searchData?.ai_overview?.text_blocks)) {
      return {
        response: renderTextBlocks(searchData.ai_overview.text_blocks),
        citations: collectCitations(searchData.ai_overview, searchData.ai_overview.text_blocks),
      };
    }

    // Prefer the vendor-assembled scrapingdog_link (valid ~30s from issuance);
    // fall back to constructing the fetch URL from the raw google async url.
    const sdLink = searchData?.ai_overview?.scrapingdog_link;
    if (typeof sdLink === "string" && sdLink.trim()) {
      aioUrl = null; // use sdLink directly below
      searchData._sdLink = /api_key=/.test(sdLink)
        ? sdLink
        : sdLink + (sdLink.includes("?") ? "&" : "?") + `api_key=${key}`;
      break;
    }
    aioUrl = findScrapingdogAioUrl(searchData);
    if (aioUrl) break;
    // Block absent — retry the search once.
  }

  const fetchUrl: string | null = searchData?._sdLink
    ? searchData._sdLink
    : aioUrl
    ? `https://api.scrapingdog.com/google/ai_overview?api_key=${key}&url=${encodeURIComponent(aioUrl)}`
    : null;

  if (!fetchUrl) {
    return {
      response:
        "No AI overview available for this query. This could be because the query is too specific or AI overviews are not available for this topic.",
      citations: [],
    };
  }

  // Step 2: fetch the AI overview. The link is valid ~30s; Google renders the
  // overview asynchronously, so wait ~5s before fetching — immediate fetches
  // occasionally return an empty body (57 cases in the 2026-07 CSL run),
  // while 3-6s delays went 8/8 in testing. One extra retry on empty.
  for (let attempt = 0; attempt < 2; attempt++) {
    await new Promise((r) => setTimeout(r, attempt === 0 ? 5000 : 4000));
    const res = await fetch(fetchUrl);
    const data = await res.json().catch(() => ({}));
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
  }
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
  const p = providerFor("ai_overview");
  console.log(`[google-serp] ai_overview provider=${p}`);
  return p === "scrapingdog"
    ? scrapingdogAiOverview(prompt, locationToScrapingdogCountry(locationContext))
    : serpapiAiOverview(prompt);
}

export async function fetchGoogleAiMode(
  prompt: string,
  locationContext?: string | null,
): Promise<SerpResult> {
  const p = providerFor("ai_mode");
  console.log(`[google-serp] ai_mode provider=${p}`);
  return p === "scrapingdog"
    ? scrapingdogAiMode(prompt, locationToScrapingdogCountry(locationContext))
    : serpapiAiMode(prompt);
}
