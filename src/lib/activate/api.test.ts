import { describe, expect, it } from 'vitest';
import { availableChannels, resolveRoutes, type ActivateRoute } from './api';

const route = (over: Partial<ActivateRoute>): ActivateRoute =>
  ({
    market_code: null,
    tier: 1,
    channel: 'review',
    platform: 'glassdoor',
    destination_url: 'https://example.com',
    rationale_stat: null,
    fit_note: null,
    is_local: false,
    is_listen_only: false,
    audience_functions: null,
    audience_seniority: null,
    rank: 1,
    use_direct_link: false,
    entity_company_id: null,
    ...over,
  }) as ActivateRoute;

// Shaped like a real client: reviews everywhere, forums only in some markets,
// and a reviews-only global fallback (SAP, PepsiCo, Cloudera, GoFundMe).
const routes: ActivateRoute[] = [
  route({ market_code: 'DE', channel: 'review', platform: 'kununu' }),
  route({ market_code: 'DE', channel: 'forum', platform: 'reddit' }),
  route({ market_code: 'ES', channel: 'review', platform: 'glassdoor' }),
  route({ market_code: 'ES', channel: 'social', platform: 'linkedin' }),
  route({ market_code: null, tier: 3, channel: 'review', platform: 'glassdoor' }),
  route({ market_code: null, tier: 3, channel: 'review', platform: 'indeed' }),
];

describe('availableChannels', () => {
  it('lists only the kinds of place that have something to show', () => {
    expect(availableChannels(routes, 'DE', null)).toEqual(['review', 'forum']);
    expect(availableChannels(routes, 'ES', null)).toEqual(['review', 'social']);
  });

  it('offers reviews only for a country the client has no routes for', () => {
    expect(availableChannels(routes, 'FR', null)).toEqual(['review']);
  });

  it('never returns an empty list while the client has global review routes', () => {
    for (const market of ['DE', 'ES', 'FR', 'JP', 'ZZ']) {
      expect(availableChannels(routes, market, null).length).toBeGreaterThan(0);
    }
  });

  it('ignores listen-only routes, which have nothing for a recipient to do', () => {
    const listenOnly = [
      route({ market_code: 'DE', channel: 'review', platform: 'kununu' }),
      route({ market_code: 'DE', channel: 'forum', platform: 'reddit', is_listen_only: true }),
    ];
    expect(availableChannels(listenOnly, 'DE', null)).toEqual(['review']);
  });

  it('ignores routes that belong to a different company entity', () => {
    const entityRoutes = [
      route({ market_code: 'DE', channel: 'review', platform: 'kununu' }),
      route({ market_code: 'DE', channel: 'forum', platform: 'reddit', entity_company_id: 'other' }),
    ];
    expect(availableChannels(entityRoutes, 'DE', 'mine')).toEqual(['review']);
    expect(availableChannels(entityRoutes, 'DE', 'other')).toEqual(['review', 'forum']);
  });

  it('falls back to global routes of that kind when the market has none', () => {
    const withGlobalForum = [
      ...routes,
      route({ market_code: null, tier: 3, channel: 'forum', platform: 'reddit' }),
    ];
    expect(availableChannels(withGlobalForum, 'ES', null)).toEqual(['review', 'forum', 'social']);
  });
});

describe('resolveRoutes', () => {
  it('prefers the market rows over the global ones', () => {
    expect(resolveRoutes(routes, 'DE', null).routes.map((r) => r.platform)).toEqual(['kununu']);
  });
});
