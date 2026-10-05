// Offline tests, run with: cd supabase/functions && deno test _shared/
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { bucketsInRegion, countryCodeForLocation, regionFromText } from './regions.ts';
import { matchBuckets } from './px-tools/scope.ts';

const TRACKED = ['Brazil', 'Mexico', 'India', 'the Netherlands', 'Berlin, Germany', 'US'];

Deno.test('regions: free text and keys resolve to one region', () => {
  assertEquals(regionFromText('LATAM')?.id, 'latin-america');
  assertEquals(regionFromText('Latin America')?.id, 'latin-america');
  assertEquals(regionFromText('region:asia-pacific')?.id, 'asia-pacific');
  assertEquals(regionFromText('Germany'), null);
});

Deno.test('regions: stored market spellings resolve to a country code or nothing', () => {
  assertEquals(countryCodeForLocation('the Netherlands'), 'NL');
  assertEquals(countryCodeForLocation('US'), 'US');
  assertEquals(countryCodeForLocation('Berlin, Germany'), null);
});

Deno.test('regions: a region request matches every tracked market inside it', () => {
  assertEquals(bucketsInRegion(TRACKED, regionFromText('latam')!), ['Brazil', 'Mexico']);
  assertEquals(matchBuckets(TRACKED, 'Latin America'), ['Brazil', 'Mexico']);
  assertEquals(matchBuckets(TRACKED, 'north america'), ['US']);
  // A single market still matches exactly, and an exact bucket spelling
  // always wins over region resolution.
  assertEquals(matchBuckets(TRACKED, 'india'), ['India']);
  assertEquals(matchBuckets(['Europe', 'Germany'], 'europe'), ['Europe']);
});

Deno.test('regions: a saved multi-market selection matches the union of its members', () => {
  assertEquals(matchBuckets(TRACKED, 'set:india|united states'), ['India']);
  assertEquals(matchBuckets(TRACKED, 'set:india|latam'), ['India', 'Brazil', 'Mexico']);
  assertEquals(matchBuckets(TRACKED, 'set:'), []);
});
