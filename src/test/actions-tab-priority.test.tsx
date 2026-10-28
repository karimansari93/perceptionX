// Actions tab with a labelled register: the priority chip on every card and
// in the detail, High first in a column, only the market's own actions under
// a market (the Global fix stays with the all-markets view), the
// priority filter and the header note. The register's timing never shows.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const row = (over: Record<string, unknown>) => ({
  id: String(over.id), organization_id: 'org-1', key: String(over.id), register: 'act_now', cycle_raised: '2026-10-01',
  action_number: null, problem: null, ai_says: null, ai_reads: [], urls: [], recommendation: 'Do the thing.', lanes: [],
  timing: 'act_now', work_kind: 'owned_content', markets: [], owner_name: null, assignee_id: null, work_status: 'open',
  tracking_status: 'open', assertion_note: null, assertion_url: null, asserted_done_at: null, notes: null,
  published_at: '2026-10-27', created_at: '2026-10-27', priority: null, priority_reason: null,
  ...over,
});

const rows = [
  row({ id: 'hiring', title: 'Publish how hiring works on postings and the FAQ.', markets: ['Global'], priority: 'high', priority_reason: 'The hiring topics hold 22% of the negative opinions.' }),
  row({ id: 'canada', title: 'Canada: replace the contact line.', markets: ['Canada'], priority: 'medium', priority_reason: 'The applying cell is 47% positive.' }),
  row({ id: 'germany', title: 'Zeta: a Germany only action.', markets: ['Germany'], priority: 'low', priority_reason: 'Small share.' }),
  row({ id: 'plain', title: 'Aardvark: an unlabelled action.', markets: [], priority: null, timing: 'act_later' }),
];

const titles = (col: HTMLElement) => within(col).getAllByRole('heading', { level: 4 }).map((h) => h.textContent);

async function mount(selectedLocation: string | null) {
  vi.resetModules();
  const chainFor = (data: unknown[]) => {
    const chain: any = new Proxy(() => chain, {
      get: (_t, prop) => (prop === 'then' ? (resolve: (v: unknown) => void) => resolve({ data, error: null }) : chain),
      apply: () => chain,
    });
    return chain;
  };
  vi.doMock('@/integrations/supabase/client', () => ({
    supabase: { from: (table: string) => chainFor(table === 'company_actions' ? rows : []), rpc: () => chainFor([]) },
  }));
  vi.doMock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
  vi.doMock('@/contexts/CompanyContext', () => ({
    brandOf: (c: { name: string }) => c.name,
    useCompany: () => ({ currentCompany: { id: 'c-1', name: 'Acme', organization_id: 'org-1' }, userCompanies: [], switchCompany: async () => {}, isOwnerOrAdmin: false }),
  }));
  const { ActionsTab } = await import('@/components/dashboard/ActionsTab');
  const options = [
    { canonicalKey: 'canada', label: 'Canada', rawValues: ['Canada'], icon: 'flag', flagCode: 'CA', companyIds: [] },
    { canonicalKey: 'germany', label: 'Germany', rawValues: ['Germany'], icon: 'flag', flagCode: 'DE', companyIds: [] },
  ] as never;
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><ActionsTab selectedLocation={selectedLocation} locationOptions={options} /></MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText('Suggested');
  return view;
}

describe('ActionsTab priority', () => {
  it('shows the chip on every labelled card, High first, with the note and no timing wording', async () => {
    const { container } = await mount(null);
    expect(screen.getByText('Priority is the expected effect on what AI tells candidates. When to act is your call.')).toBeInTheDocument();
    // All-markets view: every action is for you, High, Medium, Low, then unlabelled.
    const suggested = screen.getByRole('region', { name: 'Suggested' });
    expect(titles(suggested)).toEqual([
      'Publish how hiring works on postings and the FAQ.',
      'Replace the contact line.',
      'Zeta: a Germany only action.',
      'Aardvark: an unlabelled action.',
    ]);
    expect(within(suggested).getByLabelText('High priority')).toHaveTextContent('High');
    expect(within(suggested).getByLabelText('Low priority')).toHaveTextContent('Low');
    expect(container.textContent).not.toMatch(/act (now|next|later)/i);
    expect(screen.getByRole('combobox', { name: 'Priority' })).toHaveTextContent('All priorities');
  });

  it('under a market, For you shows only that market; All adds the rest sorted High, Medium, Low, unlabelled', async () => {
    await mount('canada');
    const suggested = screen.getByRole('region', { name: 'Suggested' });
    expect(titles(suggested)).toEqual(['Replace the contact line.']);
    expect(within(suggested).getByLabelText('Medium priority')).toHaveTextContent('Medium');
    expect(within(suggested).queryByLabelText('High priority')).toBeNull();
    // "All" adds the Global, Germany and unlabelled actions.
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(titles(screen.getByRole('region', { name: 'Suggested' }))).toEqual([
      'Publish how hiring works on postings and the FAQ.',
      'Replace the contact line.',
      'Zeta: a Germany only action.',
      'Aardvark: an unlabelled action.',
    ]);
    expect(screen.getByLabelText('Low priority')).toHaveTextContent('Low');
  });

  it('the detail says why this priority', async () => {
    await mount(null);
    fireEvent.click(screen.getByRole('heading', { level: 4, name: 'Publish how hiring works on postings and the FAQ.' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Why this priority:')).toBeInTheDocument();
    expect(within(dialog).getByText(/The hiring topics hold 22% of the negative opinions\./)).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/act (now|next|later)/i);
  });
});
