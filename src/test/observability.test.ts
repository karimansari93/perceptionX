import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Sentry SDK so the enabled path can be asserted without a DSN.
vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  setUser: vi.fn(),
  setTags: vi.fn(),
  setContext: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

import * as Sentry from '@sentry/react';

// The test setup file already loaded src/lib/observability (bound to the
// real SDK) before this file's vi.mock registered, so re-import it from a
// fresh module registry to get an instance bound to the mock above.
type Observability = typeof import('@/lib/observability');
let obs: Observability;
beforeAll(async () => {
  vi.resetModules();
  obs = await import('@/lib/observability');
});
const clearRecentDashboardErrors: Observability['clearRecentDashboardErrors'] = () => obs.clearRecentDashboardErrors();
const describeQueryKey: Observability['describeQueryKey'] = (key) => obs.describeQueryKey(key);
const getRecentDashboardErrors: Observability['getRecentDashboardErrors'] = () => obs.getRecentDashboardErrors();
const initObservability: Observability['initObservability'] = (o) => obs.initObservability(o);
const recordRpcAttempt: Observability['recordRpcAttempt'] = (a) => obs.recordRpcAttempt(a);
const reportDashboardQueryError: Observability['reportDashboardQueryError'] = (e, k) => obs.reportDashboardQueryError(e, k);
const setObservabilityContext: Observability['setObservabilityContext'] = (p) => obs.setObservabilityContext(p);
const setObservabilityUser: Observability['setObservabilityUser'] = (u) => obs.setObservabilityUser(u);

const SCOPE = '33333333-3333-4333-8333-333333333333';

describe('observability: query-key → family/RPC mapping', () => {
  it('describes every dashboard family', () => {
    expect(describeQueryKey(['dashboard', 'scope', SCOPE, 'prompts'])).toEqual({ family: 'prompts', rpc: 'get_scope_prompts', scopeKey: SCOPE, locationKey: null });
    expect(describeQueryKey(['dashboard', 'scope', SCOPE, 'rollups'])).toMatchObject({ family: 'rollups', rpc: 'get_dashboard_rollups' });
    expect(describeQueryKey(['dashboard', 'scope', SCOPE, 'stats'])).toMatchObject({ family: 'stats', rpc: 'get_scope_stats' });
    expect(describeQueryKey(['dashboard', 'scope', SCOPE, 'location', 'united states'])).toEqual({ family: 'location', rpc: 'get_location_rollups', scopeKey: SCOPE, locationKey: 'united states' });
    expect(describeQueryKey(['dashboard', 'scope', SCOPE, 'domains', ''])).toMatchObject({ family: 'domains', rpc: 'get_domain_stats', locationKey: '' });
    expect(describeQueryKey(['dashboard', 'scope', SCOPE, 'competitors', 'canada'])).toMatchObject({ family: 'competitors', rpc: 'get_competitor_stats', locationKey: 'canada' });
    expect(describeQueryKey(['dashboard', 'scope', SCOPE, 'responses', 'first'])).toMatchObject({ family: 'responses_first', rpc: 'get_company_responses_page' });
    expect(describeQueryKey(['dashboard', 'scope', SCOPE, 'responses', 'full'])).toMatchObject({ family: 'responses_full', rpc: 'get_company_responses_page' });
  });

  it('ignores non-dashboard keys', () => {
    expect(describeQueryKey(['announcement', 'seen', 'v1', 'u1'])).toBeNull();
    expect(describeQueryKey(undefined)).toBeNull();
  });
});

describe('observability: reporting', () => {
  beforeEach(() => {
    clearRecentDashboardErrors();
    vi.mocked(Sentry.captureException).mockClear();
    vi.mocked(Sentry.addBreadcrumb).mockClear();
    vi.mocked(Sentry.init).mockClear();
  });
  afterEach(() => {
    setObservabilityUser(null);
    setObservabilityContext({ organizationId: null, companyId: null, scopeKey: null, locationKey: null });
  });

  // The exact error the RPC helper throws for a statement timeout, after it
  // has attached the RPC name, HTTP status and elapsed time.
  const timeoutError = () =>
    Object.assign(new Error('canceling statement due to statement timeout'), {
      code: '57014', details: null, hint: null, rpc: 'get_location_rollups', status: 500, elapsedMs: 8213,
    });

  it('records family, RPC, status, code, elapsed time and the user/org/company/scope/location context', () => {
    expect(initObservability({ dsn: undefined })).toBe(false); // no DSN in tests → buffer only
    setObservabilityUser('user-1');
    setObservabilityContext({ organizationId: 'org-1', companyId: 'company-1', scopeKey: SCOPE, locationKey: 'united states' });

    const entry = reportDashboardQueryError(timeoutError(), ['dashboard', 'scope', SCOPE, 'location', 'united states']);

    expect(entry).toMatchObject({
      family: 'location',
      rpc: 'get_location_rollups',
      http_status: 500,
      pg_code: '57014',
      elapsed_ms: 8213,
      user_id: 'user-1',
      organization_id: 'org-1',
      company_id: 'company-1',
      scope_key: SCOPE,
      location_key: 'united states',
      message: 'canceling statement due to statement timeout',
    });
    expect(typeof entry?.at).toBe('string');
    expect(getRecentDashboardErrors()).toHaveLength(1);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect((window as any).__pxDashboardErrors).toHaveLength(1);
  });

  it('never stores request/response payloads and caps the message length', () => {
    const noisy = Object.assign(new Error('x'.repeat(1000)), {
      code: 'PGRST301', status: 401, rpc: 'get_dashboard_rollups', elapsedMs: 12,
      body: { secret: 'must not be stored' }, response: { rows: [1, 2, 3] },
    });
    const entry = reportDashboardQueryError(noisy, ['dashboard', 'scope', SCOPE, 'rollups'])!;
    expect(entry.message).toHaveLength(200);
    expect(JSON.stringify(entry)).not.toContain('must not be stored');
    expect(Object.keys(entry).sort()).toEqual([
      'at', 'company_id', 'elapsed_ms', 'family', 'http_status', 'location_key', 'message', 'organization_id', 'pg_code', 'rpc', 'scope_key', 'user_id',
    ]);
  });

  it('ignores errors from non-dashboard queries', () => {
    expect(reportDashboardQueryError(new Error('boom'), ['announcement', 'seen'])).toBeNull();
    expect(getRecentDashboardErrors()).toHaveLength(0);
  });

  it('keeps only the last 50 entries', () => {
    for (let i = 0; i < 60; i += 1) reportDashboardQueryError(timeoutError(), ['dashboard', 'scope', SCOPE, 'rollups']);
    expect(getRecentDashboardErrors()).toHaveLength(50);
  });

  it('with a DSN: sends the exception with tags, a dashboard context and a per-(family, code) fingerprint; user carries only an id', () => {
    expect(initObservability({ dsn: 'https://public@example.ingest.sentry.io/1', environment: 'test' })).toBe(true);
    expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({
      environment: 'test',
      tracesSampleRate: 0,
      dataCollection: expect.objectContaining({ userInfo: false, cookies: false, httpBodies: [], queryParams: false }),
    }));
    setObservabilityUser('user-1');
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'user-1' });
    setObservabilityContext({ organizationId: 'org-1', companyId: 'company-1', scopeKey: SCOPE, locationKey: 'united states' });

    recordRpcAttempt({ rpc: 'get_location_rollups', status: 500, code: '57014', elapsedMs: 8100, ok: false });
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({
      category: 'dashboard.rpc', level: 'warning',
      data: { rpc: 'get_location_rollups', http_status: 500, pg_code: '57014', elapsed_ms: 8100 },
    }));

    reportDashboardQueryError(timeoutError(), ['dashboard', 'scope', SCOPE, 'location', 'united states']);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [exception, hint] = vi.mocked(Sentry.captureException).mock.calls[0] as [Error, any];
    expect(exception.message).toBe('canceling statement due to statement timeout');
    expect(hint.tags).toMatchObject({
      area: 'dashboard', family: 'location', rpc: 'get_location_rollups', http_status: '500', pg_code: '57014',
      organization_id: 'org-1', company_id: 'company-1', location_key: 'united states',
    });
    expect(hint.contexts.dashboard_query).toMatchObject({ user_id: 'user-1', scope_key: SCOPE, elapsed_ms: 8213 });
    expect(hint.fingerprint).toEqual(['dashboard-query', 'location', '57014']);
    expect(JSON.stringify(hint)).not.toMatch(/@|email|token/i);

    // Disable again so later suites run in buffer-only mode.
    expect(initObservability({ dsn: undefined })).toBe(false);
  });
});
