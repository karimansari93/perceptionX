// Actions tab: an organisation with nothing published sees the empty state,
// never a broken board.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

describe('ActionsTab', () => {
  it('shows the empty state when no actions are published', async () => {
    vi.resetModules();
    // Every query resolves to no rows, whatever the chain.
    const chain: any = new Proxy(() => chain, {
      get: (_t, prop) => (prop === 'then' ? (resolve: (v: unknown) => void) => resolve({ data: [], error: null }) : chain),
      apply: () => chain,
    });
    vi.doMock('@/integrations/supabase/client', () => ({ supabase: { from: () => chain, rpc: () => chain } }));
    vi.doMock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
    vi.doMock('@/contexts/CompanyContext', () => ({
      useCompany: () => ({ currentCompany: { id: 'c-1', name: 'Acme', organization_id: 'org-1' }, isOwnerOrAdmin: false }),
    }));
    const { ActionsTab } = await import('@/components/dashboard/ActionsTab');

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><ActionsTab selectedLocation={null} locationOptions={[]} /></MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('No actions yet')).toBeInTheDocument();
    expect(screen.queryByText('Suggested')).not.toBeInTheDocument();
  });
});
