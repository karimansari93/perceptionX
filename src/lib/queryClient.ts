import { QueryCache, QueryClient } from '@tanstack/react-query';
import { reportDashboardQueryError } from '@/lib/observability';

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
        staleTime: 5 * 60 * 1000, // 5 minutes
        refetchOnWindowFocus: false, // Don't refetch when tab regains focus
        refetchOnMount: false, // Don't refetch when component mounts
        refetchOnReconnect: false, // Don't refetch when internet reconnects
      },
    },
  });
