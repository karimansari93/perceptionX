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
