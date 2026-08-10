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
 *  \b is ASCII-only, so boundaries are "not a unicode letter/digit".
 *  Compiled patterns are cached: this runs per detected name per response
 *  at dashboard scale, and regex construction dominates the cost. */
const WHOLE_WORD_CACHE = new Map<string, RegExp | null>();
export const containsWholeWord = (haystack: string, needle: string): boolean => {
  if (!haystack || !needle) return false;
  let re = WHOLE_WORD_CACHE.get(needle);
  if (re === undefined) {
    try {
      re = new RegExp(
        `(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}([^\\p{L}\\p{N}]|$)`,
        'iu',
      );
    } catch {
      re = null;
    }
    if (WHOLE_WORD_CACHE.size > 8000) WHOLE_WORD_CACHE.clear();
    WHOLE_WORD_CACHE.set(needle, re);
  }
  if (re === null) return haystack.toLowerCase().includes(needle.toLowerCase());
  return re.test(haystack);
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

  // Containment is evaluated on token sequences: name A is "contained" in
  // name B when A's tokens appear contiguously in B's tokens (and A has
  // strictly fewer tokens — equal-token twins like "GM/Chevrolet" vs
  // "GM Chevrolet" don't fold either way). Same word boundaries as
  // \mA\M, but computed through a first-token index instead of pairwise
  // regexes — the previous O(N²)-regex version froze the tab for tens of
  // seconds at Ford scale (thousands of distinct names).
  const tokensOf = new Map<string, string[]>();
  for (const n of names) {
    tokensOf.set(n, n.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  }

  const byFirstToken = new Map<string, string[]>();
  for (const n of names) {
    const t = tokensOf.get(n)!;
    if (t.length === 0) continue;
    const bucket = byFirstToken.get(t[0]);
    if (bucket) bucket.push(n);
    else byFirstToken.set(t[0], [n]);
  }

  const windowMatches = (b: string[], start: number, a: string[]): boolean => {
    for (let j = 0; j < a.length; j += 1) {
      if (b[start + j] !== a[j]) return false;
    }
    return true;
  };

  const seqContains = (b: string[], a: string[]): boolean => {
    if (a.length === 0 || a.length >= b.length) return false;
    for (let i = 0; i + a.length <= b.length; i += 1) {
      if (windowMatches(b, i, a)) return true;
    }
    return false;
  };

  /** Other names contained in `name` (contiguous token run, strictly shorter). */
  const containedNames = (name: string, stopAtFirst: boolean): string[] => {
    const b = tokensOf.get(name)!;
    const out: string[] = [];
    for (let i = 0; i < b.length; i += 1) {
      const bucket = byFirstToken.get(b[i]);
      if (!bucket) continue;
      for (const cand of bucket) {
        if (cand === name || out.includes(cand)) continue;
        const a = tokensOf.get(cand)!;
        if (a.length === 0 || a.length >= b.length || i + a.length > b.length) continue;
        if (windowMatches(b, i, a)) {
          out.push(cand);
          if (stopAtFirst) return out;
        }
      }
    }
    return out;
  };

  const anchors = new Set<string>();
  for (const name of names) {
    if (isProtected(name) || containedNames(name, true).length === 0) {
      anchors.add(name);
    }
  }

  const map = new Map<string, string[]>();
  for (const name of names) {
    if (anchors.has(name)) {
      map.set(name, [name]);
      continue;
    }
    let matched = containedNames(name, false).filter((a) => anchors.has(a));
    // Keep only maximal anchors: drop an anchor contained in another match.
    matched = matched.filter(
      (a) => !matched.some((b) => b !== a && seqContains(tokensOf.get(b)!, tokensOf.get(a)!)),
    );
    map.set(name, matched.length > 0 ? matched : [name]);
  }
  return map;
}
