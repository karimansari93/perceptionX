import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuth } from '@/contexts/AuthContext';
import { server } from './msw/server';
import { MockBackend } from './msw/supabase';
import * as F from './fixtures/dashboard';
import { metricEl, readMetric, renderDashboard, seedSession } from './renderDashboard';

// Load-shape guards for docs/audits/DATA_RELIABILITY_AUDIT_2026-09-11.md
// findings P0-2 (the cold-load burst) and P1-2 (retries into the same
// window), plus the sign-out hygiene item (P2-3).

const waitForScorecard = () =>
  waitFor(() => expect(metricEl('eps')).not.toBeNull(), { timeout: 30_000 });

const SignOutProbe = () => {
  const { signOut } = useAuth();
  return <button type="button" onClick={() => void signOut()}>Sign out (test)</button>;
};

describe('dashboard cold-load shape', () => {
  it('fires in waves: the response stream waits for the headline families, and no more than four RPCs are in flight', async () => {
    // Every RPC takes 250 ms of "server time" so overlap is observable.
    const backend = new MockBackend({ rpcDelayMs: 250 });
    server.use(...backend.handlers());
    seedSession();
    renderDashboard();

    await waitForScorecard();
    await waitFor(() => expect(backend.counters.get_company_responses_page).toBeGreaterThanOrEqual(1), { timeout: 30_000 });
    await waitFor(() => expect(readMetric('sentiment')?.text).toBe(F.EXPECTED.sentiment), { timeout: 20_000 });

    const rollups = backend.rpcCalls('get_dashboard_rollups')[0];
    const stats = backend.rpcCalls('get_scope_stats')[0];
    const domains = backend.rpcCalls('get_domain_stats')[0];
    const competitors = backend.rpcCalls('get_competitor_stats')[0];
    const firstPage = backend.rpcCalls('get_company_responses_page')[0];

    // Wave 2 (stats + cubes) starts only once the rollups have answered.
    expect(stats.startedAt).toBeGreaterThanOrEqual(rollups.completedAt);
    expect(domains.startedAt).toBeGreaterThanOrEqual(rollups.completedAt);
    expect(competitors.startedAt).toBeGreaterThanOrEqual(rollups.completedAt);
    // Wave 3 (the stream) starts only once the stats have answered.
    expect(firstPage.startedAt).toBeGreaterThanOrEqual(stats.completedAt);
    // The incident build opened ten statements at once; the ceiling is now 4.
    expect(backend.maxInFlight).toBeLessThanOrEqual(4);
    // And the page still renders the real numbers at the end.
    expect(readMetric('eps')?.text).toBe(F.EXPECTED.eps);
  });

  it('a failed family is retried after a multi-second backoff, not straight back into the timeout window', async () => {
    const backend = new MockBackend({ faults: { get_location_rollups: (attempt) => attempt === 1 } });
    server.use(...backend.handlers());
    seedSession();
    renderDashboard();

    await waitForScorecard();
    await waitFor(() => expect(readMetric('sentiment')?.text).toBe(F.EXPECTED.sentiment), { timeout: 30_000 });

    const [first, second] = backend.rpcCalls('get_location_rollups');
    expect(first.status).toBe(500);
    expect(second.status).toBe(200);
    // dashboardRetryDelay: 3 s + up to 1.5 s jitter before the first retry.
    expect(second.startedAt - first.completedAt).toBeGreaterThanOrEqual(2900);
    expect(second.startedAt - first.completedAt).toBeLessThan(6000);
  });

  it('does not open the response stream while the rollups are still failing and retrying', async () => {
    // Rollups fail on the first two attempts (retry: 2 → third succeeds).
    const backend = new MockBackend({ faults: { get_dashboard_rollups: (attempt) => attempt <= 2 } });
    server.use(...backend.handlers());
    seedSession();
    renderDashboard();

    await waitForScorecard();
    await waitFor(() => expect(readMetric('sentiment')?.text).toBe(F.EXPECTED.sentiment), { timeout: 40_000 });
    await waitFor(() => expect(backend.counters.get_company_responses_page).toBeGreaterThanOrEqual(1), { timeout: 30_000 });

    const rollupsOk = backend.rpcCalls('get_dashboard_rollups').find((c) => c.status === 200)!;
    const firstPage = backend.rpcCalls('get_company_responses_page')[0];
    expect(backend.rpcCalls('get_dashboard_rollups').map((c) => c.status)).toEqual([500, 500, 200]);
    expect(firstPage.startedAt).toBeGreaterThanOrEqual(rollupsOk.completedAt);
  });
});

describe('sign-out hygiene', () => {
  it('clears every cached dashboard family when the user signs out', async () => {
    const backend = new MockBackend();
    server.use(...backend.handlers());
    seedSession();
    const { queryClient } = renderDashboard({ probe: <SignOutProbe /> });

    await waitForScorecard();
    await waitFor(() => expect(readMetric('sentiment')?.text).toBe(F.EXPECTED.sentiment), { timeout: 20_000 });
    const cachedBefore = queryClient.getQueryCache().getAll().filter((q) => q.queryKey[0] === 'dashboard');
    expect(cachedBefore.length).toBeGreaterThan(0);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign out (test)' }));

    await screen.findByText('Sign in', {}, { timeout: 10_000 });
    await waitFor(() => {
      expect(queryClient.getQueryCache().getAll().filter((q) => q.queryKey[0] === 'dashboard')).toHaveLength(0);
    }, { timeout: 10_000 });
    expect(backend.calls.some((c) => c.path === '/auth/v1/logout')).toBe(true);
  });
});
