/**
 * Shared citation extraction: "Sources" section header in all app-supported languages.
 * Used so we detect the reference block regardless of prompt language (Brazil/Mexico/Japan/etc.).
 * Languages from _shared/translate-prompts.ts COUNTRY_TO_LANGUAGE_NAME and location-utils COUNTRY_TO_HL.
 */

// "Source(s)" / "References" section headers — regex-safe alternation (each may be followed by optional colon and newline)
const SOURCES_HEADERS =
  "Sources?|" +
  "Fontes?|" +           // Portuguese
  "Fuentes?|" +          // Spanish
  "Refer[eê]ncias?|" +   // Portuguese
  "Quellen?|" +          // German
  "R[eé]f[eé]rences?|" + // French
  "Fonti?|" +            // Italian (Fonte/Fonti)
  "Bronnen?|" +          // Dutch
  "Źródła?|" +            // Polish (Źródła/Źródło)
  "Zdroje?|" +           // Czech, Slovak
  "Források?|" +         // Hungarian
  "Surse?|" +             // Romanian
  "Izvori?|" +            // Croatian
  "Viri?|" +              // Slovenian
  "Šaltiniai?|" +         // Lithuanian
  "Avoti?|" +             // Latvian
  "Allikad?|" +           // Estonian
  "Lähteet?|" +           // Finnish (Lähde/Lähteet)
  "Källor?|" +            // Swedish
  "Kilder?|" +            // Norwegian, Danish
  "Kaynaklar?|" +         // Turkish
  "Источники?|" +         // Russian
  "Πηγές?|" +              // Greek (Πηγή/Πηγές)
  "出典|ソース|" +         // Japanese
  "来源|" +               // Chinese (Simplified/Traditional often same term)
  "출처|" +               // Korean
  "Sumber|" +             // Indonesian
  "Nguồn|" +              // Vietnamese
  "แหล่งที่มา|" +          // Thai
  "مصادر|" +              // Arabic
  "מקורות|" +              // Hebrew
  "Източници";            // Bulgarian

/** Regex to match a "Sources" (or localized) section followed by URLs/list. Case-insensitive where applicable. */
export const SOURCES_SECTION_REGEX = new RegExp(
  "(?:" + SOURCES_HEADERS + "):?\\s*\\n((?:[-•]\\s*)?(?:https?:\\/\\/[^\\n]+|\\[?\\d+\\]?\\s*[^\\n]+)+)",
  "i"
);

// ---------------------------------------------------------------------------
// Google redirect / wrapper URLs
//
// Google's SERP payloads (both SerpAPI and Scrapingdog) hand back links that
// point at google.com rather than at the source itself:
//
//   translate.google.com/translate?u=<real>&hl=es      (localized markets)
//   www.google.com/url?sa=i&...&url=<real>&ved=...     (image / result redirect)
//   www.google.com/imgres?imgurl=<img>&imgrefurl=<real>
//
// Storing the wrapper as the citation URL breaks relevance scoring
// (url_recency_cache can't match it) and inflates google.com into the app's
// top "source" — 17k citations were attributed to google.com this way.
//
// Some wrappers carry no recoverable target at all (google.com/searchviewer,
// /url?url=CAES<opaque-token>, /search) — those are Google UI surfaces, not
// sources, and must be dropped rather than stored. See isUsableCitationUrl.
// ---------------------------------------------------------------------------

/** true for google.com, www.google.co.uk, translate.google.com … but not notgoogle.com */
function isGoogleHost(hostname: string): boolean {
  return /(^|\.)google\.[a-z.]{2,}$/i.test(hostname);
}

/** Query params that carry the real destination, by wrapper type, in priority order. */
function redirectParamsFor(hostname: string, pathname: string): string[] {
  if (/^translate\.google/i.test(hostname) || /^translate\.googleusercontent/i.test(hostname)) {
    return ["u"];
  }
  if (!isGoogleHost(hostname)) return [];
  const path = pathname.replace(/\/+$/, "").toLowerCase();
  if (path === "/url") return ["url", "q"];
  if (path === "/imgres") return ["imgrefurl", "imgurl"];
  return [];
}

function unwrapOnce(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  for (const param of redirectParamsFor(parsed.hostname, parsed.pathname)) {
    // URL.searchParams.get already decodes percent-encoding.
    const target = parsed.searchParams.get(param);
    if (target && /^https?:\/\//i.test(target)) {
      return target.split("#:~:text=")[0];
    }
  }
  return url;
}

/**
 * Unwrap a Google redirect URL to the real source URL it points at.
 *
 * Handles translate.google.com (`u=`), google.com/url (`url=`, then `q=`) and
 * google.com/imgres (`imgrefurl=`, then `imgurl=`) on any google ccTLD, and
 * strips any #:~:text=
 * text-highlight fragment Google appends. Wrappers occasionally nest (an
 * image redirect around a translate link), so unwrapping repeats until the
 * URL stops changing.
 *
 * Returns the input unchanged when it isn't a wrapper, or when the wrapper
 * carries no http(s) target — callers should then run isUsableCitationUrl to
 * decide whether the citation is worth storing at all.
 *
 * Apply to every citation URL BEFORE storing it in prompt_responses.citations.
 */
export function unwrapRedirectUrl(url: string): string {
  if (!url || typeof url !== "string") return url;
  let current = url.trim();
  // Bounded: a wrapper chain longer than this is pathological, not real data.
  for (let i = 0; i < 3; i++) {
    const next = unwrapOnce(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

// Google-hosted paths that are search-UI surfaces rather than sources. Anything
// still on one of these after unwrapping had no recoverable destination.
const GOOGLE_UI_PATHS = /^\/(url|imgres|search|searchviewer|viewer|translate|async|sorry|preferences|setprefs)(\/|$)/i;

/**
 * Whether a (already unwrapped) URL is worth storing as a citation.
 *
 * Rejects non-http(s) URLs and leftover Google UI surfaces so a wrapper we
 * couldn't unwrap never lands in the DB as a google.com "source".
 */
export function isUsableCitationUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (isGoogleHost(parsed.hostname) && GOOGLE_UI_PATHS.test(parsed.pathname)) return false;
  return true;
}

/** Domain of a URL, without the www. prefix — the form stored on citations. */
export function domainOfUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Normalize a citation list for storage: unwrap Google redirects, drop entries
 * with no usable URL, and re-derive `domain`/`title` from the unwrapped URL
 * (a caller-supplied domain describes the wrapper, not the real source).
 *
 * Every writer of prompt_responses.citations should funnel through this so the
 * stored shape is identical no matter which edge function produced it.
 */
export function normalizeCitationsForStorage<T extends { url?: string; domain?: string; title?: string }>(
  citations: T[] | null | undefined,
): Array<T & { url: string; domain: string; title: string }> {
  if (!Array.isArray(citations)) return [];
  const out: Array<T & { url: string; domain: string; title: string }> = [];
  const seen = new Set<string>();
  for (const citation of citations) {
    if (!citation || typeof citation.url !== "string") continue;
    const original = citation.url.trim();
    if (!original) continue;
    const url = unwrapRedirectUrl(original);
    if (!isUsableCitationUrl(url)) continue;
    // Google cites one page through several wrappers (each with its own &ved=),
    // so dedupe on the destination, not on what the payload handed us. First
    // occurrence wins.
    if (seen.has(url)) continue;
    seen.add(url);
    const wasUnwrapped = url !== original;
    const domain = (!wasUnwrapped && citation.domain) || domainOfUrl(url);
    // Keep a real title (the SERP anchor text); replace the auto-generated
    // "Source from google.com" placeholder, which names the wrapper.
    const title = !citation.title || /^Source from /.test(citation.title)
      ? `Source from ${domain}`
      : citation.title;
    out.push({ ...citation, url, domain, title });
  }
  return out;
}
