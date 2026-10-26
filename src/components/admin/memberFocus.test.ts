import { describe, expect, it } from 'vitest';
import { describeMemberFocus } from './memberFocus';

const brands = [
  { key: 'ford business solutions', name: 'Ford Business Solutions', companies: [{ id: 'fbs-in', name: 'Ford Business Solutions', country: 'IN' }, { id: 'fbs-br', name: 'Ford Business Solutions', country: 'BR' }] },
  { key: 'ford', name: 'Ford', companies: [{ id: 'ford-us', name: 'Ford', country: 'US' }] },
];

describe('describeMemberFocus', () => {
  it('names the brand and the stored location selection', () => {
    expect(describeMemberFocus({ defaultCompanyId: 'fbs-br', defaultLocationContext: 'India' }, brands))
      .toBe('Ford Business Solutions · India');
    expect(describeMemberFocus({ defaultCompanyId: 'fbs-in', defaultLocationContext: 'region:latin-america' }, brands))
      .toBe('Ford Business Solutions · Latin America');
    expect(describeMemberFocus({ defaultCompanyId: 'ford-us', defaultLocationContext: 'set:india|united states' }, brands))
      .toBe('Ford · India, United States');
  });

  it('falls back to the whole org when nothing is set or the company is gone', () => {
    expect(describeMemberFocus({ defaultCompanyId: null, defaultLocationContext: null }, brands)).toBe('All brands · All locations');
    expect(describeMemberFocus({ defaultCompanyId: 'gone', defaultLocationContext: 'GLOBAL' }, brands)).toBe('All brands · All locations');
  });
});
