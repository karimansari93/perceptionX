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

/**
 * Unwrap translate.google.com redirect URLs to the real source URL.
 *
 * Google AI Overviews wraps cited URLs in translate.google.com for non-English
 * markets, e.g.
 *   https://translate.google.com/translate?u=https%3A%2F%2Fwww.glassdoor.com%2F...&hl=es&sl=en&tl=es
 *
 * Storing the wrapper as the citation URL breaks relevance scoring
 * (url_recency_cache can't match it) and inflates translate.google.com as a
 * "source" in analytics. We extract the `u=` parameter, URL-decode it, and
 * strip any #:~:text= text-highlight fragment Google appends.
 *
 * Apply to every citation URL BEFORE storing it in prompt_responses.citations.
 */
export function unwrapTranslateUrl(url: string): string {
  if (!url || !url.includes("translate.google.com/translate")) return url;
  try {
    const parsed = new URL(url);
    const realUrl = parsed.searchParams.get("u");
    if (realUrl && /^https?:\/\//i.test(realUrl)) {
      // URL.searchParams.get already decodes percent-encoding.
      return realUrl.split("#:~:text=")[0];
    }
  } catch {
    // Malformed URL — return as-is.
  }
  return url;
}

function isGoogleHost(hostname: string): boolean {
  return /(^|\.)google\.[a-z.]{2,}$/i.test(hostname);
}

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
    const target = parsed.searchParams.get(param);
    if (target && /^https?:\/\//i.test(target)) {
      return target.split("#:~:text=")[0];
    }
  }
  return url;
}

/**
 * Unwrap Google redirect wrappers (google.*\/url?q=, /imgres, translate.google)
 * to the real source URL, following up to three nested wrappers.
 */
export function unwrapRedirectUrl(url: string): string {
  if (!url || typeof url !== "string") return url;
  let current = url.trim();
  for (let i = 0; i < 3; i++) {
    const next = unwrapOnce(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

const GOOGLE_UI_PATHS = /^\/(url|imgres|search|searchviewer|viewer|translate|async|sorry|preferences|setprefs)(\/|$)/i;

/** False for non-http(s) URLs and Google UI pages that aren't real sources. */
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

export function domainOfUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Unwrap, filter and dedupe citations before they are stored, keeping the
 * domain in step with the unwrapped URL.
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
    if (seen.has(url)) continue;
    seen.add(url);
    const wasUnwrapped = url !== original;
    const domain = (!wasUnwrapped && citation.domain) || domainOfUrl(url);
    const title = !citation.title || /^Source from /.test(citation.title)
      ? `Source from ${domain}`
      : citation.title;
    out.push({ ...citation, url, domain, title });
  }
  return out;
}
