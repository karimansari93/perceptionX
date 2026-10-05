// Multi-market selection for the Location filter.
//
// The dashboard, the starred view, the profile focus and the query cache all
// identify "the active location" by ONE string key. A multi-market selection
// keeps that contract by encoding the chosen markets into a single
// SELECTION KEY, so nothing that stores or caches by key had to change:
//
//   null                      → All locations
//   "__general__"             → General (untagged prompts), never combined
//   "india"                   → one market (a country or city key)
//   "region:latin-america"    → a whole region (every tracked member country)
//   "set:india|united states" → any other combination, members sorted
//
// Regions are PRESETS over the atomic market keys: ticking Latin America
// ticks its member countries. When the ticked set is exactly a region, the
// region key is stored (so a market added to the region later joins the
// saved view on its own); otherwise the explicit set is stored.
//
// Everything here is pure and shared by the dashboard dropdown, the
// onboarding / Account picker and the data hook.

import { GENERAL_KEY, LocationEntry } from '@/utils/locationContext';
import { isRegionKey } from '@/utils/regions';

export const SET_KEY_PREFIX = 'set:';
const SET_SEPARATOR = '|';

export const isSetKey = (key: string | null | undefined): boolean =>
  typeof key === 'string' && key.startsWith(SET_KEY_PREFIX);

// A key that stands for more than one market (a region or an explicit set).
export const isCompositeKey = (key: string | null | undefined): boolean =>
  isRegionKey(key) || isSetKey(key);

// Atomic entries are the tickable markets: countries and cities. Regions
// (presets) and General (single-pick) are not atomic.
export const isAtomicEntry = (entry: LocationEntry): boolean =>
  !entry.memberKeys && entry.canonicalKey !== GENERAL_KEY;

export const regionEntries = (options: LocationEntry[]): LocationEntry[] =>
  options.filter((o) => o.icon === 'region' && !!o.memberKeys);

export const atomicEntries = (options: LocationEntry[]): LocationEntry[] =>
  options.filter(isAtomicEntry);

const sortKeys = (keys: Iterable<string>): string[] => Array.from(new Set(keys)).sort();

// The atomic market keys a selection key stands for. A region expands to its
// members in THIS scope; a set lists its own members (whether or not each is
// still tracked — resolveSelectionEntry drops the missing ones). General and
// null return [] because they are not market sets.
export const expandSelectionKey = (key: string | null | undefined, options: LocationEntry[]): string[] => {
  if (!key || key === GENERAL_KEY) return [];
  if (isRegionKey(key)) {
    return sortKeys(options.find((o) => o.canonicalKey === key)?.memberKeys ?? []);
  }
  if (isSetKey(key)) {
    return sortKeys(key.slice(SET_KEY_PREFIX.length).split(SET_SEPARATOR).map((k) => k.trim()).filter(Boolean));
  }
  return [key];
};

// The canonical selection key for a set of atomic market keys: one market →
// its own key; exactly a region's tracked members → the region key; anything
// else → an explicit set key; nothing → null (All locations).
export const buildSelectionKey = (atomicKeys: Iterable<string>, options: LocationEntry[]): string | null => {
  const keys = sortKeys(atomicKeys).filter((k) => k !== GENERAL_KEY);
  if (keys.length === 0) return null;
  if (keys.length === 1) return keys[0];
  const joined = keys.join(SET_SEPARATOR);
  const region = regionEntries(options).find(
    (r) => sortKeys(r.memberKeys ?? []).join(SET_SEPARATOR) === joined
  );
  if (region) return region.canonicalKey;
  return `${SET_KEY_PREFIX}${joined}`;
};

// Human label for a set of markets: "India", "India, United States", or
// "3 markets" when it would run long.
export const selectionLabel = (atomicKeys: string[], options: LocationEntry[]): string => {
  const labels = atomicKeys.map((k) => options.find((o) => o.canonicalKey === k)?.label ?? k);
  if (labels.length === 0) return 'All locations';
  if (labels.length <= 2) return labels.join(', ');
  return `${labels.length} markets`;
};

// The dropdown entry for a selection key: an existing row (market, region,
// General) or, for an explicit set, a synthesized entry that unions the
// members still tracked in this scope. Null when nothing resolves (a stale
// key for another company) — callers fall back to All locations.
export const resolveSelectionEntry = (
  key: string | null | undefined,
  options: LocationEntry[]
): LocationEntry | null => {
  if (!key) return null;
  const direct = options.find((o) => o.canonicalKey === key);
  if (direct) return direct;
  if (!isSetKey(key)) return null;
  const members = expandSelectionKey(key, options)
    .map((k) => options.find((o) => o.canonicalKey === k))
    .filter((e): e is LocationEntry => !!e && isAtomicEntry(e));
  if (members.length === 0) return null;
  const memberKeys = members.map((m) => m.canonicalKey);
  return {
    canonicalKey: key,
    label: selectionLabel(memberKeys, options),
    icon: 'region',
    flagCode: null,
    rawValues: Array.from(new Set(members.flatMap((m) => m.rawValues))),
    companyIds: Array.from(new Set(members.flatMap((m) => m.companyIds))),
    memberKeys,
  };
};

// Tick / untick one market and return the new selection key.
export const toggleMarket = (
  currentKey: string | null,
  marketKey: string,
  options: LocationEntry[]
): string | null => {
  const ticked = new Set(expandSelectionKey(currentKey, options));
  if (ticked.has(marketKey)) ticked.delete(marketKey);
  else ticked.add(marketKey);
  return buildSelectionKey(ticked, options);
};

export type RegionTickState = 'all' | 'some' | 'none';

export const regionTickState = (currentKey: string | null, region: LocationEntry, options: LocationEntry[]): RegionTickState => {
  const ticked = new Set(expandSelectionKey(currentKey, options));
  const members = region.memberKeys ?? [];
  const n = members.filter((m) => ticked.has(m)).length;
  if (members.length > 0 && n === members.length) return 'all';
  return n > 0 ? 'some' : 'none';
};

// Tick a region (every member on) or, when it is already fully ticked, untick
// all of its members.
export const toggleRegion = (
  currentKey: string | null,
  region: LocationEntry,
  options: LocationEntry[]
): string | null => {
  const ticked = new Set(expandSelectionKey(currentKey, options));
  const members = region.memberKeys ?? [];
  if (regionTickState(currentKey, region, options) === 'all') {
    members.forEach((m) => ticked.delete(m));
  } else {
    members.forEach((m) => ticked.add(m));
  }
  return buildSelectionKey(ticked, options);
};
