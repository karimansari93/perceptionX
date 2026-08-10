/**
 * Entity-name normalization shared with the SQL layer.
 *
 * The old isValidCompetitor/parseCompetitors helpers (comma-split + hardcoded
 * job-board and placeholder exclusion sets) are gone — competitor parsing now
 * lives in src/utils/competitorDetection.ts (word-boundary self-exclusion,
 * placeholder exclusion, alias mapping respected), and job boards are excluded
 * at the data layer via canonical_entities.is_active = false.
 */

/**
 * Mirrors public.normalize_entity_name() in SQL so the admin canonicalization
 * UI can preview how a raw alias will be keyed against entity_aliases.
 * Lowercases, replaces & with " and ", strips edge punctuation/quotes,
 * collapses internal whitespace.
 */
export function normalizeEntityName(input: string): string {
  if (!input) return '';
  return input
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/^[\s\p{P}"]+|[\s\p{P}"]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
