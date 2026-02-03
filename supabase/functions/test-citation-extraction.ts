/**
 * Test citation extraction for non-English prompts (Portuguese, Spanish, etc.).
 * Run from repo root: deno run --allow-read supabase/functions/test-citation-extraction.ts
 * Or from supabase/functions: deno run --allow-read test-citation-extraction.ts
 */
import { SOURCES_SECTION_REGEX } from "./_shared/citation-extraction.ts";

function extractCitations(text: string): { url?: string; domain: string; title: string }[] {
  const citations: { url?: string; domain: string; title: string }[] = [];
  const seenUrls = new Set<string>();
  const urlPattern = /https?:\/\/([^\s\)]+)/g;
  let match: RegExpExecArray | null;
  while ((match = urlPattern.exec(text)) !== null) {
    const url = match[0].replace(/[.,;:!?]+$/, "");
    if (!seenUrls.has(url)) {
      try {
        const domain = new URL(url).hostname.replace("www.", "");
        citations.push({ url, domain, title: `Source from ${domain}` });
        seenUrls.add(url);
      } catch (_e) {}
    }
  }
  const sourcesMatch = text.match(SOURCES_SECTION_REGEX);
  if (sourcesMatch) {
    const sourcesText = sourcesMatch[1];
    const sourceUrls = sourcesText.match(/https?:\/\/([^\s\n\)]+)/g) || [];
    sourceUrls.forEach((url: string) => {
      if (!seenUrls.has(url)) {
        try {
          const domain = new URL(url).hostname.replace("www.", "");
          citations.push({ url, domain, title: `Source from ${domain}` });
          seenUrls.add(url);
        } catch (_e) {}
      }
    });
  }
  return citations;
}

// Portuguese (Brazil) – "Fontes:" section
const portugueseResponse = `
Empresas no setor de tecnologia no Brasil conhecidas por cultura forte incluem Nubank, iFood e Stone [1].

Fontes:
- https://www.glassdoor.com.br/avaliações/brasil
- https://www.linkedin.com/company/nubank
- https://www.infojobs.com.br/empresas
`;

// Spanish (Mexico) – "Fuentes:" section
const spanishResponse = `
En México, empresas reconocidas por su cultura incluyen Kavak y Bitso [1].

Fuentes:
- https://www.glassdoor.com.mx/reseñas
- https://www.occ.com.mx/empleos
`;

// German – "Quellen:" section
const germanResponse = `
In Deutschland sind Unternehmen wie SAP und Siemens für starke Arbeitgebermarken bekannt [1].

Quellen:
- https://www.kununu.com/de
- https://www.glassdoor.de/bewertungen
`;

// French – "Références:" section
const frenchResponse = `
En France, des entreprises comme Doctolib et Alan sont reconnues pour leur culture.

Références:
- https://www.glassdoor.fr/avis
- https://www.welcometothejungle.com/fr
`;

console.log("=== Citation extraction test (non-English) ===\n");

for (const [lang, response] of [
  ["Portuguese (Fontes:)", portugueseResponse],
  ["Spanish (Fuentes:)", spanishResponse],
  ["German (Quellen:)", germanResponse],
  ["French (Références:)", frenchResponse],
] as [string, string][]) {
  const citations = extractCitations(response);
  const fromSection = response.match(SOURCES_SECTION_REGEX) ? "YES" : "NO";
  console.log(`${lang}`);
  console.log(`  Sources section detected: ${fromSection}`);
  console.log(`  Citations extracted: ${citations.length}`);
  if (citations.length > 0) {
    citations.forEach((c, i) => console.log(`    [${i + 1}] ${c.domain} ${c.url ? c.url : ""}`));
  }
  console.log("");
}

console.log("=== Done ===");
