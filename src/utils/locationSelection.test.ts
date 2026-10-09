import { describe, expect, it } from 'vitest';
import { GENERAL_KEY, buildLocationOptions, makeLocationMatcher } from './locationContext';
import {
  buildSelectionKey,
  expandSelectionKey,
  regionTickState,
  resolveSelectionEntry,
  selectionLabel,
  toggleMarket,
  toggleRegion,
} from './locationSelection';
import { validLocationKey, locationRawValue } from '@/hooks/useProfileSetup';

// Brazil, Mexico (Latin America), India, United States, and a city.
const responses = ['Brazil', 'Mexico', 'India', 'United States', 'Burbank'].map((loc) => ({
  company_id: 'c1',
  confirmed_prompts: { location_context: loc },
}));
const { options } = buildLocationOptions(responses, [{ id: 'c1', country: null }]);
const latam = options.find((o) => o.canonicalKey === 'region:latin-america')!;

describe('selection keys', () => {
  it('encodes one market, a whole region, or an explicit set', () => {
    expect(buildSelectionKey([], options)).toBeNull();
    expect(buildSelectionKey(['india'], options)).toBe('india');
    expect(buildSelectionKey(['mexico', 'brazil'], options)).toBe('region:latin-america');
    expect(buildSelectionKey(['united states', 'india'], options)).toBe('set:india|united states');
    expect(buildSelectionKey(['brazil', 'mexico', 'india'], options)).toBe('set:brazil|india|mexico');
  });

  it('expands back to atomic market keys', () => {
    expect(expandSelectionKey('india', options)).toEqual(['india']);
    expect(expandSelectionKey('region:latin-america', options)).toEqual(['brazil', 'mexico']);
    expect(expandSelectionKey('set:india|united states', options)).toEqual(['india', 'united states']);
    expect(expandSelectionKey(GENERAL_KEY, options)).toEqual([]);
    expect(expandSelectionKey(null, options)).toEqual([]);
  });

  it('labels a selection by its members', () => {
    expect(selectionLabel(['india', 'united states'], options)).toBe('India, United States');
    expect(selectionLabel(['brazil', 'india', 'united states'], options)).toBe('3 markets');
  });
});

describe('ticking markets and regions', () => {
  it('ticks and unticks one market at a time', () => {
    const k1 = toggleMarket(null, 'india', options);
    expect(k1).toBe('india');
    const k2 = toggleMarket(k1, 'united states', options);
    expect(k2).toBe('set:india|united states');
    expect(toggleMarket(k2, 'india', options)).toBe('united states');
    expect(toggleMarket('india', 'india', options)).toBeNull();
  });

  it('a region ticks all its countries, and collapses back to the region key', () => {
    const k = toggleRegion(null, latam, options);
    expect(k).toBe('region:latin-america');
    expect(regionTickState(k, latam, options)).toBe('all');
    // Untick one member: the explicit remainder, region shows partial.
    const minusBrazil = toggleMarket(k, 'brazil', options);
    expect(minusBrazil).toBe('mexico');
    expect(regionTickState(minusBrazil, latam, options)).toBe('some');
    // Re-tick it and the selection is the region again.
    expect(toggleMarket(minusBrazil, 'brazil', options)).toBe('region:latin-america');
    // A fully ticked region toggles off.
    expect(toggleRegion(k, latam, options)).toBeNull();
    // Region plus an outside market is an explicit set.
    expect(toggleMarket(k, 'india', options)).toBe('set:brazil|india|mexico');
  });
});

describe('resolving a selection to an entry', () => {
  it('returns the row for a market or region and synthesizes a set entry', () => {
    expect(resolveSelectionEntry('india', options)?.label).toBe('India');
    expect(resolveSelectionEntry('region:latin-america', options)).toBe(latam);
    const set = resolveSelectionEntry('set:india|united states', options)!;
    expect(set.label).toBe('India, United States');
    expect(set.memberKeys).toEqual(['india', 'united states']);
    expect(set.rawValues.sort()).toEqual(['India', 'United States']);
    const matches = makeLocationMatcher(set.canonicalKey, set);
    expect(matches('india')).toBe(true);
    expect(matches('united states')).toBe(true);
    expect(matches('brazil')).toBe(false);
  });

  it('drops members this scope no longer tracks, and gives up when none remain', () => {
    const set = resolveSelectionEntry('set:india|japan', options)!;
    expect(set.memberKeys).toEqual(['india']);
    expect(resolveSelectionEntry('set:japan|germany', options)).toBeNull();
    expect(resolveSelectionEntry('germany', options)).toBeNull();
  });

  it('is what the profile focus stores and validates', () => {
    expect(validLocationKey('set:india|united states', options)).toBe('set:india|united states');
    expect(validLocationKey('set:japan', options)).toBeNull();
    expect(locationRawValue('set:india|united states', options)).toBe('set:india|united states');
    expect(locationRawValue('region:latin-america', options)).toBe('region:latin-america');
    expect(locationRawValue('india', options)).toBe('India');
  });
});
