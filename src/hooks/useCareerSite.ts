// Data for the Career Site tab.
//
// Two cube fetches per (scope, location), month grain kept in the payload so
// the period toggle pools client-side with no refetch — the same shape the
// domain and competitor cubes use. Passages are fetched lazily, per page,
// only once a page is opened in the preview.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  dashboardKeys,
  fetchCareerSiteGaps,
  fetchCareerSiteOverview,
  fetchCareerSitePassages,
  type CareerSiteDomainRow,
  type CareerSitePageRow,
  type CubeLocationParams,
} from '@/hooks/dashboard/dashboardQueries';
import { quarterKeyOfMonthStr } from '@/utils/quarterKey';
import { aggregateOwnership, deriveActions } from '@/lib/careerSite/actions';

const FRESH_MS = 5 * 60 * 1000;
const KEEP_MS = 30 * 60 * 1000;

export interface CareerSitePage {
  url: string;
  title: string | null;
  pageKind: 'content' | 'job_posting';
  responsesCiting: number;
  /** % of answers in the active window citing this page. */
  share: number;
  /** Percentage-point change against the previous quarter, null when none. */
  changePoints: number | null;
}

interface UseCareerSiteArgs {
  params: CubeLocationParams;
  scopeKey: string;
  locationKey: string;
  quarterKey: string | null;
  prevQuarterKey: string | null;
  enabled: boolean;
}

const inQuarter = (month: string, quarter: string | null): boolean =>
  !quarter || quarterKeyOfMonthStr(String(month)) === quarter;

export function useCareerSite({
  params, scopeKey, locationKey, quarterKey, prevQuarterKey, enabled,
}: UseCareerSiteArgs) {
  const overviewQuery = useQuery({
    queryKey: dashboardKeys.careerSiteOverview(scopeKey, locationKey),
    queryFn: ({ signal }) => fetchCareerSiteOverview(params, signal),
    enabled,
    staleTime: FRESH_MS,
    gcTime: KEEP_MS,
    retry: 2,
  });

  const gapsQuery = useQuery({
    queryKey: dashboardKeys.careerSiteGaps(scopeKey, locationKey),
    queryFn: ({ signal }) => fetchCareerSiteGaps(params, signal),
    enabled,
    staleTime: FRESH_MS,
    gcTime: KEEP_MS,
    retry: 2,
  });

  const domains: CareerSiteDomainRow[] = useMemo(
    () => overviewQuery.data?.domains ?? [],
    [overviewQuery.data],
  );

  const primaryDomain = useMemo(
    () => domains.find((d) => d.is_primary)?.domain ?? domains[0]?.domain ?? null,
    [domains],
  );

  // Denominator for page share: total answers in the active window, from the
  // same scope cube the rest of the dashboard divides by.
  const answersInWindow = useMemo(() => {
    const totals = overviewQuery.data?.scope_totals ?? [];
    return totals
      .filter((t) => inQuarter(t.response_month, quarterKey))
      .reduce((sum, t) => sum + (Number(t.total_responses) || 0), 0);
  }, [overviewQuery.data, quarterKey]);

  const answersInPrevWindow = useMemo(() => {
    const totals = overviewQuery.data?.scope_totals ?? [];
    if (!prevQuarterKey) return 0;
    return totals
      .filter((t) => inQuarter(t.response_month, prevQuarterKey))
      .reduce((sum, t) => sum + (Number(t.total_responses) || 0), 0);
  }, [overviewQuery.data, prevQuarterKey]);

  const pages: CareerSitePage[] = useMemo(() => {
    const rows: CareerSitePageRow[] = overviewQuery.data?.pages ?? [];
    const current = new Map<string, { citing: number; title: string | null; kind: 'content' | 'job_posting' }>();
    const previous = new Map<string, number>();

    for (const row of rows) {
      const citing = Number(row.responses_citing) || 0;
      if (inQuarter(row.response_month, quarterKey)) {
        const entry = current.get(row.url) ?? { citing: 0, title: null, kind: row.page_kind };
        entry.citing += citing;
        entry.title = entry.title ?? row.title;
        current.set(row.url, entry);
      }
      if (prevQuarterKey && inQuarter(row.response_month, prevQuarterKey)) {
        previous.set(row.url, (previous.get(row.url) ?? 0) + citing);
      }
    }

    return Array.from(current.entries())
      .map(([url, entry]) => {
        const share = answersInWindow > 0 ? (entry.citing / answersInWindow) * 100 : 0;
        const prevCiting = previous.get(url) ?? 0;
        const prevShare = answersInPrevWindow > 0 ? (prevCiting / answersInPrevWindow) * 100 : null;
        return {
          url,
          title: entry.title,
          pageKind: entry.kind,
          responsesCiting: entry.citing,
          share,
          // Only a window that actually measured the previous quarter can
          // carry a delta; a page absent then is a real 0, not a null.
          changePoints: prevShare === null ? null : share - prevShare,
        };
      })
      .sort((a, b) => b.responsesCiting - a.responsesCiting);
  }, [overviewQuery.data, quarterKey, prevQuarterKey, answersInWindow, answersInPrevWindow]);

  const ownership = useMemo(() => {
    const rows = (gapsQuery.data?.rows ?? []).filter((r) => inQuarter(r.response_month, quarterKey));
    return aggregateOwnership(rows);
  }, [gapsQuery.data, quarterKey]);

  const actions = useMemo(() => deriveActions(ownership), [ownership]);

  return {
    domains,
    primaryDomain,
    pages,
    ownership,
    actions,
    answersInWindow,
    pageTotal: overviewQuery.data?.page_total ?? 0,
    isLoading: overviewQuery.isPending || gapsQuery.isPending,
    isError: overviewQuery.isError || gapsQuery.isError,
    refetch: () => { void overviewQuery.refetch(); void gapsQuery.refetch(); },
  };
}

/** Passages a Google surface quoted from one page. Fetched on preview open. */
export function useCareerSitePassages(scopeIds: string[], scopeKey: string, url: string | null) {
  return useQuery({
    queryKey: dashboardKeys.careerSitePassages(scopeKey, url ?? ''),
    queryFn: ({ signal }) => fetchCareerSitePassages(scopeIds, url, signal),
    enabled: !!url && scopeIds.length > 0,
    staleTime: FRESH_MS,
    gcTime: KEEP_MS,
  });
}
