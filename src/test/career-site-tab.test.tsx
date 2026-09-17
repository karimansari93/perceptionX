import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { server } from './msw/server';
import { MockBackend } from './msw/supabase';
import { renderDashboard, seedSession } from './renderDashboard';

// Renders the real tab through the real dashboard providers, so the cube
// shapes the RPCs return are exercised end-to-end rather than mocked at the
// hook boundary.

const overview = {
  domains: [
    { domain: 'pepsicojobs.com', citations: 1114, is_primary: true, source: 'detected' },
    { domain: 'stories.pepsicojobs.com', citations: 76, is_primary: false, source: 'detected' },
  ],
  pages: [
    {
      url: 'https://www.pepsicojobs.com/applicant-help',
      response_month: '2026-07-01',
      responses_citing: 131,
      title: 'Applicant Help - PepsiCo Careers',
      page_kind: 'content',
    },
    {
      url: 'https://www.pepsicojobs.com/main/jobs/389390',
      response_month: '2026-07-01',
      responses_citing: 41,
      title: 'Deputy Manager - Data Science',
      page_kind: 'job_posting',
    },
  ],
  scope_totals: [{ response_month: '2026-07-01', total_responses: 1000 }],
  page_total: 2,
};

const gaps = {
  rows: [
    {
      attribute_id: 'compensation',
      response_month: '2026-07-01',
      answers: 95,
      answers_owned: 24,
      answers_benchmark: 64,
    },
    {
      attribute_id: 'application-process',
      response_month: '2026-07-01',
      answers: 56,
      answers_owned: 39,
      answers_benchmark: 31,
    },
  ],
};

const mount = (rpc: Record<string, () => unknown>) => {
  const backend = new MockBackend({ rpc });
  server.use(...backend.handlers());
  seedSession();
  return renderDashboard({ route: '/dashboard/career-site' });
};

describe('Career Site tab', () => {
  it('names the detected career-site property', async () => {
    mount({
      get_career_site_overview: () => overview,
      get_career_site_gaps: () => gaps,
    });
    expect(await screen.findByText('pepsicojobs.com', {}, { timeout: 30_000 })).toBeTruthy();
  });

  it('shows topic ownership as career site vs third party, not as sentiment', async () => {
    mount({
      get_career_site_overview: () => overview,
      get_career_site_gaps: () => gaps,
    });
    await screen.findByText('pepsicojobs.com', {}, { timeout: 30_000 });
    // compensation: 24/95 owned = 25%, 64/95 benchmark = 67%.
    await waitFor(() => expect(screen.getByText('25% vs 67%')).toBeTruthy());
    // application-process runs the other way: 39/56 = 70% vs 31/56 = 55%.
    expect(screen.getByText('70% vs 55%')).toBeTruthy();
  });

  it('raises a critical action on the topic third parties own', async () => {
    mount({
      get_career_site_overview: () => overview,
      get_career_site_gaps: () => gaps,
    });
    await waitFor(
      () => expect(screen.getByText(/Third parties own the answer on compensation/i)).toBeTruthy(),
      { timeout: 30_000 },
    );
    expect(screen.getByText(/Losing the answer/i)).toBeTruthy();
  });

  it('separates job postings from durable content pages', async () => {
    mount({
      get_career_site_overview: () => overview,
      get_career_site_gaps: () => gaps,
    });
    await waitFor(() => expect(screen.getByText(/Content pages \(1\)/)).toBeTruthy(), { timeout: 30_000 });
    expect(screen.getByText(/Job postings \(1\)/)).toBeTruthy();
  });

  it('explains itself instead of erroring when no career site is detected', async () => {
    mount({
      get_career_site_overview: () => ({ domains: [], pages: [], scope_totals: [], page_total: 0 }),
      get_career_site_gaps: () => ({ rows: [] }),
    });
    expect(
      await screen.findByText(/No career site detected/i, {}, { timeout: 30_000 }),
    ).toBeTruthy();
  });
});
