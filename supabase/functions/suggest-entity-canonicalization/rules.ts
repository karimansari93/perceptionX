// =============================================================================
// Deterministic grouping rules + client protection for competitor variants.
//
// Kept free of I/O so it can be unit-tested (rules_test.ts).
//
// Two jobs:
//   1. rollUpToParent(): "Toyota Manufacturing UK", "Capgemini Polska",
//      "Renault Group", "Amazon UAE" -> the existing parent canonical, when
//      everything after the parent name is geography, a legal suffix or a
//      generic corporate word. This is the edit admins made by hand on almost
//      every suggestion they changed.
//   2. isProtected(): names that belong to our tracked companies (clients,
//      their divisions, and every company we measure) are NEVER auto-grouped.
//      "CSL Behring", "Ford Credit", "Netflix Animation Studios" must stay
//      separate entities; those stay in the manual queue.
// =============================================================================
import { COUNTRY_CODE_TO_NAME } from "../_shared/countries.ts";

export function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/^[\s\p{P}"]+|[\s\p{P}"]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Legal suffixes and corporate filler: "X Group", "X Holdings", "X Pty Ltd".
const LEGAL = [
  "inc", "incorporated", "ltd", "limited", "llc", "llp", "lp", "plc", "gmbh", "ag", "sa", "sas",
  "sarl", "spa", "srl", "sro", "bv", "nv", "pty", "pvt", "private", "public", "corp",
  "corporation", "co", "company", "companies", "group", "holding", "holdings", "international",
  "global", "worldwide", "zrt", "kft", "ab", "as", "asa", "oy", "oyj", "kk", "se", "sl", "sae",
  "sab", "cv", "bhd", "sdn", "tbk", "pt", "jsc", "ooo", "pjsc", "kg", "mbh", "aps",
];

// Operating-arm words admins rolled up: "Toyota Manufacturing UK",
// "Bentley Motors", "McLaren Automotive". Finance words (bank, credit,
// capital, financial services) are deliberately absent: those go to review.
const ARM = [
  "manufacturing", "motor", "motors", "cars", "automotive", "operations", "subsidiary",
  "branch", "office", "offices", "division", "region", "regional", "country", "headquarters",
  "hq", "plant", "factory",
];

// Regions and local-language country forms on top of the shared country list.
const GEO_EXTRA = [
  "uk", "gb", "us", "usa", "uae", "ksa", "emea", "apac", "latam", "mena", "anz", "eu",
  "europe", "european", "asia", "asian", "pacific", "africa", "african", "america", "americas",
  "north", "south", "east", "west", "middle", "central", "latin", "nordic", "nordics", "benelux",
  "dach", "gulf", "arab", "emirates", "great", "britain", "united", "states", "kingdom", "new",
  "zealand", "saudi", "arabia", "hong", "kong", "korea", "republic",
  "brasil", "méxico", "perú", "españa", "deutschland", "polska", "românia", "romania",
  "italia", "türkiye", "turkiye", "nederland", "belgique", "belgië", "schweiz", "suisse",
  "österreich", "sverige", "norge", "danmark", "suomi", "česko", "magyarország", "hellas",
  "india", "indian", "british", "american", "german", "french", "spanish", "italian",
  "japanese", "chinese", "canadian", "australian", "dutch", "polish", "mexican", "brazilian",
  "dubai", "abu", "dhabi",
  // Countries missing from the shared list.
  "venezuela", "ecuador", "bolivia", "paraguay", "uruguay", "guatemala", "panama", "honduras",
  "nicaragua", "salvador", "rica", "costa", "dominicana", "dominican", "cuba", "jamaica",
  "trinidad", "tobago", "puerto", "rico", "egypt", "morocco", "algeria", "tunisia", "nigeria",
  "kenya", "ghana", "ethiopia", "tanzania", "uganda", "qatar", "kuwait", "bahrain", "oman",
  "jordan", "lebanon", "iraq", "iran", "pakistan", "bangladesh", "sri", "lanka", "nepal",
  "kazakhstan", "ukraine", "serbia", "luxembourg", "iceland", "malta", "cyprus", "japan",
  "korea", "macau", "cambodia", "myanmar",
];

// Connectors inside geographic tails: "Volkswagen do Brasil", "Toyota del Perú".
const CONNECTORS = new Set(["de", "do", "da", "del", "des", "du", "of", "and", "the", "in", "y", "e"]);

const NOISE = new Set<string>([
  ...LEGAL,
  ...ARM,
  ...GEO_EXTRA,
  ...Object.values(COUNTRY_CODE_TO_NAME).flatMap((n) => normalize(n).split(" ")),
  ...Object.keys(COUNTRY_CODE_TO_NAME).map((c) => c.toLowerCase()),
]);

/** Remove parentheticals and a leading "the": "Hewlett Packard Enterprise (HPE)". */
export function cleanForMatch(raw: string): string {
  return normalize(raw.replace(/\([^)]*\)/g, " ").replace(/^\s*the\s+/i, ""));
}

function isNoiseTail(tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  let meaningful = 0;
  for (const t of tokens) {
    const tok = t.replace(/[.,]/g, "");
    if (!tok) continue;
    if (CONNECTORS.has(tok)) continue;
    if (!NOISE.has(tok)) return false;
    meaningful++;
  }
  return meaningful > 0;
}

export interface CanonicalRef {
  id: string;
  canonical_name: string;
  entity_type: string | null;
}

/**
 * Longest existing canonical (or alias of one) that the variant starts with,
 * where the remainder is pure noise. `index` maps normalized name/alias ->
 * active, real canonical. Returns null when there is no safe roll-up.
 */
export function rollUpToParent(
  raw: string,
  index: Map<string, CanonicalRef>,
): CanonicalRef | null {
  const cleaned = cleanForMatch(raw);
  if (!cleaned) return null;
  const tokens = cleaned.split(" ");

  // Whole cleaned string is already a known name (e.g. parenthetical removed).
  if (cleaned !== normalize(raw)) {
    const direct = index.get(cleaned);
    if (direct && cleaned.length >= 3) return direct;
  }

  for (let i = tokens.length - 1; i >= 1; i--) {
    const prefix = tokens.slice(0, i).join(" ");
    if (prefix.length < 3) continue;
    const hit = index.get(prefix);
    if (hit && isNoiseTail(tokens.slice(i))) return hit;
  }
  return null;
}

/**
 * Protected stems from tracked company names. "CSL Limited" yields "csl
 * limited" and "csl"; divisions of a multi-word brand also protect their
 * distinctive tail ("CSL Behring" -> "behring") so "Behring" or "Seqirus" on
 * their own are never grouped automatically either.
 */
// Ordinary words that must never become a protected stem on their own
// ("Capital Group" -> "capital" would protect "Chrysler Capital").
const GENERIC = new Set([
  "capital", "credit", "design", "energy", "house", "search", "food", "foods", "health",
  "business", "solutions", "studios", "animation", "marketing", "recruitment", "media", "bank",
  "finance", "financial", "services", "group", "digital", "global", "international",
]);

export function buildProtectedStems(companyNames: string[]): Set<string> {
  const stems = new Set<string>();
  const firstTokens = new Map<string, number>();
  const normed = companyNames.map((n) => normalize(n)).filter(Boolean);

  for (const n of normed) {
    const first = n.split(" ")[0];
    firstTokens.set(first, (firstTokens.get(first) ?? 0) + 1);
  }

  for (const n of normed) {
    stems.add(n);
    const tokens = n.split(" ");
    // Strip trailing legal words: "straumann group" -> "straumann".
    let end = tokens.length;
    while (end > 1 && LEGAL.includes(tokens[end - 1])) end--;
    const stripped = tokens.slice(0, end).join(" ");
    if (!GENERIC.has(stripped)) stems.add(stripped);
    // Division of a family ("csl seqirus" alongside "csl behring"): protect
    // the brand and a distinctive one-word tail ("seqirus"), never a generic
    // one ("credit", "design").
    if (tokens.length > 1 && (firstTokens.get(tokens[0]) ?? 0) > 1) {
      if (!GENERIC.has(tokens[0])) stems.add(tokens[0]);
      const tail = tokens.slice(1, end);
      if (tail.length === 1 && tail[0].length >= 5 && !GENERIC.has(tail[0])) stems.add(tail[0]);
    }
  }
  return stems;
}

/** True when any protected stem appears in the name as whole words. */
export function isProtected(name: string | null | undefined, stems: Set<string>): boolean {
  if (!name) return false;
  const n = normalize(name);
  if (!n) return false;
  const padded = ` ${n} `;
  for (const s of stems) {
    if (s === n) return true;
    if (s.length >= 3 && padded.includes(` ${s} `)) return true;
  }
  return false;
}

/**
 * True when an existing canonical is a word-prefix of the name
 * ("Toyota Financial Services" vs "Toyota"). A new canonical like that is
 * probably a roll-up the rules could not prove, so it goes to review.
 */
export function hasParentCanonical(name: string, index: Map<string, CanonicalRef>): boolean {
  const tokens = cleanForMatch(name).split(" ");
  for (let i = tokens.length - 1; i >= 1; i--) {
    const prefix = tokens.slice(0, i).join(" ");
    if (prefix.length >= 3 && index.has(prefix)) return true;
  }
  return false;
}

// Historical agreement between the LLM and admin decisions (2026-09-25 audit)
// was ~95% or better only at confidence >= 0.95, for every decision type.
export const AUTO_CONFIDENCE = 0.95;
