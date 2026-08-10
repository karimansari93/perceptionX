// ============================================================================
// Competitor detection — the ONE place detected_competitors strings become
// competitor names.
//
// Replaces the old comma-split + hardcoded-exclusion-set pattern that lived
// in CompetitorsTab / competitorUtils / discoveryStats. Rules (matching the
// SQL side — _refresh_cm_competitors and trg_competitor_themes_prepare):
//   * NULL / empty / placeholder tokens ('None', 'N/A', …) are excluded
//   * the measured company is self-excluded by WORD-BOUNDARY match, so
//     "Netflix" and "Netflix Thailand" both drop when measuring Netflix,
//     while a name that merely contains the letters doesn't
//   * alias mapping is retained: names arrive canonicalized from
//     prompt_responses_canonical, and an optional canonicalize() (the
//     entity-alias map) re-applies mappings on read and drops names an
//     admin flagged as non-entities (is_active = false)
//   * NO hardcoded company exclusion lists
//
// On top of parsing, collapseVariants() folds unmapped variants into the
// competitors they word-boundary-contain ("Chevrolet Colombia", "GM /
// Chevrolet" → "Chevrolet" [+ "GM"]), which is what keeps the tab from
// listing nine Chevrolets. Admin alias mappings always win over the
// heuristic: a name the alias map knows is never treated as a variant.
// ============================================================================

const PLACEHOLDER_TOKENS = new Set(['none', 'n/a', 'na', 'null', 'undefined']);

export const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Word-boundary containment — the JS equivalent of Postgres \mNEEDLE\M.
 *  \b is ASCII-only, so boundaries are "not a unicode letter/digit". */
export const containsWholeWord = (haystack: string, needle: string): boolean => {
  if (!haystack || !needle) return false;
  try {
    const re = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}([^\\p{L}\\p{N}]|$)`,
      'iu',
    );
    return re.test(haystack);
  } catch {
    return haystack.toLowerCase().includes(needle.toLowerCase());
  }
};

export const isPlaceholderName = (name: string): boolean =>
  PLACEHOLDER_TOKENS.has(name.trim().toLowerCase());

/** Is this name the measured company (or a self-reference containing it as a
 *  whole word, e.g. a regional subsidiary)? */
export const isSelfName = (name: string, companyName: string): boolean => {
  if (!companyName) return false;
  return (
    name.toLowerCase() === companyName.toLowerCase() ||
    containsWholeWord(name, companyName)
  );
};

/**
 * Parse one detected_competitors string (comma-separated, already
 * server-canonicalized) into clean competitor names, deduped per response.
 *
 * canonicalize — optional read-time alias map (useEntityCanonicalizer):
 * returns the canonical name, the input when unmapped, or null for names an
 * admin flagged as non-entities. Parsing works without it (initial render
 * before the alias map loads) because write-time canonicalization has
 * already been applied server-side.
 */
export function parseDetectedCompetitors(
  raw: string | null | undefined,
  companyName: string,
  canonicalize?: (name: string) => string | null,
): string[] {
  if (!raw || typeof raw !== 'string') return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed || isPlaceholderName(trimmed)) continue;
    const name = canonicalize ? canonicalize(trimmed) : trimmed;
    if (!name || isPlaceholderName(name)) continue;
    if (isSelfName(name, companyName)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Variant collapse across the whole detected-name universe.
 *
 * Anchors are the minimal names: curated competitors, alias-mapped names,
 * and any detected name that doesn't word-boundary-contain another detected
 * name. Every other name folds into the anchors it contains:
 *   "Chevrolet Colombia"  → ["Chevrolet"]
 *   "GM / Chevrolet"      → ["GM", "Chevrolet"]   (a co-brand mentions both)
 * When matched anchors nest ("Warner Bros" ⊂ "Warner Bros. Discovery"),
 * only the maximal ones are kept so one lineage isn't double-counted.
 *
 * Returns name → list of collapse targets (usually length 1; itself when
 * the name IS an anchor or nothing matches).
 */
export function buildVariantCollapseMap(
  allNames: Iterable<string>,
  opts: {
    /** Names that are anchors no matter what (the curated Direct list). */
    curated?: Set<string>;
    /** normalize(name) present in the entity-alias map ⇒ admin-curated ⇒
     *  never treated as a variant of something else. */
    isAliasMapped?: (name: string) => boolean;
  } = {},
): Map<string, string[]> {
  const names = Array.from(new Set(Array.from(allNames)));
  const curatedLower = new Set(
    Array.from(opts.curated ?? []).map((n) => n.toLowerCase()),
  );

  const isProtected = (n: string): boolean =>
    curatedLower.has(n.toLowerCase()) || (opts.isAliasMapped?.(n) ?? false);

  // Sort short→long so anchor checks only need to look at shorter names.
  const sorted = [...names].sort((a, b) => a.length - b.length);
  const anchors: string[] = [];
  for (const name of sorted) {
    if (isProtected(name)) {
      anchors.push(name);
      continue;
    }
    const containsOther = sorted.some(
      (other) =>
        other !== name &&
        other.length < name.length &&
        containsWholeWord(name, other),
    );
    if (!containsOther) anchors.push(name);
  }

  const map = new Map<string, string[]>();
  for (const name of names) {
    if (isProtected(name) || anchors.includes(name)) {
      map.set(name, [name]);
      continue;
    }
    let matched = anchors.filter(
      (a) => a !== name && containsWholeWord(name, a),
    );
    // Keep only maximal anchors: drop an anchor contained in another match.
    matched = matched.filter(
      (a) => !matched.some((b) => b !== a && containsWholeWord(b, a)),
    );
    map.set(name, matched.length > 0 ? matched : [name]);
  }
  return map;
}
