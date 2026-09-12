import { QueryCache, QueryClient } from '@tanstack/react-query';
import { del as idbDel } from 'idb-keyval';
import { reportDashboardQueryError } from '@/lib/observability';

// IndexedDB key of the persisted dashboard snapshot (src/App.tsx persister).
export const DASHBOARD_CACHE_KEY = 'px-dashboard-cache-v1';

// Retry spacing for dashboard fetch families: exponential from 3 s with up
// to 1.5 s of jitter (3–4.5 s, then 6–7.5 s). The library default retried
// after 1 s, straight back into the same saturated window that had just
// cancelled the statement at the 8 s timeout, and every client retrying in
// lockstep re-formed the herd (reliability audit P1-2).
export const dashboardRetryDelay = (attemptIndex: number): number =>
  Math.min(3000 * 2 ** attemptIndex, 15000) + Math.random() * 1500;

// The one QueryClient configuration for the app AND the regression tests
// (src/test/renderDashboard.tsx), so the retry policy and the error
// reporting hook cannot drift between the two.
export const createQueryClient = () =>
  new QueryClient({
    queryCache: new QueryCache({
      // Fires once per query after its retries are exhausted — the moment a
      // family becomes "unavailable" on screen is the moment it is reported
      // (docs/OBSERVABILITY.md).
      onError: (error, query) => {
        reportDashboardQueryError(error, query.queryKey);
      },
    }),
    defaultOptions: {
      queries: {
        retry: 1,
        retryDelay: dashboardRetryDelay,
        staleTime: 5 * 60 * 1000, // 5 minutes
        refetchOnWindowFocus: false, // Don't refetch when tab regains focus
        refetchOnMount: false, // Don't refetch when component mounts
        refetchOnReconnect: false, // Don't refetch when internet reconnects
      },
    },
  });

// Sign-out hygiene (reliability audit P2-3): drop every cached family and the
// persisted snapshot so nothing of the previous account stays on a shared
// device. Storage may be unavailable (private mode, tests) — never throw.
export const clearDashboardCaches = async (queryClient: QueryClient): Promise<void> => {
  queryClient.clear();
  try {
    await idbDel(DASHBOARD_CACHE_KEY);
  } catch {
    /* storage unavailable — nothing persisted to clear */
  }
};
