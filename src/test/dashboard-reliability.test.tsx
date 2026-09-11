import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { supabase } from '@/integrations/supabase/client';
import { server } from './msw/server';
import { MockBackend } from './msw/supabase';
import * as F from './fixtures/dashboard';
import { metricEl, readMetric, renderDashboard, seedSession, watchScorecard } from './renderDashboard';
import { getRecentDashboardErrors } from '@/lib/observability';

// Regression suite for docs/audits/DATA_RELIABILITY_AUDIT_2026-09-11.md,
// findings P0-1 (location rollups failing silently → 0% metrics) and P1-1
// (response stream failing → permanent skeleton). Each scenario runs the
// real dashboard tree against an in-memory Supabase (MSW) with the exact
// fault production produced on 2026-09-10: HTTP 500 / SQLSTATE 57014.

const LOCATION_ERROR = "Couldn't load this location's metrics.";
const THEMES_ERROR = "Couldn't load themes.";
const THEMES_EMPTY = 'No attribute mentions found yet.';
const STREAM_ERROR = "Couldn't load responses.";

const waitForScorecard = () =>
  waitFor(() => expect(metricEl('eps')).not.toBeNull(), { timeout: 30_000 });

const expectHeadline = (expected: { sentiment: string; visibility: string; relevance: string; eps: string }) => {
  expect(readMetric('sentiment')).toEqual({ text: expected.sentiment, unavailable: false });
  expect(readMetric('visibility')).toEqual({ text: expected.visibility, unavailable: false });
  expect(readMetric('relevance')).toEqual({ text: expected.relevance, unavailable: false });
  expect(readMetric('eps')).toEqual({ text: expected.eps, unavailable: false });
};

describe('dashboard data reliability', () => {
  it('scenario 1: get_location_rollups times out twice → unavailable + retry, never 0%', async () => {
    const backend = new MockBackend({ faults: { get_location_rollups: (attempt) => attempt <= 2 } });
    server.use(...backend.handlers());
    seedSession();
    const watch = watchScorecard();
    renderDashboard();

    await waitForScorecard();
    // Wait for the scorecard to settle on SOME value for sentiment (the
    // incident build painted "0%" here within a second of the 500s).
    await waitFor(() => expect(readMetric('sentiment')?.text).toBeTruthy(), { timeout: 30_000 });
    await waitFor(() => expect(readMetric('sentiment')?.text).not.toBe(''), { timeout: 30_000 });
    // Sentiment and relevance come from the failed family: unavailable, not 0%.
    // (On the pre-remediation code this is where the suite fails: { text: '0%' }.)
    await waitFor(() => expect(readMetric('sentiment')).toEqual({ text: '—', unavailable: true }), { timeout: 30_000 });
    expect(readMetric('relevance')).toEqual({ text: '—', unavailable: true });
    await screen.findByText(LOCATION_ERROR, {}, { timeout: 30_000 });
    watch.stop();

    // Visibility rides the (successful) dashboard rollups call and stays real.
    expect(readMetric('visibility')).toEqual({ text: '70%', unavailable: false });
    // EPS must not be computed with missing inputs.
    expect(readMetric('eps')).toEqual({ text: '—', unavailable: true });
    // Themes: failure copy + Retry, never the legitimate-empty copy.
    expect(screen.queryByText(THEMES_EMPTY)).toBeNull();
    expect(screen.getByText(THEMES_ERROR)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /retry/i }).length).toBeGreaterThan(0);
    // At no point during the load did any metric paint as a zero.
    expect(watch.falseZeros()).toEqual([]);
    // First attempt + the single query-level retry, both answered 500.
    expect(backend.counters.get_location_rollups).toBe(2);
    expect(backend.rpcCalls('get_location_rollups').map((c) => c.status)).toEqual([500, 500]);

    // Observability (audit P1-4): the failure is reported once, with the
    // family, RPC, HTTP status, SQLSTATE, timing and who/what was affected —
    // enough to answer "why did this user see no sentiment at 10:42?".
    const reported = getRecentDashboardErrors().filter((e) => e.family === 'location');
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({
      rpc: 'get_location_rollups',
      http_status: 500,
      pg_code: '57014',
      user_id: F.USER_ID,
      organization_id: F.ORG_ID,
      company_id: F.COMPANY_ID,
      scope_key: F.COMPANY_ID,
    });
    expect(reported[0].location_key).toMatch(/united states/i);
    expect(typeof reported[0].elapsed_ms).toBe('number');
  });

  it('scenario 2: a later retry succeeds → real metrics appear without a browser refresh', async () => {
    const backend = new MockBackend({ faults: { get_location_rollups: (attempt) => attempt <= 2 } });
    server.use(...backend.handlers());
    seedSession();
    const watch = watchScorecard();
    renderDashboard();

    await waitForScorecard();
    await waitFor(() => expect(readMetric('sentiment')).toEqual({ text: '—', unavailable: true }), { timeout: 30_000 });
    await screen.findByText(LOCATION_ERROR, {}, { timeout: 30_000 });

    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: /retry/i })[0]);

    await waitFor(() => expect(readMetric('sentiment')?.text).toBe(F.EXPECTED.sentiment), { timeout: 20_000 });
    watch.stop();
    expectHeadline(F.EXPECTED);
    expect(screen.queryByText(LOCATION_ERROR)).toBeNull();
    expect(screen.queryByText(THEMES_ERROR)).toBeNull();
    // Themes card now shows the fixture attributes.
    expect(await screen.findByText('Company Culture', {}, { timeout: 10_000 })).toBeInTheDocument();
    // Retry re-issued ONLY the failed family (one more call), not the whole burst.
    expect(backend.counters.get_location_rollups).toBe(3);
    expect(backend.counters.get_dashboard_rollups).toBe(1);
    expect(watch.falseZeros()).toEqual([]);
  });

  it('scenario 3: a genuine 0% sentiment and 0 relevance still render as 0%', async () => {
    const backend = new MockBackend({ rpc: { get_location_rollups: () => F.locationRollupsRealZero } });
    server.use(...backend.handlers());
    seedSession();
    renderDashboard();

    await waitForScorecard();
    await waitFor(() => expect(readMetric('sentiment')?.text).toBe('0%'), { timeout: 20_000 });
    expectHeadline(F.EXPECTED_REAL_ZERO); // EPS = 0.5×0 + 0.3×70 + 0.2×0 = 21
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(LOCATION_ERROR)).toBeNull();
  });

  it('scenario 4: the response stream fails permanently → error + retry, no infinite skeleton, headline intact', async () => {
    const backend = new MockBackend({ faults: { get_company_responses_page: () => true } });
    server.use(...backend.handlers());
    seedSession();
    renderDashboard({ route: '/monitor' });

    // The real page plan (0 / 2.5 s / 6 s backoff) times the query-level
    // retry runs its course; then the table must resolve to an error state.
    await screen.findByText(STREAM_ERROR, {}, { timeout: 80_000 });
    expect(document.querySelectorAll('[aria-busy="true"]').length).toBe(0);
    expect(screen.getAllByRole('button', { name: /retry/i }).length).toBeGreaterThan(0);
    expect(backend.counters.get_company_responses_page).toBeGreaterThanOrEqual(2);

    // Rollup-backed headline metrics were never blocked on the stream.
    await user_navigateToOverview();
    await waitForScorecard();
    await waitFor(() => expect(readMetric('sentiment')?.text).toBe(F.EXPECTED.sentiment), { timeout: 20_000 });
    expectHeadline(F.EXPECTED);
  });

  it('scenario 5: cold login → auth → company → default location → dashboard never paints a false zero', async () => {
    const backend = new MockBackend();
    server.use(...backend.handlers());
    // No stored session: the route guard sends the visitor to sign in.
    const watch = watchScorecard();
    renderDashboard();
    await screen.findByText('Sign in', {}, { timeout: 10_000 });
    expect(metricEl('eps')).toBeNull();

    const { error } = await supabase.auth.signInWithPassword({ email: 'repro@example.com', password: 'correct-horse' });
    expect(error).toBeNull();

    // auth → company resolved (organization_members) → default location from
    // user metadata → dashboard RPCs, including the location family.
    await waitForScorecard();
    await waitFor(() => expect(readMetric('eps')?.text).toBe(F.EXPECTED.eps), { timeout: 30_000 });
    watch.stop();
    expectHeadline(F.EXPECTED);
    expect(watch.falseZeros()).toEqual([]);
    expect(backend.calls.some((c) => c.path === '/auth/v1/token')).toBe(true);
    expect(backend.calls.some((c) => c.path === '/rest/v1/organization_members')).toBe(true);
    expect(backend.counters.get_location_rollups).toBeGreaterThanOrEqual(1);
    // The default location resolved from the profile is what the header shows.
    expect(within(document.body).getAllByText(/United States/).length).toBeGreaterThan(0);
  });
});

// Overview is reachable from the Prompts page through the sidebar entry
// (rendered as a button that navigates).
async function user_navigateToOverview() {
  const user = userEvent.setup();
  await user.click(screen.getAllByText(/^Overview$/)[0]);
}
