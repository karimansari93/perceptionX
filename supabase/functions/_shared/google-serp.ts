// Shared Google AI Overview / AI Mode fetching, provider-switched.
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
// Single source of truth; merges the 2026-08-04 (AI Mode unwrap/dedupe) and
// 2026-08-05 (AI Overviews retry + stripGoogleMarkers) hotfix bundles.

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

export function stripGoogleMarkers(text: string): string {
  if (!text) return text;
  let out = text;
  out = out.replace(/write_to_target_document[A-Za-z0-9]*;/g, " ");
  out = out.replace(/_[A-Za-z0-9_]{10,};/g, " ");
  for (let i = 0; i < 3; i++) {
    out = out.replace(/(?<=[^\s;0-9])[0-9]{1,3}[a-f]?;/g, " ");
  }
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/ ([.,;:!?%)\]])/g, "$1");
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

async function serpapiAiOverview(prompt: string): Promise<SerpResult> {
  const key = Deno.env.get("SERP_API_KEY");
  if (!key) {
    return {
      response:
        "Google AI Overviews is not configured. Please set SERP_API_KEY to enable this feature.",
      citations: [],
    };
  }

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

// Scrapingdog's advance_search Google endpoint fails intermittently with a
// 400 "Something went wrong, please try again" after ~15-25s (measured
// 2026-09-25: 4 of 7 identical calls). Failed calls are not billed, so retry
// them while there is time left in the edge-function budget. The deadline is
// shared by every search in one AI Overviews call (a no-overview query searches
// twice), leaving room for the overview fetch inside the 150s function limit.
const SD_SEARCH_MAX_ATTEMPTS = 4;
const SD_SEARCH_BUDGET_MS = 95_000;
// A failing attempt takes up to ~25s; don't start one that can't finish in time.
const SD_SEARCH_ATTEMPT_MS = 25_000;

async function scrapingdogSearch(
  url: string,
  deadline: number,
): Promise<{ ok: true; data: any } | { ok: false; message: string }> {
  let message = "unexpected error";
  for (let attempt = 1; attempt <= SD_SEARCH_MAX_ATTEMPTS; attempt++) {
    let status = 0;
    try {
      const res = await fetch(url);
      status = res.status;
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, data };
      message = data?.message || data?.error || `HTTP ${res.status}`;
    } catch (e: any) {
      message = e?.message || String(e);
    }
    // Bad key / no plan won't fix itself on retry.
    if (status === 401 || status === 403) break;
    const wait = 2000 * attempt;
    if (attempt === SD_SEARCH_MAX_ATTEMPTS || Date.now() + wait + SD_SEARCH_ATTEMPT_MS > deadline) break;
    console.warn(`[google-serp] scrapingdog search attempt ${attempt} failed (${status || "network"}: ${message}); retrying`);
    await new Promise((r) => setTimeout(r, wait));
  }
  return { ok: false, message };
}

export async function scrapingdogAiOverview(prompt: string, country?: string | null): Promise<SerpResult> {
  const key = Deno.env.get("SCRAPINGDOG_API_KEY");
  if (!key) {
    return {
      response:
        "Google AI Overviews is not configured. Please set SCRAPINGDOG_API_KEY to enable this feature.",
      citations: [],
    };
  }

  const countryParam = country ? `&country=${country}` : "";
  const searchDeadline = Date.now() + SD_SEARCH_BUDGET_MS;
  let searchData: any;
  let aioUrl: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const search = await scrapingdogSearch(
      `https://api.scrapingdog.com/google?api_key=${key}&query=${encodeURIComponent(prompt)}&advance_search=true${countryParam}`,
      searchDeadline,
    );
    if (!search.ok) {
      return {
        response: `Google search API error: ${search.message}`,
        citations: [],
      };
    }
    searchData = search.data;

    if (Array.isArray(searchData?.ai_overview?.text_blocks)) {
      return {
        response: renderTextBlocks(searchData.ai_overview.text_blocks),
        citations: collectCitations(searchData.ai_overview, searchData.ai_overview.text_blocks),
      };
    }

    const sdLink = searchData?.ai_overview?.scrapingdog_link;
    if (typeof sdLink === "string" && sdLink.trim()) {
      aioUrl = null;
      searchData._sdLink = /api_key=/.test(sdLink)
        ? sdLink
        : sdLink + (sdLink.includes("?") ? "&" : "?") + `api_key=${key}`;
      break;
    }
    aioUrl = findScrapingdogAioUrl(searchData);
    if (aioUrl) break;
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
