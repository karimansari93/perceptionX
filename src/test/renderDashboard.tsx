import { useEffect, type ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/lib/queryClient';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { CompanyProvider } from '@/contexts/CompanyContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import Dashboard from '@/pages/Dashboard';
import * as F from './fixtures/dashboard';

// The app's own QueryClient factory (src/lib/queryClient.ts): the retry
// policy is part of what the scenarios reproduce (one query-level retry on
// top of the page plan) and the QueryCache hook is what reports failures.
export const makeQueryClient = createQueryClient;

// Stand-in for the sign-in page: the real one navigates to /dashboard once
// signInWithPassword resolves (src/pages/Auth.tsx); this does the same.
const AuthStub = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (user) navigate('/dashboard'); }, [user, navigate]);
  return <div>Sign in</div>;
};

// Persist a session exactly where supabase-js keeps it, so getSession()
// resolves the user without a network round-trip (a warm "already logged in"
// tab). Omit this for the cold-login scenario.
export const seedSession = () => {
  localStorage.setItem(F.STORAGE_KEY, JSON.stringify(F.session));
};

export interface RenderOptions {
  route?: '/dashboard' | '/monitor';
  // Rendered inside the providers (next to the routes) — for tests that need
  // to drive a context action such as sign-out.
  probe?: ReactNode;
}

// The provider tree the real app wraps the dashboard in (src/App.tsx), minus
// the IndexedDB persister (cold path) and analytics.
export const renderDashboard = ({ route = '/dashboard', probe = null }: RenderOptions = {}) => {
  const queryClient = makeQueryClient();
  const tree: ReactNode = (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[route]}>
          <AuthProvider>
            <CompanyProvider>
              {probe}
              <Routes>
                <Route path="/auth" element={<AuthStub />} />
                <Route path="/dashboard" element={
                  <ProtectedRoute>
                    <SidebarProvider>
                      <Dashboard defaultGroup="dashboard" defaultSection="overview" />
                    </SidebarProvider>
                  </ProtectedRoute>
                } />
                <Route path="/monitor" element={
                  <ProtectedRoute>
                    <SidebarProvider>
                      <Dashboard defaultGroup="monitor" defaultSection="prompts" />
                    </SidebarProvider>
                  </ProtectedRoute>
                } />
                <Route path="*" element={<div>Route not under test</div>} />
              </Routes>
            </CompanyProvider>
          </AuthProvider>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
  return { ...render(tree), queryClient };
};

// ---- DOM readers for the Overview scorecard ----
export type MetricName = 'eps' | 'sentiment' | 'visibility' | 'relevance';
// Prefers the data-metric hooks the remediated scorecard renders. The
// fallback reads the pre-remediation markup (Breakdown row label → value
// span, EPS header value) so this suite demonstrably FAILS on the code that
// produced the incident, rather than timing out on a missing hook.
export const metricEl = (name: MetricName): HTMLElement | null => {
  const hooked = document.querySelector<HTMLElement>(`[data-metric="${name}"]`);
  if (hooked) return hooked;
  if (name === 'eps') {
    return document.querySelector<HTMLElement>('[data-tour="eps-card"] span.font-headline.text-2xl');
  }
  const label = name.charAt(0).toUpperCase() + name.slice(1);
  const row = Array.from(document.querySelectorAll<HTMLElement>('[data-tour="eps-breakdown"] span'))
    .find((el) => el.textContent?.trim() === label);
  return (row?.nextElementSibling as HTMLElement | null) ?? null;
};
export const readMetric = (name: MetricName) => {
  const el = metricEl(name);
  return el
    ? { text: el.textContent?.trim() ?? '', unavailable: el.getAttribute('data-unavailable') === 'true' }
    : null;
};

// Records every value a scorecard metric ever shows while it is running —
// the "never paint a false zero, not even for one frame" invariant is
// checked against this log, not just the final state.
export const watchScorecard = () => {
  const seen: Record<MetricName, Set<string>> = { eps: new Set(), sentiment: new Set(), visibility: new Set(), relevance: new Set() };
  const sample = () => {
    (['eps', 'sentiment', 'visibility', 'relevance'] as MetricName[]).forEach((name) => {
      const m = readMetric(name);
      if (m) seen[name].add(m.unavailable ? `unavailable:${m.text}` : m.text);
    });
  };
  const observer = new MutationObserver(sample);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  return {
    seen,
    falseZeros: () =>
      (Object.entries(seen) as [MetricName, Set<string>][])
        .filter(([, values]) => values.has('0%') || values.has('0'))
        .map(([name]) => name),
    stop: () => { sample(); observer.disconnect(); },
  };
};
