import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCompany } from "@/contexts/CompanyContext";
import { PromptResponse, DashboardMetrics, CitationCount, PromptData, Citation, CompetitorMention, LLMMentionRanking } from "@/types/dashboard";
import { enhanceCitations, EnhancedCitation } from "@/utils/citationUtils";
import { getLLMDisplayName, getLLMLogo } from "@/config/llmLogos";
import { retrySupabaseQuery, retrySupabaseFunction, queryDebouncer, networkMonitor } from "@/utils/supabaseRetry";
import { parseCompetitors } from "@/utils/competitorUtils";
import { buildLocationOptions, canonicalizeLocationContext, companyCountryKey, GENERAL_KEY, resolveResponseLocationKey } from "@/utils/locationContext";
import { GLOBAL_LIKE } from "@/utils/locations";
import { readStarredView, stampStarredViewCompany, starredViewAppliesTo } from "@/hooks/useStarredView";

// Pure aggregation of `company_*_by_location_mv` rows into the same shape the
// company-wide MV fetch produces (snapshot + per-month map). Shared by the
// location-scoped metrics fetch so a sub-country filter (e.g. a city) re-scopes
// sentiment/relevance exactly like the company-wide path.
const aggregateSentimentRows = (rows: any[]): { metrics: any | null; byMonth: Record<string, number> } => {
  const agg = rows.reduce((acc, row) => {
    acc.totalThemes += row.total_themes || 0;
    acc.positiveThemes += row.positive_themes || 0;
    acc.negativeThemes += row.negative_themes || 0;
    acc.neutralThemes += row.neutral_themes || 0;
    acc.totalSentimentScore += (row.avg_sentiment_score || 0) * (row.total_themes || 0);
    acc.totalWeight += row.total_themes || 0;
    return acc;
  }, { totalThemes: 0, positiveThemes: 0, negativeThemes: 0, neutralThemes: 0, totalSentimentScore: 0, totalWeight: 0 });

  const metrics = agg.totalThemes > 0 ? {
    sentiment_ratio: agg.positiveThemes / agg.totalThemes,
    avg_sentiment_score: agg.totalWeight > 0 ? agg.totalSentimentScore / agg.totalWeight : 0,
    total_themes: agg.totalThemes,
    positive_themes: agg.positiveThemes,
    negative_themes: agg.negativeThemes,
    neutral_themes: agg.neutralThemes,
  } : null;

  const byMonthAcc: Record<string, { positive: number; total: number }> = {};
  rows.forEach(row => {
    if (!row.response_month) return;
    const key = String(row.response_month).slice(0, 7);
    if (!byMonthAcc[key]) byMonthAcc[key] = { positive: 0, total: 0 };
    byMonthAcc[key].positive += row.positive_themes || 0;
    byMonthAcc[key].total += row.total_themes || 0;
  });
  const byMonth: Record<string, number> = {};
  for (const [key, val] of Object.entries(byMonthAcc)) {
    byMonth[key] = val.total > 0 ? val.positive / val.total : 0;
  }
  return { metrics, byMonth };
};

const aggregateRelevanceRows = (rows: any[]): { metrics: any | null; byMonth: Record<string, number> } => {
  const agg = rows.reduce((acc, row) => {
    acc.totalCitations += row.total_citations || 0;
    acc.validCitations += row.valid_citations || 0;
    acc.totalRelevanceScore += (row.relevance_score || 0) * (row.valid_citations || 0);
    acc.totalWeight += row.valid_citations || 0;
    return acc;
  }, { totalCitations: 0, validCitations: 0, totalRelevanceScore: 0, totalWeight: 0 });

  const metrics = agg.validCitations > 0 ? {
    relevance_score: agg.totalWeight > 0 ? agg.totalRelevanceScore / agg.totalWeight : 0,
    total_citations: agg.totalCitations,
    valid_citations: agg.validCitations,
  } : null;

  const byMonthAcc: Record<string, { scoreSum: number; weight: number }> = {};
  rows.forEach(row => {
    if (!row.response_month) return;
    const key = String(row.response_month).slice(0, 7);
    if (!byMonthAcc[key]) byMonthAcc[key] = { scoreSum: 0, weight: 0 };
    const w = row.valid_citations || 0;
    byMonthAcc[key].scoreSum += (row.relevance_score || 0) * w;
    byMonthAcc[key].weight += w;
  });
  const byMonth: Record<string, number> = {};
  for (const [key, val] of Object.entries(byMonthAcc)) {
    byMonth[key] = val.weight > 0 ? val.scoreSum / val.weight : 0;
  }
  return { metrics, byMonth };
};

// Collapse `company_attribute_themes_by_location_mv` rows (one per location
// bucket) into the same per (attribute, month, job_function) shape that
// `company_attribute_themes_mv` produces, so the Themes tab and Overview
// attribute cards consume location-scoped rows without any shape change.
const aggregateAttributeThemeRows = (rows: any[]): any[] => {
  const acc = new Map<string, any>();
  for (const r of rows) {
    const key = `${r.attribute_id}|${r.response_month ?? ''}|${r.job_function_context ?? ''}`;
    let e = acc.get(key);
    if (!e) {
      e = {
        attribute_id: r.attribute_id,
        response_month: r.response_month,
        job_function_context: r.job_function_context,
        total_themes: 0, positive_themes: 0, negative_themes: 0, neutral_themes: 0,
        response_count: 0, _sentSum: 0, _sentW: 0,
      };
      acc.set(key, e);
    }
    e.total_themes += r.total_themes || 0;
    e.positive_themes += r.positive_themes || 0;
    e.negative_themes += r.negative_themes || 0;
    e.neutral_themes += r.neutral_themes || 0;
    e.response_count += r.response_count || 0;
    e._sentSum += (r.avg_sentiment_score || 0) * (r.total_themes || 0);
    e._sentW += r.total_themes || 0;
  }
  return Array.from(acc.values()).map(({ _sentSum, _sentW, ...rest }) => ({
    ...rest,
    avg_sentiment_score: _sentW > 0 ? _sentSum / _sentW : 0,
  }));
};

// Global cap on concurrent Supabase requests from this hook. A 10-profile
// brand fans out to ~90 simultaneous queries across the fetch families
// (response pages, prompts, metric MVs, rankings, themes, sentiment,
// visibility) — individually cheap, but together they saturate the database
// connection pool, everything queues past the ~8s statement timeout, and the
// whole load fails with HTTP 500s (observed on flagship multi-country
// brands). Every per-company/per-page loop below routes through this gate:
// ~6 in flight keeps the pipeline saturated without stampeding Postgres.
// A slot is held across retry backoff too — deliberate backpressure while
// the database is struggling.
// TWO-TIER: the gate is FIFO within a tier, but critical-path fetches (the
// small ones first paint depends on — prompts, rollup MVs, visibility) always
// jump ahead of queued BULK row streams (response pages, raw ai_themes).
// Without the tiers, an explicit refresh on an 18-profile brand queued the
// prompts fetch's sequential pages behind ~90 ai_themes/response-page jobs
// (some 8s each) — measured 65s before prompts finished and the skeleton
// cleared, on a dashboard whose rollups were done at 4s.
const DB_CONCURRENCY = 6;
let dbInFlight = 0;
const dbWaiters: Array<() => void> = [];
const dbBulkWaiters: Array<() => void> = [];
const withDbSlot = async <T,>(
  fn: () => Promise<T> | PromiseLike<T>,
  opts?: { bulk?: boolean }
): Promise<T> => {
  while (dbInFlight >= DB_CONCURRENCY) {
    await new Promise<void>(resolve => (opts?.bulk ? dbBulkWaiters : dbWaiters).push(resolve));
  }
  dbInFlight += 1;
  try {
    return await fn();
  } finally {
    dbInFlight -= 1;
    const next = dbWaiters.shift() ?? dbBulkWaiters.shift();
    if (next) next();
  }
};

// Aggregate visibility rollup rows (company_visibility_by_location_mv) to a
// percentage + counts, optionally scoped to one snapshot month ("YYYY-MM") and
// one job function ('' = untagged bucket). Returns null when no rows match so
// callers fall back to raw-response computation (MV empty / not yet
// refreshed) instead of showing a false 0%.
const visibilityFromMvRows = (
  rows: any[],
  monthKey: string | null,
  jobFn: string | null
): { pct: number; total: number; mentioned: number } | null => {
  let total = 0;
  let mentioned = 0;
  for (const r of rows) {
    if (monthKey && String(r.response_month).slice(0, 7) !== monthKey) continue;
    if (jobFn !== null && (r.job_function_context || '') !== jobFn) continue;
    total += r.total_responses || 0;
    mentioned += r.mentioned_responses || 0;
  }
  if (total === 0) return null;
  return { pct: (mentioned / total) * 100, total, mentioned };
};

// Eager raw-response window (days). Shared by the background response fetch
// and the rollup-derived period fallback so both agree on which months can
// exist in the dashboard's working set.
const EAGER_DAYS = 180;

// Sum MV rows by a key column (e.g. domain → citation_count). Needed wherever
// rows can arrive from several companies/location buckets that repeat a key.
const sumRowsBy = (rows: any[], keyField: string, valField: string): Record<string, number> => {
  const acc: Record<string, number> = {};
  (rows || []).forEach(r => {
    const k = r[keyField];
    if (!k) return;
    acc[k] = (acc[k] || 0) + (r[valField] || 0);
  });
  return acc;
};

export interface PeriodInfo {
  key: string;       // e.g. "2026-03"
  label: string;     // e.g. "Mar 2026"
  startDate: Date;
  endDate: Date;
}

// Canonical month bucket for a response: the monthly-snapshot month
// (response_month, e.g. "2026-06-01" → "2026-06"), NOT when the row was
// physically written (tested_at/created_at). A run collected on May 30 but
// tagged collection_cycle = June must show under June everywhere. Falls back
// to tested_at/created_at only for legacy rows missing response_month.
export const responseMonthKey = (r: { response_month?: string | null; tested_at?: string; created_at?: string }): string | null => {
  if (r.response_month) return String(r.response_month).slice(0, 7);
  const t = r.tested_at || r.created_at;
  if (!t) return null;
  const d = new Date(t);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// "Overall Candidate Experience" is being deprecated and removed soon. Hide its
// prompts/responses from every dashboard view by filtering them out centrally.
export const isOverallCandidateExperience = (r: { confirmed_prompts?: any }): boolean => {
  const cp = r?.confirmed_prompts || {};
  const attr = String(cp.attribute_id || '').toLowerCase().trim();
  const theme = String(cp.prompt_theme || '').toLowerCase().trim();
  return attr === 'overall-candidate-experience' || theme === 'overall candidate experience';
};

export const useDashboardData = () => {
  const { user: rawUser, clearSession } = useAuth();
  const { currentCompany, userCompanies, loading: companyLoading } = useCompany();

  // Memoize user to avoid unnecessary effect reruns
  const user = useMemo(() => rawUser, [rawUser?.id]);

  // THE BRAND SCOPE: the current company plus its same-name sibling profiles
  // (legacy per-country rows, e.g. Netflix-US ↔ Netflix-JP) IN THE SAME
  // ORGANIZATION. Every dashboard fetch below is scoped to this whole group,
  // so "All locations" is a true cross-profile aggregate and each country is a
  // FILTER within it — not a company switch to a different dataset.
  //
  // The organization constraint is load-bearing: multi-org users (admins,
  // agencies) can see the same brand name across many client orgs, and
  // matching on name alone once grouped 18 unrelated profiles into one scope
  // — flooding the dashboard with cross-tenant queries heavy enough to hit
  // statement timeouts. Same-org groups are the only real sibling sets.
  const scopeCompanies = useMemo(() => {
    if (!currentCompany) return [] as { id: string; country: string | null }[];
    const nameLower = currentCompany.name.toLowerCase();
    const orgId = currentCompany.organization_id ?? null;
    const siblings = userCompanies
      .filter(
        c => c.id !== currentCompany.id &&
          c.name.toLowerCase() === nameLower &&
          (c.organization_id ?? null) === orgId
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    // NO size cap: flagship brands legitimately carry 18+ country profiles,
    // and truncating silently drops countries from the dropdown AND the
    // aggregated totals (a correctness bug, observed on Ford). Database load
    // is bounded by withDbSlot regardless of profile count; the cap was an
    // emergency crutch that predates it.
    if (siblings.length > 30) {
      console.warn(
        `[useDashboardData] unusually large brand scope: ${siblings.length + 1} same-name profiles in one org`
      );
    }
    return [currentCompany, ...siblings].map(c => ({ id: c.id, country: c.country ?? null }));
  }, [currentCompany, userCompanies]);
  const scopeCompanyIds = useMemo(
    () => (scopeCompanies.length > 0 ? scopeCompanies.map(c => c.id) : currentCompany?.id ? [currentCompany.id] : []),
    [scopeCompanies, currentCompany?.id]
  );
  // Order-independent signature for callback/effect deps.
  const scopeKey = useMemo(() => [...scopeCompanyIds].sort().join(','), [scopeCompanyIds]);
  const [responses, setResponses] = useState<PromptResponse[]>([]);
  const [responseTexts, setResponseTexts] = useState<Record<string, string>>({});
  // Period selection state
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null); // null = latest
  const [responseTextsLoading, setResponseTextsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [competitorLoading, setCompetitorLoading] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [hasDataIssues, setHasDataIssues] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | undefined>(undefined);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchResultsLoading, setSearchResultsLoading] = useState(false);
  const [searchTermsData, setSearchTermsData] = useState<any[]>([]);
  const [recencyData, setRecencyData] = useState<any[]>([]);
  const [recencyDataLoading, setRecencyDataLoading] = useState(false);
  const [aiThemes, setAiThemes] = useState<any[]>([]);
  const [aiThemesLoading, setAiThemesLoading] = useState(false);
  // Pre-aggregated theme data from materialized views (replaces the eager
  // ~24-page ai_themes pull on the dashboard's critical path).
  // - attributeThemes: per attribute x month x job_function rollup (company_attribute_themes_mv)
  // - responseSentimentRows: per-response positive/total themes + ratio (company_response_sentiment_mv)
  const [attributeThemes, setAttributeThemes] = useState<any[]>([]);
  const [responseSentimentRows, setResponseSentimentRows] = useState<any[]>([]);
  const [activePrompts, setActivePrompts] = useState<any[]>([]);
  const [isOnline, setIsOnline] = useState(networkMonitor.online);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [recencyDataError, setRecencyDataError] = useState<string | null>(null);
  // Pre-aggregated data from materialized views (Phase 1 MV migration)
  const [mvTopCitations, setMvTopCitations] = useState<CitationCount[]>([]);
  const [mvTopCompetitors, setMvTopCompetitors] = useState<{company: string; count: number}[]>([]);
  const [mvLlmRankings, setMvLlmRankings] = useState<LLMMentionRanking[]>([]);
  // Backend-calculated metrics from materialized views
  const [companySentimentMetrics, setCompanySentimentMetrics] = useState<any | null>(null);
  const [companyRelevanceMetrics, setCompanyRelevanceMetrics] = useState<any | null>(null);
  const [companyMetricsLoading, setCompanyMetricsLoading] = useState(false);
  // Per-month MV data for period comparison (keyed by "YYYY-MM")
  const [companyRelevanceByMonth, setCompanyRelevanceByMonth] = useState<Record<string, number>>({});
  const [companySentimentByMonth, setCompanySentimentByMonth] = useState<Record<string, number>>({});
  // Raw MV rows kept so the Overview tab can re-aggregate per job function.
  const [sentimentMvRows, setSentimentMvRows] = useState<any[]>([]);
  const [relevanceMvRows, setRelevanceMvRows] = useState<any[]>([]);
  // Location filter (canonical key from confirmed_prompts.location_context, or
  // null for "all locations"). When set, sentiment/relevance are re-scoped from
  // the `_by_location_mv` views below and responses are filtered in-memory.
  const [selectedLocation, setSelectedLocationState] = useState<string | null>(null);
  const [locationMetricsLoading, setLocationMetricsLoading] = useState(false);
  const [locSentimentMetrics, setLocSentimentMetrics] = useState<any | null>(null);
  const [locRelevanceMetrics, setLocRelevanceMetrics] = useState<any | null>(null);
  const [locSentimentByMonth, setLocSentimentByMonth] = useState<Record<string, number>>({});
  const [locRelevanceByMonth, setLocRelevanceByMonth] = useState<Record<string, number>>({});
  const [locSentimentMvRows, setLocSentimentMvRows] = useState<any[]>([]);
  const [locRelevanceMvRows, setLocRelevanceMvRows] = useState<any[]>([]);
  // Location-scoped sources / competitors / LLM rankings (from the
  // `_by_location_mv` views), used in place of the company-wide MV state when a
  // location is active so Sources, Competitors and the LLM list re-scope too.
  const [locMvTopCitations, setLocMvTopCitations] = useState<CitationCount[]>([]);
  const [locMvTopCompetitors, setLocMvTopCompetitors] = useState<{company: string; count: number}[]>([]);
  const [locMvLlmRankings, setLocMvLlmRankings] = useState<LLMMentionRanking[]>([]);
  const [locAttributeThemes, setLocAttributeThemes] = useState<any[]>([]);
  // Company whose responses have FULLY loaded (all pages committed, loaded
  // empty, or restored from cache). Distinguishes "no data yet" (selection
  // validity unknowable — don't judge) from "loaded with zero rows" (final —
  // a stale selection must clear). Reset synchronously on company switch.
  const [responsesLoadedCompanyId, setResponsesLoadedCompanyId] = useState<string | null>(null);
  // Distinct location_context buckets from the by-location MVs (all-time).
  // Widens the dropdown entries' raw-spelling sets beyond the 180-day eager
  // response window — see buildLocationOptions (extend-only).
  const [mvLocationBuckets, setMvLocationBuckets] = useState<string[]>([]);
  // Precomputed visibility rollup (company_visibility_by_location_mv):
  // mentioned/total per (profile, location bucket, snapshot month, job
  // function). A few hundred tiny rows per brand — every visibility number
  // derives from these, exactly, regardless of how much of the raw response
  // stream has arrived, and location/function/month re-scoping is a pure
  // client-side filter. Empty ⇒ consumers fall back to raw responses.
  const [visibilityMvRows, setVisibilityMvRows] = useState<any[]>([]);
  // True while the visibility rollup fetch is in flight. The readiness effect
  // uses it to hold the scorecard skeleton until visibility has an exact
  // source (rollup rows, or the raw fallback once responses arrive) — raw
  // responses are no longer on the critical path, so without this flag the
  // scorecards could paint a false 0%/fallback value before the rollup lands.
  const [visibilityMvLoading, setVisibilityMvLoading] = useState(false);

  // Public location setter. Flips the location-loading flag on the SAME tick as
  // the selection change (not later, when the fetch effect runs) so the UI goes
  // straight to a skeleton instead of briefly painting half-swapped content.
  // Skipped when re-selecting the current location (the fetch effect wouldn't
  // run, so the flag would never clear) or when clearing to "all locations"
  // (company-wide data is already loaded — no fetch, no skeleton needed).
  const selectedLocationRef = useRef(selectedLocation);
  selectedLocationRef.current = selectedLocation;
  const setSelectedLocation = useCallback((loc: string | null) => {
    if (loc && loc !== selectedLocationRef.current) setLocationMetricsLoading(true);
    setSelectedLocationState(loc);
  }, []);
  // Track if metrics are still being calculated (for UX - show all metrics together)
  // Start as true, will be set to false when all metrics are ready
  const [metricsCalculating, setMetricsCalculating] = useState(true);
  
  // Reset metricsCalculating when company changes or when starting to load
  useEffect(() => {
    if (currentCompany?.id) {
      setMetricsCalculating(true);
    }
  }, [currentCompany?.id]);
  
  // Also reset when loading starts
  useEffect(() => {
    if (loading) {
      setMetricsCalculating(true);
    }
  }, [loading]);
  // Pagination state for responses
  const [loadAllResponses, setLoadAllResponses] = useState(false); // Flag to load all historical data
  const [hasMoreResponses, setHasMoreResponses] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);   // Track polling interval
  const recencyDataCacheRef = useRef<{ responseIdsHash: string; data: any[] } | null>(null); // Cache recency data
  const previousResponseIdsRef = useRef<string>(''); // Track previous response IDs to detect changes
  // Cache company dashboard data for instant restore when switching back.
  // The MV/metrics snapshots are written by their fetches on
  // completion (never from mid-load state), so when an entry is fresh and
  // complete a switch-back restores everything and skips the network.
  const COMPANY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  const companyDataCacheRef = useRef<Record<string, {
    responses: PromptResponse[];
    aiThemes?: any[];
    attributeThemes?: any[];
    responseSentimentRows?: any[];
    activePrompts?: any[];
    lastUpdated?: Date;
    timestamp: number;
    mvData?: {
      topCitations: CitationCount[];
      topCompetitors: { company: string; count: number }[];
      llmRankings: LLMMentionRanking[];
    };
    companyMetrics?: {
      sentiment: any | null;
      relevance: any | null;
      sentimentByMonth: Record<string, number>;
      relevanceByMonth: Record<string, number>;
      sentimentMvRows: any[];
      relevanceMvRows: any[];
    };
  }>>({});
  // Tracks which company the user is currently looking at. Each fetch captures
  // the id at call time and compares against this ref before committing state,
  // so a slow response for a previously-selected company can't overwrite the
  // active company's data when the user switches quickly.
  const currentCompanyIdRef = useRef<string | undefined>(currentCompany?.id);

  // Network status monitoring - FIXED
  // Track if we're coming back online from being offline (vs just tab visibility change)
  const wasOfflineRef = useRef(!isOnline);
  
  useEffect(() => {
    const removeListener = networkMonitor.addListener((online) => {
      const wasOffline = wasOfflineRef.current;
      wasOfflineRef.current = !online;
      
      setIsOnline(online);
      if (online) {
        setConnectionError(null);
        // Only trigger refetch if:
        // 1. We have user and company
        // 2. We were actually offline before (not just tab visibility change)
        // 3. Tab is currently visible
        if (user?.id && currentCompany?.id && wasOffline && !document.hidden) {
          // Only refetch if we don't have data yet or if this is a real network reconnect
          if (!fetchedCompanyUserKeyRef.current || responses.length === 0) {
            setShouldRefetch(true); // Force refetch only if needed
          }
        }
      } else {
        setConnectionError('No internet connection. Please check your network.');
      }
    });

    return removeListener;
  }, [user?.id, currentCompany?.id, responses.length]); // Only IDs and responses length

  const fetchResponses = useCallback(async () => {
    if (!user || !currentCompany) {
      return;
    }

    // Check network status first
    if (!isOnline) {
      setConnectionError('No internet connection. Please check your network.');
      return;
    }

    // Capture the company at request time. Any state writes after an await
    // must check this against currentCompanyIdRef so a slow fetch for the
    // previously-selected company can't overwrite the active company's data.
    const requestedCompanyId = currentCompany.id;
    const isStale = () => currentCompanyIdRef.current !== requestedCompanyId;
    // Whole brand scope (current + same-name siblings) — aggregated view.
    const requestedScopeIds = scopeCompanyIds.length > 0 ? scopeCompanyIds : [requestedCompanyId];

    try {
      setLoading(true);
      setCompetitorLoading(true);
      setConnectionError(null);

      // Recent prompt_responses are bounded by 180 days to keep the eager
      // query under the 8s statement timeout for accounts with a lot of
      // history. Older rows are fetched on demand by tabs that need
      // historical drilldowns.
      const PAGE_SIZE = 1000;
      const eagerCutoffIso = new Date(Date.now() - EAGER_DAYS * 24 * 60 * 60 * 1000).toISOString();

      // Use the canonicalized view so detected_competitors arrives with
      // alias mapping already applied — no client-side normalization
      // needed (and no race condition between alias-map load and render).
      //
      // PER-COMPANY pages, one pagination per scope profile, merged
      // client-side. A single merged .in(scopeIds) query cannot be served by
      // the (company_id, tested_at) index — Postgres must merge/sort across
      // companies and re-walk rows for every OFFSET page, which blew the
      // statement timeout (500s) on brands with much history. Per-company
      // queries are exactly the shape the single-profile dashboard has always
      // run.
      //
      // No secondary ORDER BY tiebreaker: the (company_id, tested_at) index
      // satisfies this ordering directly, and a tiebreaker would force a
      // multi-MB sort node per page. Pages are deduped by id after fetch.
      const fetchResponsePage = (companyId: string, from: number, to: number, withCount: boolean) =>
        // bulk: response pages hydrate in the background — they must never
        // delay the critical-path fetches (prompts, rollup MVs) in the gate.
        withDbSlot(() => retrySupabaseQuery(() =>
          supabase
            .from('prompt_responses_canonical')
            .select(`
              id,
              confirmed_prompt_id,
              company_id,
              ai_model,
              tested_at,
              created_at,
              updated_at,
              response_month,
              company_mentioned,
              detected_competitors,
              citations,
              for_index,
              index_period,
              confirmed_prompts!inner(
                id,
                company_id,
                prompt_text,
                prompt_category,
                prompt_type,
                prompt_theme,
                job_function_context,
                location_context,
                industry_context,
                attribute_id
              )
            `, withCount ? { count: 'exact' } : undefined)
            .eq('company_id', companyId)
            .gte('tested_at', eagerCutoffIso)
            .order('tested_at', { ascending: false })
            .range(from, to)
        ) as Promise<{ data: any[] | null; error: any; count: number | null }>, { bulk: true });

      const byTestedAtDesc = (a: any, b: any) =>
        new Date(b.tested_at || b.created_at || 0).getTime() - new Date(a.tested_at || a.created_at || 0).getTime();

      // PostgREST clamps unpaginated requests to max_rows (1000); a
      // multi-profile brand can exceed that in prompts alone, silently losing
      // rows. Stable order + range pages fetch the complete set.
      const fetchAllPrompts = async (): Promise<{ data: any[] | null; error: any }> => {
        let all: any[] = [];
        for (let page = 0; page < 30; page += 1) {
          const result = await withDbSlot(() => retrySupabaseQuery(() =>
            supabase
              .from('confirmed_prompts')
              .select('id, user_id, prompt_text, company_id, prompt_category, prompt_theme, prompt_type, industry_context, job_function_context, location_context, attribute_id')
              .in('company_id', requestedScopeIds)
              .order('id', { ascending: true })
              .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
          ) as Promise<{ data: any[] | null; error: any }>);
          if (result.error) return result;
          const chunk = result.data ?? [];
          all = all.concat(chunk);
          if (chunk.length < PAGE_SIZE) break;
        }
        return { data: all, error: null };
      };

      // CRITICAL PATH: prompts only. Raw response rows are heavy (citations
      // jsonb, thousands of rows per profile) and everything the first paint
      // shows is rollup-first — so the response pages stream in the
      // BACKGROUND below, hydrating tables/drilldowns as they arrive. The
      // prompt list stays eager: it's small, and the Prompts table shell and
      // the "analysis in progress" detection need it.
      const promptsResult = await fetchAllPrompts();

      if (isStale()) return;

      const { data: userPrompts, error: promptsError } = promptsResult;

      if (promptsError) {
        console.error('🔍 Error fetching prompts:', promptsError);
        if (promptsError.message?.includes('permission') || promptsError.message?.includes('policy')) {
          throw new Error('You don\'t have permission to view prompts for this company. Please contact support if you believe this is an error.');
        }
        throw new Error('Unable to load prompts. Please refresh the page or try again later.');
      }

      if (!userPrompts || userPrompts.length === 0) {
        if (isStale()) return;
        setActivePrompts([]);
        setResponses([]);
        setResponsesLoadedCompanyId(requestedCompanyId); // loaded (empty) — final
        setLoading(false);
        setCompetitorLoading(false);
        return;
      }

      if (isStale()) return;
      setActivePrompts(userPrompts);
      setHasDataIssues(false);
      setHasMoreResponses(false);

      // FIRST PAINT HAPPENS HERE. The rollup fetches running in parallel
      // (fetchMVData / fetchCompanyMetrics / the visibility-MV effect) own
      // every headline number; nothing below this line gates the render.
      // Consumers key raw-dependent sections on responsesLoadedCompanyId to
      // show skeletons (not "No data") while the stream is still arriving.
      setLoading(false);
      setCompetitorLoading(false);

      // BACKGROUND: newest page of every profile's responses, in parallel
      // (per-company .eq pagination — the merged .in() ordered shape is the
      // statement-timeout incident, see §8 of the audit doc).
      const firstPageResults = await Promise.all(
        requestedScopeIds.map(id => fetchResponsePage(id, 0, PAGE_SIZE - 1, true))
      );

      if (isStale()) return;

      const responsesError = firstPageResults.find(r => r.error)?.error;
      if (responsesError) {
        throw responsesError;
      }

      const perCompanyFirstPages = firstPageResults.map(r => ({
        rows: r.data ?? [],
        total: r.count ?? (r.data?.length ?? 0),
      }));
      const firstPage = perCompanyFirstPages.flatMap(p => p.rows).sort(byTestedAtDesc);

      // Progressive hydration: commit the newest pages immediately instead of
      // holding the tables until every page (and attributes) arrives. State is
      // set again below with the full set once the background fetches land.
      setResponses(firstPage);
      if (firstPage.length > 0) {
        setLastUpdated(new Date(firstPage[0].tested_at || firstPage[0].updated_at || firstPage[0].created_at));
      }

      const fetchRemainingPages = async (): Promise<any[]> => {
        const jobs: Promise<{ data: any[] | null; error: any; count: number | null }>[] = [];
        requestedScopeIds.forEach((id, idx) => {
          const totalPages = Math.ceil(perCompanyFirstPages[idx].total / PAGE_SIZE);
          for (let p = 1; p < totalPages; p += 1) {
            jobs.push(fetchResponsePage(id, p * PAGE_SIZE, (p + 1) * PAGE_SIZE - 1, false));
          }
        });
        let all = perCompanyFirstPages.flatMap(p => p.rows);
        if (jobs.length > 0) {
          const rest = await Promise.all(jobs);
          for (const result of rest) {
            if (result.error) throw result.error;
            all = all.concat(result.data ?? []);
          }
        }
        // Offset pages can skid if rows land mid-fetch — dedupe by id.
        const seen = new Set<string>();
        return all
          .filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true)))
          .sort(byTestedAtDesc);
      };

      const data = await fetchRemainingPages();
      if (isStale()) return;

      let allResponses = data || [];

      // Attribute rows feed the Thematic tab and Overview's attribute cards.
      // They are a STRICT SUBSET of the stream just fetched (same table, same
      // company predicate, same 180-day window — just the attribute-tagged
      // prompts), so derive them client-side instead of re-downloading them.
      // The old second fetch family filtered on the embedded
      // confirmed_prompts.attribute_id, which forces the planner to drive
      // through confirmed_prompts (one index probe per attribute prompt,
      // measured ~50x slower per page than the (company_id, tested_at) path,
      // ~2.5s uncontended) plus an equally slow count: 'exact' — it kept
      // crossing the ~8s statement timeout (HTTP 500) during the initial
      // fan-out and, because its errors were swallowed, silently dropped all
      // attribute data when it did. The embedded prompt-company filter is
      // mirrored below (prompt must belong to the same profile as the row).
      const attributeRaw = allResponses.filter(r =>
        r.confirmed_prompts?.attribute_id != null &&
        (r.confirmed_prompts?.company_id == null || r.confirmed_prompts.company_id === r.company_id)
      );

      {
        try {
            // Filter to get only latest attribute responses per prompt+model
            const attributeLatestMap = new Map<string, any>();
            attributeRaw.forEach(response => {
              const key = `${response.confirmed_prompt_id}_${response.ai_model}`;
              if (!attributeLatestMap.has(key)) {
                attributeLatestMap.set(key, response);
              }
            });
            const attributeResponses = Array.from(attributeLatestMap.values());

            if (attributeResponses && attributeResponses.length > 0) {
              // Convert attribute responses to PromptResponse format
              const attributeResponsesFormatted: PromptResponse[] = attributeResponses.map(response => {
                const promptType = response.confirmed_prompts.prompt_type;
                const attributeId = response.confirmed_prompts.attribute_id || promptType;

                // Get prompt text from the confirmed_prompts join
                const promptText = response.confirmed_prompts?.prompt_text || `${promptType} analysis for ${attributeId}`;

                return {
                  id: response.id,
                  confirmed_prompt_id: response.confirmed_prompt_id,
                  company_id: response.confirmed_prompts.company_id,
                  ai_model: response.ai_model,
                  response_text: response.response_text,
                  citations: response.citations,
                  tested_at: response.tested_at || response.updated_at || response.created_at,
                  response_month: response.response_month,
                  company_mentioned: response.company_mentioned,
                  detected_competitors: response.detected_competitors,

                  confirmed_prompts: {
                    prompt_text: promptText,
                    prompt_category: attributeId.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase()),
                    prompt_type: promptType,
                    industry_context: response.confirmed_prompts.industry_context,
                    job_function_context: response.confirmed_prompts.job_function_context,
                    location_context: response.confirmed_prompts.location_context
                  }
                };
              });

              // Combine regular responses with attribute responses
              allResponses = [...allResponses, ...attributeResponsesFormatted];
            }
        } catch (error) {
          console.error('Error processing attribute responses:', error);
          // Continue with regular responses even if the attribute processing fails
        }
      }
      
      // Yield to the browser before the big state set so pending interactions
      // (clicks, scrolls) can be processed before the useMemo cascade fires.
      await new Promise(resolve => setTimeout(resolve, 0));

      if (isStale()) return;
      setResponses(allResponses);
      // Full set committed — location options / raw-value sets are now final
      // for this company, so selection validity may be judged (see the
      // reconcile effect). Deliberately NOT set after the first page: a
      // location present only in later pages would be wrongly reconciled away.
      setResponsesLoadedCompanyId(requestedCompanyId);

      // Set lastUpdated to the most recent response collection time
      let lastUpdatedDate: Date | undefined;
      if (allResponses.length > 0) {
        const mostRecentResponse = allResponses[0]; // Already sorted by updated_at desc
        lastUpdatedDate = new Date(mostRecentResponse.tested_at || mostRecentResponse.updated_at || mostRecentResponse.created_at);
        setLastUpdated(lastUpdatedDate);
      } else {
        setLastUpdated(undefined);
      }

      // Cache by the captured id (not currentCompany?.id, which could be a
      // different company by now if the user switched mid-fetch). Merge over
      // the existing entry so snapshots written by the other fetches (MV
      // data, metrics, themes) aren't wiped by a responses refetch.
      if (allResponses.length > 0) {
        companyDataCacheRef.current[requestedCompanyId] = {
          ...companyDataCacheRef.current[requestedCompanyId],
          responses: allResponses,
          activePrompts: userPrompts,
          lastUpdated: lastUpdatedDate,
          timestamp: Date.now()
        };
      }

      setLoading(false);
      setCompetitorLoading(false);
    } catch (error) {
      // If the user has switched away, swallow the error silently — the new
      // fetch owns the UI state now and shouldn't see error toasts from us.
      if (isStale()) return;
      console.error('Error in fetchResponses:', error);

      // Handle authentication errors specifically
      if (error?.message?.includes('Invalid login credentials') ||
          error?.message?.includes('Invalid Refresh Token') ||
          error?.message?.includes('JWT') ||
          error?.status === 401) {
        setConnectionError('Authentication expired. Please sign in again.');
        clearSession(); // Clear the invalid session

        // Clear any stored auth data and reload to reset the app state
        try {
          localStorage.removeItem('sb-ofyjvfmcgtntwamkubui-auth-token');
          sessionStorage.clear();
          // Reload the page to reset the app state
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        } catch (e) {
          console.error('Error clearing auth data:', e);
        }

        // Don't retry on auth errors
        setLoading(false);
        setCompetitorLoading(false);
        return;
      }

      // Provide more specific error messages
      if (error?.message?.includes('network') || error?.message?.includes('fetch')) {
        setConnectionError('Network error. Please check your internet connection and try again.');
      } else if (error?.message?.includes('timeout')) {
        setConnectionError('Request timed out. The server may be busy. Please try again in a moment.');
      } else if (error?.message?.includes('permission') || error?.message?.includes('policy')) {
        setConnectionError('Permission denied. Please ensure you have access to this company\'s data.');
      } else {
        setConnectionError('Unable to load data. Please refresh the page or try again later.');
      }
      setLoading(false);
      setCompetitorLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, currentCompany, isOnline, scopeKey]);

  const fetchResponseTexts = useCallback(async (ids: string[]) => {
    if (!ids.length) return {};

    const missing = ids.filter(id => !responseTexts[id]);
    if (!missing.length) return responseTexts;

    setResponseTextsLoading(true);
    try {
      const chunks: string[][] = [];
      for (let i = 0; i < missing.length; i += 100) {
        chunks.push(missing.slice(i, i + 100));
      }

      const results = await Promise.all(
        chunks.map(chunk =>
          supabase
            .from('prompt_responses')
            .select('id, response_text')
            .in('id', chunk)
        )
      );

      const newTexts: Record<string, string> = {};
      results.forEach(({ data }) => {
        data?.forEach(row => {
          newTexts[row.id] = row.response_text;
        });
      });

      setResponseTexts(prev => ({ ...prev, ...newTexts }));
      return { ...responseTexts, ...newTexts };
    } finally {
      setResponseTextsLoading(false);
    }
  }, [responseTexts]);

  // Fetch company metrics from materialized views (backend-calculated),
  // aggregated across the whole brand scope (current + same-name siblings).
  const fetchCompanyMetrics = useCallback(async () => {
    if (!user || !currentCompany?.id) return;

    const requestedCompanyId = currentCompany.id;
    const isStale = () => currentCompanyIdRef.current !== requestedCompanyId;
    const requestedScopeIds = scopeCompanyIds.length > 0 ? scopeCompanyIds : [requestedCompanyId];

    try {
      setCompanyMetricsLoading(true);

      // Fetch sentiment and relevance metrics from materialized views.
      // PER-COMPANY PAGINATED: PostgREST clamps every request to max_rows
      // (1000 in supabase/config.toml) regardless of .limit(), and ordering by
      // month desc means truncation silently drops the OLDEST months — the
      // per-month maps lose history and every prior-month delta collapses to
      // "no data". One .range() pagination per scope profile with a stable
      // ORDER BY (the MV's unique-index columns) fetches the complete set.
      const MV_PAGE = 1000;
      const MV_MAX_PAGES = 20; // safety valve, far above real per-company MV sizes
      const fetchMvAllRows = async (
        table: 'company_sentiment_scores_mv' | 'company_relevance_scores_mv'
      ): Promise<{ data: any[]; error: any }> => {
        try {
          const perCompany = await Promise.all(requestedScopeIds.map(async (companyId) => {
            let all: any[] = [];
            for (let page = 0; page < MV_MAX_PAGES; page += 1) {
              const { data, error } = await withDbSlot<{ data: any[] | null; error: any }>(() => (supabase as any)
                .from(table)
                .select('*')
                .eq('company_id', companyId)
                .order('response_month', { ascending: false })
                .order('prompt_type')
                .order('prompt_category')
                .order('prompt_theme')
                .order('industry_context')
                .order('job_function_context')
                .range(page * MV_PAGE, (page + 1) * MV_PAGE - 1));
              if (error) throw error;
              const chunk = data ?? [];
              all = all.concat(chunk);
              if (chunk.length < MV_PAGE) break;
            }
            return all;
          }));
          return { data: perCompany.flat(), error: null };
        } catch (error) {
          return { data: [], error };
        }
      };
      const [sentimentResult, relevanceResult] = await Promise.all([
        fetchMvAllRows('company_sentiment_scores_mv'),
        fetchMvAllRows('company_relevance_scores_mv'),
      ]);

      // Drop the result if the user already moved on to a different company.
      if (isStale()) return;

      // Keep the raw rows so the Overview tab can re-aggregate per job function.
      setSentimentMvRows(sentimentResult.data || []);
      setRelevanceMvRows(relevanceResult.data || []);

      // Mirrors of what the setters below receive, captured so the completed
      // fetch can be snapshotted into the per-company cache at the end.
      let sentimentMetricsSnapshot: any | null = null;
      const sentimentByMonthSnapshot: Record<string, number> = {};
      let relevanceMetricsSnapshot: any | null = null;
      const relevanceByMonthSnapshot: Record<string, number> = {};

      if (sentimentResult.error && sentimentResult.error.code !== 'PGRST116') {
        console.warn('Error fetching sentiment metrics from materialized view:', sentimentResult.error);
        // Don't throw - fallback to frontend calculation
      } else if (sentimentResult.data && sentimentResult.data.length > 0) {
        // Aggregate sentiment metrics across all prompt types/themes and months
        // Use the most recent month's data primarily, but aggregate all available months
        const aggregated = sentimentResult.data.reduce((acc, row) => {
          acc.totalThemes += row.total_themes || 0;
          acc.positiveThemes += row.positive_themes || 0;
          acc.negativeThemes += row.negative_themes || 0;
          acc.neutralThemes += row.neutral_themes || 0;
          acc.totalSentimentScore += (row.avg_sentiment_score || 0) * (row.total_themes || 0);
          acc.totalWeight += row.total_themes || 0;
          return acc;
        }, {
          totalThemes: 0,
          positiveThemes: 0,
          negativeThemes: 0,
          neutralThemes: 0,
          totalSentimentScore: 0,
          totalWeight: 0
        });

        const sentimentRatio = aggregated.totalThemes > 0
          ? aggregated.positiveThemes / aggregated.totalThemes
          : 0;

        const avgSentimentScore = aggregated.totalWeight > 0
          ? aggregated.totalSentimentScore / aggregated.totalWeight
          : 0;

        if (aggregated.totalThemes > 0) {
          sentimentMetricsSnapshot = {
            sentiment_ratio: sentimentRatio,
            avg_sentiment_score: avgSentimentScore,
            total_themes: aggregated.totalThemes,
            positive_themes: aggregated.positiveThemes,
            negative_themes: aggregated.negativeThemes,
            neutral_themes: aggregated.neutralThemes
          };
        }
        // Data with no themes stays null - fallback to frontend
        setCompanySentimentMetrics(sentimentMetricsSnapshot);

        // Build per-month sentiment map (positive_themes / total_themes per month)
        const sentByMonth: Record<string, { positive: number; total: number }> = {};
        sentimentResult.data.forEach(row => {
          if (!row.response_month) return;
          const monthKey = row.response_month.slice(0, 7); // "YYYY-MM"
          if (!sentByMonth[monthKey]) sentByMonth[monthKey] = { positive: 0, total: 0 };
          sentByMonth[monthKey].positive += row.positive_themes || 0;
          sentByMonth[monthKey].total += row.total_themes || 0;
        });
        for (const [key, val] of Object.entries(sentByMonth)) {
          sentimentByMonthSnapshot[key] = val.total > 0 ? val.positive / val.total : 0;
        }
        setCompanySentimentByMonth(sentimentByMonthSnapshot);
      } else {
        // No data in materialized view - will use frontend calculation
        setCompanySentimentMetrics(null);
        setCompanySentimentByMonth({});
      }

      if (relevanceResult.error && relevanceResult.error.code !== 'PGRST116') {
        console.warn('Error fetching relevance metrics from materialized view:', relevanceResult.error);
        // Don't throw - fallback to frontend calculation
      } else if (relevanceResult.data && relevanceResult.data.length > 0) {
        // Aggregate relevance metrics across all prompt types/themes and months
        // Use the most recent month's data primarily, but aggregate all available months
        const aggregated = relevanceResult.data.reduce((acc, row) => {
          acc.totalCitations += row.total_citations || 0;
          acc.validCitations += row.valid_citations || 0;
          acc.totalRelevanceScore += (row.relevance_score || 0) * (row.valid_citations || 0);
          acc.totalWeight += row.valid_citations || 0;
          return acc;
        }, { 
          totalCitations: 0, 
          validCitations: 0, 
          totalRelevanceScore: 0, 
          totalWeight: 0
        });

        const avgRelevanceScore = aggregated.totalWeight > 0
          ? aggregated.totalRelevanceScore / aggregated.totalWeight
          : 0;

        if (aggregated.validCitations > 0) {
          relevanceMetricsSnapshot = {
            relevance_score: avgRelevanceScore,
            total_citations: aggregated.totalCitations,
            valid_citations: aggregated.validCitations
          };
        }
        // Data with no valid citations stays null - fallback to frontend
        setCompanyRelevanceMetrics(relevanceMetricsSnapshot);

        // Build per-month relevance map (weighted avg relevance_score per month)
        const relByMonth: Record<string, { scoreSum: number; weight: number }> = {};
        relevanceResult.data.forEach(row => {
          if (!row.response_month) return;
          const monthKey = row.response_month.slice(0, 7); // "YYYY-MM"
          if (!relByMonth[monthKey]) relByMonth[monthKey] = { scoreSum: 0, weight: 0 };
          const w = row.valid_citations || 0;
          relByMonth[monthKey].scoreSum += (row.relevance_score || 0) * w;
          relByMonth[monthKey].weight += w;
        });
        for (const [key, val] of Object.entries(relByMonth)) {
          relevanceByMonthSnapshot[key] = val.weight > 0 ? val.scoreSum / val.weight : 0;
        }
        setCompanyRelevanceByMonth(relevanceByMonthSnapshot);
      } else {
        // No data in materialized view - will use frontend calculation
        setCompanyRelevanceMetrics(null);
        setCompanyRelevanceByMonth({});
      }

      // Snapshot into the per-company cache so a fresh switch-back can skip
      // this fetch. Written only when the fetch completed, so switching away
      // mid-load can't poison the cache with empty data.
      companyDataCacheRef.current[requestedCompanyId] = {
        responses: [],
        timestamp: Date.now(),
        ...companyDataCacheRef.current[requestedCompanyId],
        companyMetrics: {
          sentiment: sentimentMetricsSnapshot,
          relevance: relevanceMetricsSnapshot,
          sentimentByMonth: sentimentByMonthSnapshot,
          relevanceByMonth: relevanceByMonthSnapshot,
          sentimentMvRows: sentimentResult.data || [],
          relevanceMvRows: relevanceResult.data || [],
        },
      };

    } catch (error: any) {
      if (isStale()) return;
      console.warn('Error fetching company metrics from materialized views:', error);
      // Don't set error state - fallback to frontend calculation
      setCompanySentimentMetrics(null);
      setCompanyRelevanceMetrics(null);
      setCompanySentimentByMonth({});
      setCompanyRelevanceByMonth({});
    } finally {
      if (!isStale()) {
        setCompanyMetricsLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, currentCompany?.id, scopeKey]);

  const fetchMVData = useCallback(async () => {
    if (!user || !currentCompany?.id) return;

    const requestedCompanyId = currentCompany.id;
    const isStale = () => currentCompanyIdRef.current !== requestedCompanyId;
    const requestedScopeIds = scopeCompanyIds.length > 0 ? scopeCompanyIds : [requestedCompanyId];

    try {
      // Per-company top-N, merged and re-summed client-side. A single shared
      // .limit() slice across the scope is ordered by per-row count, so a key
      // that ranks modestly in EVERY profile can be cut from all of them yet
      // belong in the merged top-30; a per-company cap keeps each profile's
      // full head. Also preserves the (company_id, count DESC) index path.
      const fetchTopRows = async (
        table: string,
        select: string,
        orderCol: string,
        perCompanyLimit: number | null
      ): Promise<{ data: any[] | null; error: any }> => {
        const results = await Promise.all(requestedScopeIds.map(id =>
          withDbSlot<{ data: any[] | null; error: any }>(() => {
            let q: any = (supabase as any)
              .from(table)
              .select(select)
              .eq('company_id', id)
              .order(orderCol, { ascending: false });
            if (perCompanyLimit) q = q.limit(perCompanyLimit);
            return q as PromiseLike<{ data: any[] | null; error: any }>;
          })
        ));
        const err = results.find(r => r.error)?.error ?? null;
        return { data: err ? null : results.flatMap(r => r.data ?? []), error: err };
      };

      const [sourcesResult, competitorsResult, llmResult] = await Promise.all([
        fetchTopRows('company_top_sources_mv', 'domain, citation_count', 'citation_count', 200),
        fetchTopRows('company_competitors_mv', 'competitor_name, mention_count', 'mention_count', 200),
        fetchTopRows('company_llm_rankings_mv', 'ai_model, mentions', 'mentions', null),
      ]);

      if (isStale()) return;

      const topCitations = Object.entries(sumRowsBy(sourcesResult.data ?? [], 'domain', 'citation_count'))
        .map(([domain, count]) => ({ domain, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 30);
      const topCompetitors = Object.entries(sumRowsBy(competitorsResult.data ?? [], 'competitor_name', 'mention_count'))
        .map(([company, count]) => ({ company, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 30);
      const llmRankings = Object.entries(sumRowsBy(llmResult.data ?? [], 'ai_model', 'mentions'))
        .map(([model, mentions]) => ({
          model,
          displayName: getLLMDisplayName(model),
          mentions,
          logoUrl: getLLMLogo(model),
        }))
        .sort((a, b) => b.mentions - a.mentions);

      if (sourcesResult.data) setMvTopCitations(topCitations);
      if (competitorsResult.data) setMvTopCompetitors(topCompetitors);
      if (llmResult.data) setMvLlmRankings(llmRankings);

      // Snapshot into the per-company cache so a fresh switch-back can skip
      // this fetch (see companyDataCacheRef).
      companyDataCacheRef.current[requestedCompanyId] = {
        responses: [],
        timestamp: Date.now(),
        ...companyDataCacheRef.current[requestedCompanyId],
        mvData: { topCitations, topCompetitors, llmRankings },
      };
    } catch (err) {
      if (isStale()) return;
      console.warn('[fetchMVData] error — will fall back to frontend calculation:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, currentCompany?.id, scopeKey]);

  const fetchRecencyData = useCallback(async () => {
    if (!user) return;
    
    try {
      // Clear any previous errors
      setRecencyDataError(null);
      setRecencyDataLoading(true);
      
      // Get all URLs from the user's citations first
      const allCitations = responses.flatMap(r => parseCitations(r.citations)).filter(c => c.url);
      const urls = allCitations.map(c => c.url);
      
      // Remove duplicates
      const uniqueUrls = [...new Set(urls)];
      
      if (uniqueUrls.length === 0) {
        setRecencyData([]);
        return;
      }
      
      // Use domain-based matching as primary method for better coverage
      // This matches any URL from the same domain, not requiring exact URL matches
      // Extract unique domains from ALL URLs (not limited to 100)
      const domains = [...new Set(uniqueUrls.map(url => {
        try {
          const hostname = new URL(url).hostname;
          // Normalize domain (remove www. prefix for better matching)
          return hostname.replace(/^www\./, '').toLowerCase();
        } catch {
          return null;
        }
      }).filter(Boolean))];
      
      // Use domain-based matching as primary method for better coverage
      // Process domains in parallel batches for faster fetching
      const domainBatchSize = 50; // Increased batch size for fewer requests
      const domainBatches: string[][] = [];
      for (let i = 0; i < domains.length; i += domainBatchSize) {
        domainBatches.push(domains.slice(i, i + domainBatchSize));
      }
      
      // Process all batches in parallel for much faster fetching
      const batchPromises = domainBatches.map(async (domainBatch, batchIndex) => {
        try {
          const { data: domainMatches, error: domainError } = await retrySupabaseQuery(() =>
            supabase
              .from('url_recency_cache')
              .select('url, recency_score, domain')
              .or(domainBatch.map(domain => `domain.eq.${domain}`).join(','))
              .not('recency_score', 'is', null)
              .limit(500) // Increased limit per batch
          ) as { data: any[] | null; error: any };
          
          if (domainError) {
            return [];
          }
          
          if (!domainMatches || domainMatches.length === 0) {
            return [];
          }
          
          // Filter to only include URLs that match our citation domains
          const domainSet = new Set(domainBatch);
          return domainMatches.filter(match => {
            const matchDomain = (match.domain || new URL(match.url).hostname)
              .replace(/^www\./, '')
              .toLowerCase();
            return domainSet.has(matchDomain);
          });
        } catch (error) {
          return [];
        }
      });
      
      // Wait for all batches to complete in parallel
      const batchResults = await Promise.all(batchPromises);
      
      // Combine results and deduplicate by URL
      const seenUrls = new Set<string>();
      const allDomainMatches: any[] = [];
      batchResults.forEach(batchResult => {
        batchResult.forEach(match => {
          if (!seenUrls.has(match.url)) {
            seenUrls.add(match.url);
            allDomainMatches.push(match);
          }
        });
      });
      
      // Cache the results
      const responseIdsHash = responses.map(r => r.id).sort().join(',');
      recencyDataCacheRef.current = {
        responseIdsHash,
        data: allDomainMatches
      };
      
      setRecencyData(allDomainMatches);
      setRecencyDataError(null); // Clear any previous errors
    } catch (error) {
      console.error('Error in fetchRecencyData:', error);
      setRecencyData([]);
      
      // Set specific error message for recency data
      if (error.message?.includes('ERR_FAILED') || error.message?.includes('network')) {
        setRecencyDataError('Unable to fetch relevance data due to network issues. The system will retry automatically.');
      } else if (error.message?.includes('uri too long')) {
        setRecencyDataError('Processing a large number of sources. This may take a moment...');
      } else if (error.message?.includes('timeout')) {
        setRecencyDataError('Relevance data is taking longer than expected. Please wait...');
      } else {
        setRecencyDataError('Relevance data is being processed. This may take a moment.');
      }
    } finally {
      setRecencyDataLoading(false);
    }
  }, [user, responses]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAIThemes = useCallback(async () => {
    if (!user || !currentCompany?.id) {
      setAiThemes([]);
      setAiThemesLoading(false);
      return;
    }

    // Up to 200 paginated queries — easily the slowest fetch on the dashboard
    // and the one most likely to land after the user has already switched
    // companies. requestedCompanyId pins this call to the company that
    // triggered it; anything not matching the live ref at commit time is
    // discarded so it can't overwrite the new company's themes.
    const requestedCompanyId = currentCompany.id;
    const isStale = () => currentCompanyIdRef.current !== requestedCompanyId;
    const requestedScopeIds = scopeCompanyIds.length > 0 ? scopeCompanyIds : [requestedCompanyId];

    try {
      setAiThemesLoading(true);

      // Bound by 180 days. Served by idx_ai_themes_company_created
      // (company_id, created_at DESC): an index range scan, no sort.
      const AI_THEMES_DAYS = 180;
      const aiThemesCutoffIso = new Date(Date.now() - AI_THEMES_DAYS * 24 * 60 * 60 * 1000).toISOString();

      // Only the columns the Overview themes/attributes cards consume —
      // skips heavy theme_description / context_snippets[] / keywords[]
      // (cuts row width ~609B -> ~100B).
      const COLS =
        'id, response_id, theme_name, sentiment, sentiment_score, attribute_id, attribute_name, created_at';
      const PAGE_SIZE = 1000;

      // Keyset pagination on (created_at DESC, id DESC) instead of OFFSET.
      // OFFSET re-walks all skipped rows every page (O(n^2/page)); keyset
      // keeps every page O(PAGE_SIZE) by seeking past the last cursor.
      // One pagination PER scope company (merged after): keeps every page on
      // the (company_id, created_at) index instead of a cross-company merge.
      const fetchThemesForCompany = async (companyId: string): Promise<any[]> => {
        let all: any[] = [];
        let cursor: { created_at: string; id: string } | null = null;
        // Hard cap to avoid an unbounded loop if data is pathological.
        for (let guard = 0; guard < 200; guard += 1) {
          let q = supabase
            .from('ai_themes')
            .select(COLS)
            .eq('company_id', companyId)
            .gte('created_at', aiThemesCutoffIso)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(PAGE_SIZE);

          if (cursor) {
            q = q.or(
              `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`
            );
          }

          // bulk: raw themes are a background drilldown feed — on an explicit
          // refresh this family alone is ~90 queries and starved the prompts
          // fetch (and therefore the whole page skeleton) when it shared the
          // critical tier.
          const { data, error } = (await withDbSlot(() => retrySupabaseQuery(() => q) as Promise<{
            data: any[] | null;
            error: any;
          }>, { bulk: true }));

          // Abandon early if the user already moved on — no point fetching
          // the remaining pages for a company we won't display.
          if (isStale()) return all;
          if (error) throw error;

          const chunk = data ?? [];
          all = all.concat(chunk);
          if (chunk.length < PAGE_SIZE) break;

          const last = chunk[chunk.length - 1];
          cursor = { created_at: last.created_at, id: last.id };
        }
        return all;
      };

      const perCompanyThemes = await Promise.all(requestedScopeIds.map(fetchThemesForCompany));

      if (isStale()) return;
      setAiThemes(perCompanyThemes.flat());
    } catch (error) {
      if (isStale()) return;
      console.error('Error in fetchAIThemes:', error);
      setAiThemes([]);
    } finally {
      // Don't flip the loading flag off if a newer fetch is in flight — it
      // owns the spinner now.
      if (!isStale()) {
        setAiThemesLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, currentCompany?.id, scopeKey]);

  // Pre-aggregated attribute scores from company_attribute_themes_mv. A few
  // hundred rows per company (16 attributes x months x job functions) instead
  // of the tens of thousands of raw theme rows the dashboard used to pull.
  const fetchAttributeThemes = useCallback(async () => {
    if (!user || !currentCompany?.id) {
      setAttributeThemes([]);
      return;
    }
    const requestedCompanyId = currentCompany.id;
    const isStale = () => currentCompanyIdRef.current !== requestedCompanyId;
    const requestedScopeIds = scopeCompanyIds.length > 0 ? scopeCompanyIds : [requestedCompanyId];
    try {
      const PAGE_SIZE = 1000;
      // One pagination per scope company (index-friendly), merged after.
      const fetchForCompany = async (companyId: string): Promise<any[]> => {
        let all: any[] = [];
        let page = 0;
        let chunk: any[] | null;
        do {
          const from = page * PAGE_SIZE;
          const result = await withDbSlot(() => retrySupabaseQuery(() =>
            supabase
              .from('company_attribute_themes_mv')
              .select('attribute_id, response_month, job_function_context, total_themes, positive_themes, negative_themes, neutral_themes, avg_sentiment_score, response_count')
              .eq('company_id', companyId)
              // Stable order (unique-index columns): these are plain tables
              // rebuilt by DELETE+INSERT since 20260706120000 — unordered
              // OFFSET pages can duplicate/skip rows across a mid-fetch
              // rebuild, and duplicates get double-summed downstream.
              .order('response_month')
              .order('job_function_context')
              .order('attribute_id')
              .range(from, from + PAGE_SIZE - 1)
          ) as Promise<{ data: any[] | null; error: any }>);
          if (isStale()) return all;
          if (result.error) throw result.error;
          chunk = result.data ?? [];
          all = all.concat(chunk);
          page += 1;
        } while (chunk && chunk.length === PAGE_SIZE);
        return all;
      };
      const perCompany = await Promise.all(requestedScopeIds.map(fetchForCompany));
      if (isStale()) return;
      // Rows from several sibling companies repeat (attribute, month, job
      // function) — collapse them to the single-company shape consumers expect.
      setAttributeThemes(aggregateAttributeThemeRows(perCompany.flat()));
    } catch (err: any) {
      if (!isStale()) console.error('Error in fetchAttributeThemes:', err?.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, currentCompany?.id, scopeKey]);

  // Per-response sentiment ratios from company_response_sentiment_mv. Feeds the
  // sentiment cache (trend chart, trend arrows, per-prompt sentiment) without
  // shipping raw theme rows.
  const fetchResponseSentiment = useCallback(async () => {
    if (!user || !currentCompany?.id) {
      setResponseSentimentRows([]);
      return;
    }
    const requestedCompanyId = currentCompany.id;
    const isStale = () => currentCompanyIdRef.current !== requestedCompanyId;
    const requestedScopeIds = scopeCompanyIds.length > 0 ? scopeCompanyIds : [requestedCompanyId];
    try {
      const PAGE_SIZE = 1000;
      // One pagination per scope company (index-friendly), merged after.
      // response_id is globally unique, so a plain concat is safe.
      const fetchForCompany = async (companyId: string): Promise<any[]> => {
        let all: any[] = [];
        let page = 0;
        let chunk: any[] | null;
        do {
          const from = page * PAGE_SIZE;
          const result = await withDbSlot(() => retrySupabaseQuery(() =>
            supabase
              .from('company_response_sentiment_mv')
              .select('response_id, total_themes, positive_themes, sentiment_ratio')
              .eq('company_id', companyId)
              // Stable order — see the attribute-themes fetch above.
              .order('response_id')
              .range(from, from + PAGE_SIZE - 1)
          ) as Promise<{ data: any[] | null; error: any }>);
          if (isStale()) return all;
          if (result.error) throw result.error;
          chunk = result.data ?? [];
          all = all.concat(chunk);
          page += 1;
          if (chunk.length === PAGE_SIZE) {
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        } while (chunk && chunk.length === PAGE_SIZE);
        return all;
      };
      const perCompany = await Promise.all(requestedScopeIds.map(fetchForCompany));
      if (isStale()) return;
      setResponseSentimentRows(perCompany.flat());
    } catch (err: any) {
      if (!isStale()) console.error('Error in fetchResponseSentiment:', err?.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, currentCompany?.id, scopeKey]);

  // Memoized cache of sentiment calculations per response ID
  // OPTIMIZED: Only recalculates when themes change, not on every render
  // This prevents expensive calculations on every render
  const [sentimentCacheState, setSentimentCacheState] = useState<Map<string, { sentiment_score: number; sentiment_label: string }>>(new Map());
  
  // Build the per-response sentiment cache from the pre-aggregated MV
  // (company_response_sentiment_mv) instead of scanning raw ai_themes. The MV
  // already gives positive/total themes and the ratio per response; we apply
  // the same 0-1 ratio and label thresholds the frontend used before.
  useEffect(() => {
    if (responseSentimentRows.length === 0) {
      setSentimentCacheState(new Map());
      return;
    }

    // Scope to the current company's loaded responses when available. The MV is
    // already company-scoped by the fetch, so before responses load we keep all
    // rows rather than dropping them.
    const companyResponseIds = new Set(responses.map(r => r.id));
    const scopeToResponses = companyResponseIds.size > 0;

    const cache = new Map<string, { sentiment_score: number; sentiment_label: string }>();
    responseSentimentRows.forEach(row => {
      if (scopeToResponses && !companyResponseIds.has(row.response_id)) return;
      const ratio = typeof row.sentiment_ratio === 'number'
        ? row.sentiment_ratio
        : Number(row.sentiment_ratio) || 0;
      const sentimentLabel = ratio > 0.6 ? 'positive' : ratio < 0.4 ? 'negative' : 'neutral';
      cache.set(row.response_id, { sentiment_score: ratio, sentiment_label: sentimentLabel });
    });

    setSentimentCacheState(cache);
  }, [responseSentimentRows, responses]);
  
  // Use state-based cache instead of useMemo (prevents recalculation on every render)
  const sentimentCache = sentimentCacheState;

  // Helper function to calculate AI-based sentiment for a response
  // Uses the state-based cache for O(1) lookup (calculated only when themes change)
  const calculateAIBasedSentiment = useCallback((responseId: string) => {
    // Check cache first
    const cached = sentimentCacheState.get(responseId);
    if (cached) {
      return cached;
    }
    
    // No AI themes available for this response - return neutral sentiment
    return {
      sentiment_score: 0,
      sentiment_label: 'neutral'
    };
  }, [sentimentCacheState]);

  const aiThemeByResponseId = useMemo(() => {
    const map = new Map<string, any>();
    aiThemes.forEach(theme => {
      if (!map.has(theme.response_id)) {
        map.set(theme.response_id, theme);
      }
    });
    return map;
  }, [aiThemes]);

  const fetchCompanyName = useCallback(async () => {
    if (!currentCompany) {
      setCompanyName('');
      return;
    }
    
    setCompanyName(currentCompany.name);
  }, [currentCompany]);

  // Cache for search results to prevent duplicate requests
  const searchResultsCache = useRef<{
    companyId: string | null;
    timestamp: number;
    data: any[];
  }>({ companyId: null, timestamp: 0, data: [] });

  const fetchSearchResults = useCallback(async () => {
    // search_insights feature retired — no network calls.
    setSearchResults([]);
    setSearchResultsLoading(false);
    return;

    // eslint-disable-next-line no-unreachable
    if (!user || !currentCompany) {
      setSearchResults([]);
      setSearchResultsLoading(false);
      return;
    }

    // Check cache first - if we have recent data for this company, use it
    const now = Date.now();
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    if (
      searchResultsCache.current.companyId === currentCompany.id &&
      (now - searchResultsCache.current.timestamp) < CACHE_DURATION &&
      searchResultsCache.current.data.length > 0
    ) {
      setSearchResults(searchResultsCache.current.data);
      setSearchResultsLoading(false);
      return;
    }

    try {
      setSearchResultsLoading(true);

      // Get the most recent search session for this company
      const { data: sessionData, error: sessionError } = await retrySupabaseQuery(() =>
        supabase
          .from('search_insights_sessions')
          .select(`
            id,
            company_name,
            initial_search_term,
            total_results,
            total_related_terms,
            total_volume,
            keywords_everywhere_available,
            created_at
          `)
          .eq('company_id', currentCompany.id)
          .order('created_at', { ascending: false })
          .limit(1)
      ) as { data: any[] | null; error: any };

      if (sessionError) {
        console.error('Error fetching search session:', sessionError);
        setSearchResults([]);
        return;
      }

      // Get the first (and only) result if any exist
      const session = sessionData && sessionData.length > 0 ? sessionData[0] : null;

      if (!session) {
        setSearchResults([]);
        return;
      }

      // Get search results for this session
      const { data: resultsData, error: resultsError } = await retrySupabaseQuery(() =>
        supabase
          .from('search_insights_results')
          .select('*')
          .eq('session_id', session.id)
          .order('position', { ascending: true })
      ) as { data: any[] | null; error: any };

      if (resultsError) {
        console.error('Error fetching search results:', resultsError);
        setSearchResults([]);
        return;
      }

      // Process and deduplicate the data by URL
      const urlMap = new Map<string, { result: any; count: number; searchTerms: Set<string> }>();
      
      // Group results by URL and count mentions
      (resultsData || []).forEach(result => {
        const url = result.link;
        if (urlMap.has(url)) {
          const existing = urlMap.get(url)!;
          existing.count += 1;
          existing.searchTerms.add(result.search_term);
          // Keep the result with the best position (lowest number)
          if (result.position < existing.result.position) {
            existing.result = result;
          }
        } else {
          urlMap.set(url, {
            result: result,
            count: 1,
            searchTerms: new Set([result.search_term])
          });
        }
      });
      
      // Convert to array and sort by mention count (descending), then by position (ascending)
      const processedResults = Array.from(urlMap.values())
        .map(item => ({
          id: item.result.id,
          title: item.result.title,
          link: item.result.link,
          snippet: item.result.snippet,
          position: item.result.position,
          domain: item.result.domain,
          company_id: currentCompany.id, // Add company_id to each search result
          monthlySearchVolume: item.result.monthly_search_volume,
          mediaType: item.result.media_type,
          companyMentioned: item.result.company_mentioned,
          detectedCompetitors: item.result.detected_competitors || '',
          date: item.result.date_found,
          searchTerm: item.result.search_term,
          mentionCount: item.count,
          searchTermsCount: item.searchTerms.size,
          allSearchTerms: Array.from(item.searchTerms).join(', ')
        }))
        .sort((a, b) => {
          // First sort by mention count (descending)
          if (b.mentionCount !== a.mentionCount) {
            return b.mentionCount - a.mentionCount;
          }
          // Then by position (ascending)
          return a.position - b.position;
        });

      setSearchResults(processedResults);
      
      // Cache the results
      searchResultsCache.current = {
        companyId: currentCompany.id,
        timestamp: now,
        data: processedResults
      };

      // Process search terms data for ranking
      if (processedResults.length > 0) {
        const termMap = new Map<string, { volume: number; count: number }>();
        
        processedResults.forEach((result: any) => {
          const term = result.searchTerm || 'combined';
          const volume = result.monthlySearchVolume || 0;
          
          if (termMap.has(term)) {
            const existing = termMap.get(term)!;
            termMap.set(term, {
              volume: Math.max(existing.volume, volume),
              count: existing.count + 1
            });
          } else {
            termMap.set(term, { volume, count: 1 });
          }
        });
        
        const termsData = Array.from(termMap.entries())
          .map(([term, data]) => ({
            term,
            monthlyVolume: data.volume,
            resultsCount: data.count
          }))
          .sort((a, b) => b.monthlyVolume - a.monthlyVolume);
        
        setSearchTermsData(termsData);
      }
    } catch (error) {
      console.error('Error loading search results:', error);
      setSearchResults([]);
    } finally {
      setSearchResultsLoading(false);
    }
  }, [user, currentCompany?.id]);

  // Data freshness is handled on the backend (materialized views / cron jobs).
  // No automatic frontend polling — users can manually refresh via the UI button.

  // Data freshness is managed by backend materialized views and cron jobs.
  // Users can trigger manual refresh via the UI button (setShouldRefetch).
  // The previous 3-second polling loop was re-triggering full data fetches during
  // initial load, causing cascading state updates and 15+ redundant network requests.

  // Add refs to track initial loading state
  const hasInitiallyLoadedRef = useRef(false);
  // currentCompanyIdRef is declared near the top of the hook so the fetch
  // callbacks above can use it for stale-response checks.
  // Track if we've fetched for this specific company/user combination
  const fetchedCompanyUserKeyRef = useRef<string | null>(null);
  const [shouldRefetch, setShouldRefetch] = useState(false);
  const [isSwitchingCompany, setIsSwitchingCompany] = useState(false);

  // Update the ref when company changes
  useEffect(() => {
    if (currentCompany?.id !== currentCompanyIdRef.current && currentCompany?.id !== undefined) {
      const previousCompanyId = currentCompanyIdRef.current;
      // Save current company's data to cache before clearing (for instant
      // restore when switching back) — but ONLY when the outgoing company's
      // load actually completed. Switching away mid-stream would otherwise
      // cache the first page(s), and the restore path re-declares cached
      // responses FINAL (setResponsesLoadedCompanyId), which would let the
      // reconcile effect wipe a valid location that only exists in the pages
      // that never landed.
      if (previousCompanyId && responses.length > 0 && responsesLoadedCompanyId === previousCompanyId) {
        companyDataCacheRef.current[previousCompanyId] = {
          // Merge over the existing entry so the MV/metrics snapshots
          // written by the fetches survive — they're what lets a switch-back
          // skip the network entirely.
          ...companyDataCacheRef.current[previousCompanyId],
          responses,
          aiThemes, // cache lazily-loaded raw themes (Thematic tab) if present
          attributeThemes, // pre-aggregated attribute scores (MV-backed)
          responseSentimentRows, // per-response sentiment ratios (MV-backed)
          lastUpdated: lastUpdated,
          timestamp: Date.now()
        };
      }
      // Set switching flag to prevent stale data from being used
      setIsSwitchingCompany(true);
      currentCompanyIdRef.current = currentCompany?.id;

      // Clear all data immediately when switching companies
      setResponses([]);
      setResponsesLoadedCompanyId(null);
      setMvLocationBuckets([]);
      setVisibilityMvRows([]);
      setResponseTexts({});
      setAiThemes([]);
      setAttributeThemes([]);
      setResponseSentimentRows([]);
      setSearchResults([]);
      setSearchTermsData([]);
      setRecencyData([]);
      setLastUpdated(undefined);
      setMvTopCitations([]);
      setMvTopCompetitors([]);
      setMvLlmRankings([]);

      // Clear search results cache when switching companies
      searchResultsCache.current = { companyId: null, timestamp: 0, data: [] };
      // Clear recency data cache when switching companies
      recencyDataCacheRef.current = null;

      // Reset the fetched key so new data will be loaded
      fetchedCompanyUserKeyRef.current = null;
    }
  }, [currentCompany?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally omit responses/aiThemes/lastUpdated to avoid saving on every data change
  
  // Initial data fetch - only run when user or company ID actually changes, or when shouldRefetch is true
  // CRITICAL: Prevent refetch when returning to tab by tracking what we've already loaded
  useEffect(() => {
    if (user?.id && currentCompany?.id) {
      const currentKey = `${user.id}-${currentCompany.id}`;
      const companyId = currentCompany.id;

      // Only fetch if:
      // 1. This is a new company/user combination, OR
      // 2. shouldRefetch is explicitly set to true (user clicked Refresh)
      const isExplicitRefresh = shouldRefetch;
      if (fetchedCompanyUserKeyRef.current !== currentKey || isExplicitRefresh) {
        fetchedCompanyUserKeyRef.current = currentKey;
        hasInitiallyLoadedRef.current = true;
        setShouldRefetch(false); // Reset the refetch flag

        // On explicit refresh: skip cache and clear caches so we get fresh data
        if (isExplicitRefresh) {
          delete companyDataCacheRef.current[companyId];
          recencyDataCacheRef.current = null;
          previousResponseIdsRef.current = '';
        } else {
          // Restore from cache if available (instant UI when switching back to recently viewed company)
          const cached = companyDataCacheRef.current[companyId];
          const cacheFresh = !!cached && (Date.now() - cached.timestamp) < COMPANY_CACHE_TTL && cached.responses.length > 0;
          if (cacheFresh) {
            setResponses(cached.responses);
            setResponsesLoadedCompanyId(companyId); // restored full set — final
            setLastUpdated(cached.lastUpdated);
            setLoading(false);
            setCompetitorLoading(false);
            setIsSwitchingCompany(false);
          }
          // Fully-cached switch-back: restore the MV-backed data too and skip
          // the refetch entirely. Dashboard data is collection-driven
          // (monthly), so a sub-5-minute stale window is invisible — and the
          // explicit Refresh button still bypasses the cache above.
          if (cacheFresh && cached.mvData && cached.companyMetrics && cached.activePrompts) {
            setActivePrompts(cached.activePrompts);
            setMvTopCitations(cached.mvData.topCitations);
            setMvTopCompetitors(cached.mvData.topCompetitors);
            setMvLlmRankings(cached.mvData.llmRankings);
            setCompanySentimentMetrics(cached.companyMetrics.sentiment);
            setCompanyRelevanceMetrics(cached.companyMetrics.relevance);
            setCompanySentimentByMonth(cached.companyMetrics.sentimentByMonth);
            setCompanyRelevanceByMonth(cached.companyMetrics.relevanceByMonth);
            setSentimentMvRows(cached.companyMetrics.sentimentMvRows);
            setRelevanceMvRows(cached.companyMetrics.relevanceMvRows);
            setCompanyName(currentCompany.name || '');
            return;
          }
        }

        // Fetch fresh data (in background if partially restored from cache)
        setCompanyName(currentCompany.name || '');
        Promise.all([
          fetchMVData(),
          fetchCompanyMetrics(),
          fetchResponses(),
          // On explicit refresh, also refetch AI themes and clear search cache
          ...(isExplicitRefresh ? [fetchAIThemes()] : []),
        ]);
        if (isExplicitRefresh) {
          searchResultsCache.current = { companyId: null, timestamp: 0, data: [] };
        }
      }
    } else {
      // Reset when user/company becomes null
      fetchedCompanyUserKeyRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, currentCompany?.id, shouldRefetch]);

  // Clear switching flag when the new company's data has loaded — including a
  // load that completed EMPTY. (It used to clear only on responses.length > 0,
  // which left the flag stuck true for zero-response companies and kept
  // topCitations/topCompetitors permanently empty even when MV data existed.)
  useEffect(() => {
    if (
      isSwitchingCompany &&
      (responses.length > 0 || responsesLoadedCompanyId === currentCompany?.id)
    ) {
      setIsSwitchingCompany(false);
    }
  }, [isSwitchingCompany, responses.length, responsesLoadedCompanyId, currentCompany?.id]);

  // Reset pagination when company changes
  useEffect(() => {
    setLoadAllResponses(false);
    setHasMoreResponses(false);
  }, [currentCompany?.id]);

  // Clear company metrics when company becomes null
  useEffect(() => {
    if (!currentCompany?.id || !user?.id) {
      setCompanySentimentMetrics(null);
      setCompanyRelevanceMetrics(null);
    }
  }, [currentCompany?.id, user?.id]);

  // Fetch recency data when responses change (with caching to avoid unnecessary refetches)
  useEffect(() => {
    if (responses.length === 0) {
      setRecencyData([]);
      recencyDataCacheRef.current = null;
      previousResponseIdsRef.current = '';
      return;
    }
    
    // Create a hash of response IDs to detect if responses actually changed
    const responseIdsHash = responses.map(r => r.id).sort().join(',');
    
    // Only fetch if responses actually changed (not just on every render)
    if (previousResponseIdsRef.current !== responseIdsHash) {
      previousResponseIdsRef.current = responseIdsHash;
      
      // Recency data is now provided by the company_relevance_scores materialized view
      // (fetched via fetchCompanyMetrics). The old fetchRecencyData fired 15+ parallel
      // requests to url_recency_cache on every load — disabled to eliminate main-thread
      // contention and reduce INP.
      if (recencyDataCacheRef.current && recencyDataCacheRef.current.responseIdsHash === responseIdsHash) {
        setRecencyData(recencyDataCacheRef.current.data);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [responses.length]); // Only depend on responses length - fetch immediately

  // On company change, load the pre-aggregated theme MVs (attribute scores +
  // per-response sentiment) instead of the old eager raw-themes pull. These are
  // small/fast and serve everything the Overview renders. Raw ai_themes are now
  // fetched lazily — only when the Thematic tab mounts (see fetchAIThemes,
  // wired through ThematicAnalysisTab).
  useEffect(() => {
    if (user && currentCompany?.id) {
      // Restore from the per-company cache on quick switch-back.
      const cached = companyDataCacheRef.current[currentCompany.id];
      if (
        cached &&
        (Date.now() - cached.timestamp) < COMPANY_CACHE_TTL &&
        cached.attributeThemes &&
        cached.responseSentimentRows
      ) {
        setAttributeThemes(cached.attributeThemes);
        setResponseSentimentRows(cached.responseSentimentRows);
        return;
      }
      fetchAttributeThemes();
      fetchResponseSentiment();
    } else {
      setAttributeThemes([]);
      setResponseSentimentRows([]);
      setAiThemes([]);
      setAiThemesLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, currentCompany?.id]);

  // Fetch the company's distinct location_context buckets from a by-location
  // MV (all-time), so location entries built from the 180-day response window
  // can be widened with historical spellings — without this, MV queries with
  // `.in('location_context', ...)` silently skip months whose spelling of a
  // location no longer occurs in recent data. The LLM-rankings MV is the
  // smallest per-location view (≈ locations × models rows). Failure is benign:
  // no widening, behavior identical to before.
  useEffect(() => {
    const companyId = currentCompany?.id;
    if (!user?.id || !companyId) {
      setMvLocationBuckets([]);
      return;
    }
    const requestedScopeIds = scopeCompanyIds.length > 0 ? scopeCompanyIds : [companyId];
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await withDbSlot(() => supabase
          .from('company_llm_rankings_by_location_mv')
          .select('location_context')
          .in('company_id', requestedScopeIds));
        if (cancelled || error) return;
        const distinct = Array.from(
          new Set((data ?? []).map(r => (r.location_context ?? '') as string))
        );
        setMvLocationBuckets(distinct);
      } catch {
        /* extend-only: missing buckets just mean no widening */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, currentCompany?.id, scopeKey]);

  // Load the visibility rollup for the whole brand scope. Deliberately its own
  // effect (not part of the kick effect's Promise.all) so it also runs on the
  // fully-cached switch-back path, and per-company + paginated + stably
  // ordered like every other fetch (PostgREST clamps responses to max_rows).
  useEffect(() => {
    const companyId = currentCompany?.id;
    if (!user?.id || !companyId) {
      setVisibilityMvRows([]);
      setVisibilityMvLoading(false);
      return;
    }
    const ids = scopeCompanyIds.length > 0 ? scopeCompanyIds : [companyId];
    let cancelled = false;
    setVisibilityMvLoading(true);
    (async () => {
      try {
        const PAGE = 1000;
        const perCompany = await Promise.all(ids.map(async (id) => {
          let all: any[] = [];
          for (let page = 0; page < 10; page += 1) {
            const { data, error } = await withDbSlot<{ data: any[] | null; error: any }>(() => (supabase as any)
              .from('company_visibility_by_location_mv')
              .select('company_id, location_context, response_month, job_function_context, total_responses, mentioned_responses')
              .eq('company_id', id)
              .order('response_month', { ascending: false })
              .order('location_context')
              .order('job_function_context')
              .range(page * PAGE, (page + 1) * PAGE - 1));
            if (error) throw error;
            const chunk = data ?? [];
            all = all.concat(chunk);
            if (chunk.length < PAGE) break;
          }
          return all;
        }));
        if (!cancelled) setVisibilityMvRows(perCompany.flat());
      } catch {
        // MV missing / not yet refreshed — raw-response fallback takes over.
        if (!cancelled) setVisibilityMvRows([]);
      } finally {
        if (!cancelled) setVisibilityMvLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, currentCompany?.id, scopeKey]);

  // Track when metrics are ready
  // Backend metrics (from materialized views) are available immediately
  // Frontend metrics calculation can happen in background - don't block UI
  useEffect(() => {
    if (loading) {
      setMetricsLoading(true);
    } else {
      // Metrics are ready as soon as responses load
      // Backend metrics are already available from materialized views
      // Frontend calculation (themes/recency) can update in background
      setMetricsLoading(false);
    }
  }, [loading]);

  // Comprehensive loading state that includes all critical data
  // Don't wait for recency/themes - backend metrics are available immediately
  // Let recency/themes load in background and update when ready
  const isFullyLoaded = useMemo(() => {
    // Dashboard is ready as soon as responses load
    // Backend metrics (from materialized views) are available immediately
    // Recency/themes can load in background without blocking UI
    return !loading && !metricsLoading && !competitorLoading;
  }, [loading, metricsLoading, competitorLoading]);

  // Fetch search results when company is available
  useEffect(() => {
    if (user && currentCompany) {
      fetchSearchResults();
    }
  }, [user?.id, currentCompany?.id]); // Only depend on IDs, not the function

  const refreshData = useCallback(async () => {
    searchResultsCache.current = { companyId: null, timestamp: 0, data: [] };
    setShouldRefetch(true);
  }, []);

  // Function to load all historical responses (for complete trend analysis)
  const loadAllHistoricalResponses = useCallback(async () => {
    setLoadAllResponses(true);
    // Trigger refetch - fetchResponses will check loadAllResponses flag
    setShouldRefetch(true);
  }, []);

  const parseCitations = useCallback((citations: any): Citation[] => {
    if (!citations) return [];
    if (Array.isArray(citations)) return citations;
    if (typeof citations === 'string') {
      try {
        const parsed = JSON.parse(citations);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }, []);

  const parsedCitationsMap = useMemo(() => {
    const map = new Map<string, Citation[]>();
    responses.forEach(r => {
      map.set(r.id, parseCitations(r.citations));
    });
    return map;
  }, [responses, parseCitations]);

  const getCitations = useCallback((responseId: string): Citation[] => {
    return parsedCitationsMap.get(responseId) || [];
  }, [parsedCitationsMap]);

  // Reset selectedPeriod when company changes
  useEffect(() => {
    setSelectedPeriod(null);
  }, [currentCompany?.id]);

  // When the user picks a location that lives in a SIBLING company row (a
  // country-variant brand like Netflix), the dropdown switches company and wants
  // that location selected afterwards. Stashing it here and applying it in the
  // company-change effect below sets it ATOMICALLY with the switch — a
  // post-switch setState would instead race the reconcile effect (which would
  // see the value as invalid for the old company and wipe it).
  const pendingLocationRef = useRef<string | null>(null);
  const setPendingLocation = useCallback((key: string | null) => {
    pendingLocationRef.current = key;
  }, []);

  // On company change (and first availability), pick the location to land on:
  //  1. the pending location stashed just before a sibling-row switch, else
  //  2. the user's starred view — only when it targets THIS company (legacy
  //     views without a companyId still apply anywhere), else
  //  3. null ("All locations"), so one company's location never leaks onto
  //     the next.
  // Applying here (not in Dashboard.tsx, as the starred restore used to be)
  // keeps every selection mutation on the same code path: the loading flag is
  // raised on the same tick, so the swap renders a skeleton instead of
  // flashing company-wide numbers — and a starred view can never clobber an
  // explicit sibling-row pick, since pending wins.
  useEffect(() => {
    const pending = pendingLocationRef.current;
    pendingLocationRef.current = null;
    let next = pending;
    // Starred views (and the loading flag) only make sense with a company to
    // scope against — with none (fresh account, mid-auth), just clear. The
    // effect re-runs when the company arrives.
    if (next == null && currentCompany?.id) {
      const starred = readStarredView(user?.id);
      if (starred && starredViewAppliesTo(starred, currentCompany.id)) {
        // Normalize the stored location so legacy ISO codes ("US") and
        // canonical keys ("united states", "burbank") both resolve.
        next = canonicalizeLocationContext(starred.location);
        if (starred.period) setSelectedPeriod(starred.period);
        // Legacy entry (no companyId): bind it to the company it just applied
        // on, so it stops leaking onto every other company from now on.
        if (starred.companyId == null) {
          stampStarredViewCompany(user?.id, currentCompany.id);
        }
      }
    }
    if (next && currentCompany?.id) setLocationMetricsLoading(true);
    setSelectedLocationState(next ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?.id, user?.id]);

  // Canonical country key of each scope company, for the attribution rule.
  const countryKeyByCompanyId = useMemo(() => {
    const m = new Map<string, string | null>();
    scopeCompanies.forEach(c => m.set(c.id, companyCountryKey(c.country)));
    return m;
  }, [scopeCompanies]);

  // Merged dropdown options across the brand scope: one filter entry per
  // canonical location (from location_context values AND each profile's own
  // country), plus "General". MV buckets widen the raw-value sets with
  // historical spellings (extend-only).
  const { options: locationOptions, rawValuesByKey: locationRawValues } = useMemo(
    () => buildLocationOptions(responses, scopeCompanies, mvLocationBuckets),
    [responses, scopeCompanies, mvLocationBuckets]
  );

  // The active selection's entry (null when the key doesn't resolve in this
  // scope — stale/mid-switch selections).
  const selectedLocationEntry = useMemo(
    () => (selectedLocation ? locationOptions.find(o => o.canonicalKey === selectedLocation) ?? null : null),
    [selectedLocation, locationOptions]
  );

  // Predicate over responses for the active selection, using THE attribution
  // rule (resolveResponseLocationKey): a response belongs to its prompt's
  // location_context if tagged, else to its company's country, else General.
  // Canonical matching covers every stored spelling and the legacy sibling
  // profiles in one rule.
  const matchesLocation = useMemo(() => {
    if (!selectedLocation) return () => true;
    if (!selectedLocationEntry) return () => true; // selection not in this scope — don't strand the UI
    const resolve = (r: PromptResponse) =>
      resolveResponseLocationKey(
        r.confirmed_prompts?.location_context,
        r.company_id != null ? (countryKeyByCompanyId.get(r.company_id) ?? null) : null
      );
    if (selectedLocation === GENERAL_KEY) {
      return (r: PromptResponse) => resolve(r) === null;
    }
    return (r: PromptResponse) => resolve(r) === selectedLocation;
  }, [selectedLocation, selectedLocationEntry, countryKeyByCompanyId]);

  // Visibility rollup rows scoped to the active location selection, via the
  // SAME attribution rule as matchesLocation (bucket location_context, else
  // the row's profile country, else General). An unresolved selection falls
  // back to scope-wide, mirroring the response predicate.
  const visibilityRowsForSelection = useMemo(() => {
    if (visibilityMvRows.length === 0) return visibilityMvRows;
    if (!selectedLocation || !selectedLocationEntry) return visibilityMvRows;
    return visibilityMvRows.filter(row => {
      const key = resolveResponseLocationKey(
        row.location_context,
        row.company_id != null ? (countryKeyByCompanyId.get(row.company_id) ?? null) : null
      );
      return selectedLocation === GENERAL_KEY ? key === null : key === selectedLocation;
    });
  }, [visibilityMvRows, selectedLocation, selectedLocationEntry, countryKeyByCompanyId]);

  // Responses surfaced across the app: deprecated prompt sets hidden and the
  // active location filter applied. Everything downstream (periods, metrics,
  // tabs, citations, competitors) flows through here.
  const visibleResponses = useMemo(
    () => responses.filter(r => !isOverallCandidateExperience(r) && matchesLocation(r)),
    [responses, matchesLocation]
  );

  // --- Period detection: group responses by their snapshot month
  // (response_month), so a run tagged for a given collection cycle shows under
  // that month regardless of when it was physically written. Built from the
  // LOCATION-FILTERED responses: with a location active, the period dropdown
  // used to offer months with zero in-location data, whose selection produced
  // a mixed-scope scorecard (0% visibility next to aggregate sentiment). ---
  const availablePeriods: PeriodInfo[] = useMemo(() => {
    const monthSet = new Set<string>();
    visibleResponses.forEach(r => {
      const key = responseMonthKey(r);
      if (key) monthSet.add(key);
    });
    // Raw responses stream in AFTER first paint now, so until this company's
    // stream has fully landed, widen the month set from the visibility
    // rollup (already scoped to the active location by the same attribution
    // rule), clamped to the eager response window so the interim list covers
    // the same months the raw set will. Once the load is FINAL the fallback
    // stops contributing and periods derive from responses alone — exactly
    // the pre-streaming behavior (never offering a month whose in-location
    // raw data doesn't exist, which produced mixed-scope scorecards).
    if (responsesLoadedCompanyId !== currentCompany?.id) {
      const cutoff = new Date(Date.now() - EAGER_DAYS * 24 * 60 * 60 * 1000);
      const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`;
      visibilityRowsForSelection.forEach(row => {
        if (!row.response_month) return;
        const key = String(row.response_month).slice(0, 7);
        if (key >= cutoffKey) monthSet.add(key);
      });
    }
    if (monthSet.size === 0) return [];
    const periods: PeriodInfo[] = Array.from(monthSet)
      .map((key) => {
        const [y, m] = key.split('-').map(Number);
        const startDate = new Date(y, m - 1, 1);
        const endDate = new Date(y, m, 0, 23, 59, 59, 999);
        const label = startDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        return { key, label, startDate, endDate };
      })
      .sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
    return periods;
  }, [visibleResponses, visibilityRowsForSelection, responsesLoadedCompanyId, currentCompany?.id]);

  // Re-scope sentiment & relevance (and sources/competitors/LLMs/attributes)
  // to the selected location using the pre-aggregated `_by_location_mv` views.
  // Two disjoint query shapes mirror the response attribution rule:
  //  - OWNED companies — profiles whose own `country` attributes to the
  //    selection (for "General": the countryless profiles): fetch ALL their
  //    buckets, then drop rows tagged with a DIFFERENT location; their
  //    untagged ('' / GLOBAL sentinel) rows belong to the selection.
  //  - OTHER scope companies: fetch only buckets tagged with one of the
  //    selection's raw spellings (server-side .in filter).
  // Leaves the company-wide MV state and its per-company cache untouched; the
  // `effective*` selectors below pick the location-scoped values whenever a
  // location is active.
  const selectedRawValues = selectedLocation ? (locationRawValues[selectedLocation] || []) : [];
  const selectedRawKey = selectedRawValues.join('|');
  const selectedOwnedCompanyIds = useMemo(() => {
    if (!selectedLocation) return [] as string[];
    if (selectedLocation === GENERAL_KEY) {
      return scopeCompanies.filter(c => companyCountryKey(c.country) === null).map(c => c.id);
    }
    return selectedLocationEntry?.companyIds ?? [];
  }, [selectedLocation, selectedLocationEntry, scopeCompanies]);
  const selectedOwnedKey = selectedOwnedCompanyIds.join('|');
  // Whether the active selection has anything to fetch: tagged spellings,
  // owned profiles, or (for General) countryless profiles. Hoisted out of the
  // fetch effect so the flag-release effect below can share it without adding
  // fetch-refiring dependencies.
  const locSelectionFetchable = useMemo(() => {
    if (!selectedLocation) return false;
    if (selectedLocation === GENERAL_KEY) return selectedOwnedCompanyIds.length > 0;
    return selectedRawValues.length > 0 || selectedOwnedCompanyIds.length > 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLocation, selectedRawKey, selectedOwnedKey]);

  // Release the loading flag for a selection that stays unresolvable after
  // this company's responses finished loading (the reconcile effect will also
  // clear the selection itself). Deliberately separate from the fetch effect:
  // having responsesLoadedCompanyId in ITS deps made the full-set commit
  // re-fire all location queries and flash content → skeleton → content.
  useEffect(() => {
    if (
      selectedLocation &&
      !locSelectionFetchable &&
      responsesLoadedCompanyId === currentCompany?.id
    ) {
      setLocationMetricsLoading(false);
    }
  }, [selectedLocation, locSelectionFetchable, responsesLoadedCompanyId, currentCompany?.id]);

  useEffect(() => {
    const companyId = currentCompany?.id;
    const isGeneral = selectedLocation === GENERAL_KEY;
    if (!user || !companyId || !selectedLocation || !locSelectionFetchable) {
      // Only drop the loading flag when the selection is actually cleared. A
      // pending/starred location applied mid-switch has no entry yet — keeping
      // the flag up holds the skeleton instead of flashing company-wide
      // numbers until the fetch below takes over; the release effect above
      // handles selections that stay unresolvable after the load completes.
      if (!selectedLocation) {
        setLocationMetricsLoading(false);
      }
      setLocSentimentMetrics(null);
      setLocRelevanceMetrics(null);
      setLocSentimentByMonth({});
      setLocRelevanceByMonth({});
      setLocSentimentMvRows([]);
      setLocRelevanceMvRows([]);
      setLocMvTopCitations([]);
      setLocMvTopCompetitors([]);
      setLocMvLlmRankings([]);
      setLocAttributeThemes([]);
      return;
    }

    const ownedIds = selectedOwnedCompanyIds;
    const ownedSet = new Set(ownedIds);
    const otherIds = scopeCompanyIds.filter(id => !ownedSet.has(id));
    // Bucket-level mirror of resolveResponseLocationKey for owned companies:
    // an untagged bucket belongs to the selection; one tagged with another
    // location does not.
    const ownedBucketMatches = (bucket: string | null | undefined) => {
      const key = canonicalizeLocationContext(bucket);
      return isGeneral ? key === null : (key === null || key === selectedLocation);
    };
    // Server-side bucket narrowing for owned profiles: the buckets that can
    // possibly match are the untagged ones ('' + GLOBAL-like sentinels) plus
    // the selection's spellings — fetching every bucket of a heavy profile
    // pulled thousands of rows that PostgREST's max_rows clamp then truncated
    // arbitrarily. ownedBucketMatches stays as the semantic filter on top.
    const ownedBucketList = isGeneral
      ? ['', ...GLOBAL_LIKE]
      : Array.from(new Set(['', ...GLOBAL_LIKE, ...selectedRawValues]));

    let cancelled = false;
    setLocationMetricsLoading(true);
    (async () => {
      try {
        // PER-COMPANY, PAGINATED, STABLY ORDERED. PostgREST clamps every
        // request to max_rows (1000) regardless of .limit(); a single capped
        // fetch silently dropped the oldest months (month-ordered arms) or an
        // arbitrary row subset (unordered arms), skewing sums with no error.
        const PAGE = 1000;
        const MAX_PAGES = 20; // safety valve per (table, company)
        type OrderSpec = { col: string; asc?: boolean };
        const fetchScoped = async (
          table: string,
          select: string,
          orders: OrderSpec[]
        ): Promise<any[]> => {
          const jobs: { owned: boolean; companyId: string; buckets: string[] }[] = [];
          if (!isGeneral && selectedRawValues.length > 0) {
            otherIds.forEach(id => jobs.push({ owned: false, companyId: id, buckets: selectedRawValues }));
          }
          ownedIds.forEach(id => jobs.push({ owned: true, companyId: id, buckets: ownedBucketList }));

          const perJob = await Promise.all(jobs.map(async (job) => {
            let all: any[] = [];
            for (let page = 0; page < MAX_PAGES; page += 1) {
              const { data, error } = await withDbSlot<{ data: any[] | null; error: any }>(() => {
                let q: any = (supabase as any).from(table).select(select)
                  .eq('company_id', job.companyId)
                  .in('location_context', job.buckets);
                for (const o of orders) q = q.order(o.col, { ascending: o.asc ?? true });
                return q.range(page * PAGE, (page + 1) * PAGE - 1);
              });
              if (error) throw error;
              const chunk = data ?? [];
              all = all.concat(chunk);
              if (chunk.length < PAGE) break;
            }
            return job.owned ? all.filter((row: any) => ownedBucketMatches(row.location_context)) : all;
          }));
          return perJob.flat();
        };

        const MONTH_ORDERS: OrderSpec[] = [
          { col: 'response_month', asc: false },
          { col: 'prompt_type' }, { col: 'prompt_category' }, { col: 'prompt_theme' },
          { col: 'industry_context' }, { col: 'job_function_context' }, { col: 'location_context' },
        ];
        const [sentimentRows, relevanceRows, sourcesRows, competitorsRows, llmRows, attributeThemeRows] = await Promise.all([
          fetchScoped('company_sentiment_scores_by_location_mv', '*', MONTH_ORDERS),
          fetchScoped('company_relevance_scores_by_location_mv', '*', MONTH_ORDERS),
          fetchScoped('company_top_sources_by_location_mv', 'domain, citation_count, location_context',
            [{ col: 'citation_count', asc: false }, { col: 'domain' }, { col: 'location_context' }]),
          fetchScoped('company_competitors_by_location_mv', 'competitor_name, mention_count, location_context',
            [{ col: 'mention_count', asc: false }, { col: 'competitor_name' }, { col: 'location_context' }]),
          fetchScoped('company_llm_rankings_by_location_mv', 'ai_model, mentions, location_context',
            [{ col: 'mentions', asc: false }, { col: 'ai_model' }, { col: 'location_context' }]),
          fetchScoped('company_attribute_themes_by_location_mv', 'attribute_id, response_month, job_function_context, total_themes, positive_themes, negative_themes, neutral_themes, avg_sentiment_score, response_count, location_context',
            [{ col: 'response_month', asc: false }, { col: 'job_function_context' }, { col: 'attribute_id' }, { col: 'location_context' }]),
        ]);
        if (cancelled) return;

        const sentiment = aggregateSentimentRows(sentimentRows);
        const relevance = aggregateRelevanceRows(relevanceRows);

        setLocSentimentMvRows(sentimentRows);
        setLocRelevanceMvRows(relevanceRows);
        setLocSentimentMetrics(sentiment.metrics);
        setLocSentimentByMonth(sentiment.byMonth);
        setLocRelevanceMetrics(relevance.metrics);
        setLocRelevanceByMonth(relevance.byMonth);

        // A location can span several raw spellings and several companies, so
        // sum each domain/competitor/model across all returned buckets, then
        // sort — mirroring the company-wide shaping.
        setLocMvTopCitations(
          Object.entries(sumRowsBy(sourcesRows, 'domain', 'citation_count'))
            .map(([domain, count]) => ({ domain, count }))
            .sort((a, b) => b.count - a.count).slice(0, 30)
        );
        setLocMvTopCompetitors(
          Object.entries(sumRowsBy(competitorsRows, 'competitor_name', 'mention_count'))
            .map(([company, count]) => ({ company, count }))
            .sort((a, b) => b.count - a.count).slice(0, 30)
        );
        setLocMvLlmRankings(
          Object.entries(sumRowsBy(llmRows, 'ai_model', 'mentions'))
            .map(([model, mentions]) => ({
              model,
              displayName: getLLMDisplayName(model),
              mentions,
              logoUrl: getLLMLogo(model),
            })).sort((a, b) => b.mentions - a.mentions)
        );

        setLocAttributeThemes(aggregateAttributeThemeRows(attributeThemeRows));
      } catch (error) {
        if (!cancelled) console.warn('Error fetching location-scoped metrics:', error);
      } finally {
        if (!cancelled) setLocationMetricsLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // selectedRawKey/selectedOwnedKey capture the selection's spellings and
    // owned profiles; scopeKey the sibling group. responsesLoadedCompanyId is
    // deliberately NOT a dep — the full-set commit must not re-fire an
    // identical fetch (the flag-release effect above covers that transition).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, currentCompany?.id, selectedLocation, locSelectionFetchable, selectedRawKey, selectedOwnedKey, scopeKey]);

  // Effective MV state: location-scoped when a location is active, else the
  // company-wide values. Used by every metrics memo below so the headline,
  // trends and per-job-function breakdowns all honor the location filter.
  //
  // A location is only "active" if it resolves to an entry in this scope —
  // ≥1 stored spelling or ≥1 owned profile. A selectedLocation that doesn't
  // (e.g. a stale value left over after switching companies) must fall back to
  // the scope-wide ("All locations") view rather than the empty
  // location-scoped state — otherwise sentiment/relevance show 0% while
  // visibility still renders.
  const locActive =
    selectedLocation != null &&
    selectedLocationEntry != null &&
    (selectedLocationEntry.rawValues.length > 0 || selectedLocationEntry.companyIds.length > 0);
  const effSentimentMetrics = locActive ? locSentimentMetrics : companySentimentMetrics;
  const effRelevanceMetrics = locActive ? locRelevanceMetrics : companyRelevanceMetrics;
  const effSentimentByMonth = locActive ? locSentimentByMonth : companySentimentByMonth;
  const effRelevanceByMonth = locActive ? locRelevanceByMonth : companyRelevanceByMonth;
  const effSentimentMvRows = locActive ? locSentimentMvRows : sentimentMvRows;
  const effRelevanceMvRows = locActive ? locRelevanceMvRows : relevanceMvRows;
  const effMvTopCitations = locActive ? locMvTopCitations : mvTopCitations;
  const effMvTopCompetitors = locActive ? locMvTopCompetitors : mvTopCompetitors;
  const effMvLlmRankings = locActive ? locMvLlmRankings : mvLlmRankings;
  const effAttributeThemes = locActive ? locAttributeThemes : attributeThemes;

  // Reconcile a selection that isn't valid for the current company back to null
  // ("All locations"), so the internal state matches what the trigger shows and
  // a stale value isn't persisted by the saved-view star. Judged only once THIS
  // company's responses have fully loaded (responsesLoadedCompanyId): a starred
  // or pending location applied during mount/switch isn't wiped while
  // responses/options still reflect the old company — and a company that loads
  // ZERO responses still clears a stale selection (the old responses.length
  // guard kept it forever).
  useEffect(() => {
    if (!selectedLocation) return;
    if (responsesLoadedCompanyId === null || responsesLoadedCompanyId !== currentCompany?.id) return;
    if (!locationOptions.some(o => o.canonicalKey === selectedLocation)) {
      setSelectedLocationState(null);
    }
  }, [selectedLocation, responsesLoadedCompanyId, currentCompany?.id, locationOptions]);

  // Determine effective period (latest if none selected)
  const effectivePeriod = useMemo(() => {
    if (availablePeriods.length === 0) return null;
    if (selectedPeriod) {
      return availablePeriods.find(p => p.key === selectedPeriod) || availablePeriods[0];
    }
    return availablePeriods[0];
  }, [availablePeriods, selectedPeriod]);

  // Previous period (month before the effective one)
  const previousPeriodInfo = useMemo(() => {
    if (!effectivePeriod || availablePeriods.length < 2) return null;
    const idx = availablePeriods.findIndex(p => p.key === effectivePeriod.key);
    return idx >= 0 && idx + 1 < availablePeriods.length ? availablePeriods[idx + 1] : null;
  }, [availablePeriods, effectivePeriod]);

  // Filter responses to the selected period (by snapshot month).
  const periodFilteredResponses = useMemo(() => {
    if (!effectivePeriod || availablePeriods.length <= 1) return visibleResponses;
    return visibleResponses.filter(r => responseMonthKey(r) === effectivePeriod.key);
  }, [visibleResponses, effectivePeriod, availablePeriods]);

  // Per-response AI themes are tied to responses via response_id. When a
  // location is active, intersect them with the in-location responses so the
  // Themes tab (and Overview theme cards) only show themes from that location.
  // (The tabs only narrow themes by response membership when a job function is
  // picked, so without this an "All functions" view would leak every location's
  // themes.) Scoped by location only — not period — to preserve all-time themes.
  const effAiThemes = useMemo(() => {
    if (!locActive) return aiThemes;
    const ids = new Set(visibleResponses.map(r => r.id));
    return aiThemes.filter(t => ids.has(t.response_id));
  }, [locActive, aiThemes, visibleResponses]);

  // Previous period responses for per-tab delta computation (by snapshot month).
  const previousPeriodResponses = useMemo(() => {
    if (!previousPeriodInfo) return [];
    return visibleResponses.filter(r => responseMonthKey(r) === previousPeriodInfo.key);
  }, [visibleResponses, previousPeriodInfo]);

  // Previous-period metrics for delta display.
  //
  // Each metric independently finds the MOST RECENT PRIOR MONTH that actually
  // has data from its own source. A company with data in Feb + April but no
  // March should compare April to Feb for sentiment — skipping the gap —
  // rather than compare against a fake 0.
  //
  // Sources (each independent):
  //   - sentiment: companySentimentByMonth (MV-backed)
  //   - relevance: companyRelevanceByMonth (MV-backed)
  //   - visibility: response counts in availablePeriods (response-backed)
  //
  // If no prior month with data exists for a given metric, that field is
  // left UNDEFINED and the render layer skips the delta arrow — preventing
  // the "delta always equals current" bug where a missing value was
  // silently coerced to 0.
  const previousPeriodMetrics = useMemo((): {
    sentimentScore?: number;
    visibilityScore?: number;
    relevanceScore?: number;
  } | null => {
    if (!effectivePeriod) return null;
    const currentKey = effectivePeriod.key;

    // Helper: given a map keyed on "YYYY-MM", find the most recent key
    // lexically less than currentKey that has a numeric value.
    const findMostRecentPrior = (map: Record<string, number>): number | undefined => {
      const priorKeys = Object.keys(map)
        .filter((k) => k < currentKey && typeof map[k] === 'number')
        .sort(); // lex sort works for YYYY-MM
      if (priorKeys.length === 0) return undefined;
      return map[priorKeys[priorKeys.length - 1]];
    };

    // Sentiment — most recent prior month in the sentiment MV.
    const prevSentimentRatio = findMostRecentPrior(effSentimentByMonth);
    const sentimentScore = typeof prevSentimentRatio === 'number'
      ? Math.round(Math.max(0, Math.min(100, prevSentimentRatio * 100)))
      : undefined;

    // Relevance — most recent prior month in the relevance MV.
    const prevRelevance = findMostRecentPrior(effRelevanceByMonth);
    const relevanceScore = typeof prevRelevance === 'number'
      ? Math.round(prevRelevance)
      : undefined;

    // Visibility — iterate availablePeriods (sorted desc by startDate) for
    // the first entry with responses, newer than none but older than current.
    let visibilityScore: number | undefined;
    const priorAvailable = availablePeriods.filter((p) => p.key < currentKey);
    if (priorAvailable.length > 0) {
      // availablePeriods is already sorted newest-first. Prefer the exact
      // precomputed rollup for the prior month; fall back to counting loaded
      // responses bucketed by snapshot month (responseMonthKey).
      const chosen = priorAvailable[0];
      const mvPrior = visibilityFromMvRows(visibilityRowsForSelection, chosen.key, null);
      if (mvPrior) {
        visibilityScore = Math.round(mvPrior.pct);
      } else {
        const chosenResponses = visibleResponses.filter((r) => responseMonthKey(r) === chosen.key);
        if (chosenResponses.length > 0) {
          const mentionedCount = chosenResponses.filter((r) => r.company_mentioned === true).length;
          visibilityScore = Math.round((mentionedCount / chosenResponses.length) * 100);
        }
      }
    }

    // Return null only if nothing could be computed. Otherwise return a
    // partial object — consumer checks each field individually.
    if (sentimentScore === undefined && visibilityScore === undefined && relevanceScore === undefined) {
      return null;
    }
    return { sentimentScore, visibilityScore, relevanceScore };
  }, [effectivePeriod, availablePeriods, visibleResponses, effSentimentByMonth, effRelevanceByMonth, visibilityRowsForSelection]);

  const promptsData: PromptData[] = useMemo(() => {
    // Group responses by prompt text using a Map for O(1) lookup. The prior
    // implementation used `acc.find()` inside reduce, which is O(N × M) for
    // N responses and M unique prompts — painful at dashboard scale
    // (thousands of responses × hundreds of prompts).
    const byPrompt = new Map<string, PromptData>();
    for (const response of periodFilteredResponses) {
      const promptKey = response.confirmed_prompts?.prompt_text;
      const isAttributeResponse = !!(response.confirmed_prompts as any)?.attribute_id;

      const existing = promptKey ? byPrompt.get(promptKey) : undefined;
      
      // Get AI-based sentiment for this response
      const aiSentiment = calculateAIBasedSentiment(response.id);
      
      // Extract visibility from company_mentioned boolean
      const visibilityScore = typeof response.company_mentioned === 'boolean' ? (response.company_mentioned ? 100 : 0) : undefined;
      
      if (existing) {
        existing.responses += 1;
        // Use AI-based sentiment in average calculation
        existing.avgSentiment = (existing.avgSentiment + aiSentiment.sentiment_score) / 2;
        if (!existing.industryContext && response.confirmed_prompts?.industry_context) {
          existing.industryContext = response.confirmed_prompts.industry_context;
        }
        if (!existing.jobFunctionContext && response.confirmed_prompts?.job_function_context) {
          existing.jobFunctionContext = response.confirmed_prompts.job_function_context;
        }
        if (!existing.locationContext && response.confirmed_prompts?.location_context) {
          existing.locationContext = response.confirmed_prompts.location_context;
        }
        if (!existing.promptCategory && response.confirmed_prompts?.prompt_category) {
          existing.promptCategory = response.confirmed_prompts.prompt_category || undefined;
        }
        if (!existing.promptTheme && response.confirmed_prompts?.prompt_theme) {
          const theme = response.confirmed_prompts.prompt_theme || undefined;
          existing.promptTheme = theme;
          if (theme) {
            existing.category = theme;
          }
        }
        // Update attributeId from confirmed_prompts if not already set
        const attrId = (response.confirmed_prompts as any)?.attribute_id;
        if (!existing.attributeId && attrId) {
          existing.attributeId = attrId;
        }
        // Add visibility score to array
        if (visibilityScore !== undefined) {
          existing.visibilityScores = existing.visibilityScores || [];
          existing.visibilityScores.push(visibilityScore);
        }
        // Update visibility metrics
        if (response.confirmed_prompts?.prompt_type === 'discovery') {
          if (typeof existing.averageVisibility === 'number') {
            existing.averageVisibility = (existing.averageVisibility * (existing.responses - 1) + (response.company_mentioned ? 100 : 0)) / existing.responses;
          } else {
            existing.averageVisibility = response.company_mentioned ? 100 : 0;
          }
        }
        // Update competitive metrics
        if (response.confirmed_prompts?.prompt_type === 'competitive') {
          if (response.detected_competitors) {
            const mentions = response.detected_competitors.split(',').map(m => m.trim()).filter(m => m.length > 0);
            existing.detectedCompetitors = mentions.join(',');
          }
        }
      } else {
        const promptCategoryValue = response.confirmed_prompts?.prompt_category || 'General';
        const promptThemeValue = response.confirmed_prompts?.prompt_theme || 'General';
        const key = promptKey || '';
        byPrompt.set(key, {
          prompt: key,
          category: promptThemeValue,
          type: response.confirmed_prompts?.prompt_type || 'experience',
          industryContext: response.confirmed_prompts?.industry_context || undefined,
          jobFunctionContext: response.confirmed_prompts?.job_function_context || undefined,
          locationContext: response.confirmed_prompts?.location_context || undefined,
          promptCategory: promptCategoryValue,
          promptTheme: promptThemeValue,
          responses: 1,
          avgSentiment: aiSentiment.sentiment_score,
          sentimentLabel: aiSentiment.sentiment_label,
          mentionRanking: undefined,
          competitivePosition: undefined,
          detectedCompetitors: response.detected_competitors || undefined,
          averageVisibility: (response.confirmed_prompts?.prompt_type === 'discovery') ? (response.company_mentioned ? 100 : 0) : undefined,
          visibilityScores: visibilityScore !== undefined ? [visibilityScore] : [],
          isAttributePrompt: isAttributeResponse,
          attributeId: (response.confirmed_prompts as any)?.attribute_id,
          attributePromptType: response.confirmed_prompts?.prompt_type
        });
      }
    }
    const responseBasedPrompts: PromptData[] = Array.from(byPrompt.values());

    // Deduplicate by prompt text using a Map — previously this was a reduce
    // with nested .find() + .findIndex() (O(N²)).
    const uniqueByText = new Map<string, PromptData>();
    for (const p of responseBasedPrompts) uniqueByText.set(p.prompt, p);

    // Merge in currently-active prompts that aren't represented yet. Using the
    // same Map keeps this O(N) instead of O(N × M). Under a location filter,
    // only prompts that belong to the selection (attribution rule) are merged
    // — otherwise sibling profiles' prompts for OTHER countries render as
    // bogus never-tested "0 responses" rows.
    activePrompts.forEach(prompt => {
      if (uniqueByText.has(prompt.prompt_text)) return;
      if (selectedLocation && selectedLocationEntry) {
        const key = resolveResponseLocationKey(
          prompt.location_context,
          prompt.company_id != null ? (countryKeyByCompanyId.get(prompt.company_id) ?? null) : null
        );
        const matches = selectedLocation === GENERAL_KEY ? key === null : key === selectedLocation;
        if (!matches) return;
      }
      uniqueByText.set(prompt.prompt_text, {
        prompt: prompt.prompt_text,
        category: prompt.prompt_theme || 'General',
        type: prompt.prompt_type || 'experience',
        industryContext: prompt.industry_context || undefined,
        jobFunctionContext: prompt.job_function_context || undefined,
        locationContext: prompt.location_context || undefined,
        promptCategory: prompt.prompt_category || undefined,
        promptTheme: prompt.prompt_theme || undefined,
        responses: 0,
        avgSentiment: 0,
        sentimentLabel: 'neutral',
        mentionRanking: undefined,
        competitivePosition: undefined,
        detectedCompetitors: undefined,
        averageVisibility: (prompt.prompt_type === 'discovery') ? 0 : undefined,
        totalWords: undefined,
        firstMentionPosition: undefined,
        visibilityScores: [],
      });
    });

    return Array.from(uniqueByText.values());
  }, [periodFilteredResponses, calculateAIBasedSentiment, activePrompts, selectedLocation, selectedLocationEntry, countryKeyByCompanyId]);

  // Track when metrics calculation is complete (all data loaded)
  // Don't show anything until sentiment loads - this ensures all metrics appear together
  // CRITICAL: Only show metrics when data is ACTUALLY ready and calculated
  useEffect(() => {
    // ROLLUP-FIRST READINESS: the scorecards no longer wait for the raw
    // response stream (it now lands AFTER first paint). Metrics are ready
    // when:
    // 1. The sentiment/relevance MV fetch has settled (sentiment is MV-only).
    // 2. Visibility has an EXACT source — rollup rows arrived, or (rollup
    //    empty / still loading) enough of the raw fallback exists to count.
    //    Without this gate the scorecards could paint a false 0% visibility
    //    from zero loaded responses before the rollup lands.
    // 3. Relevance has backend metrics OR the recency fetch settled.
    // 4. No location swap is mid-fetch (would flash company-wide numbers).
    // A load that finished with ZERO responses keeps calculating=true, same
    // as before — the page-level setup/"analysis in progress" states own
    // that render, not the scorecards.
    const responsesFinal = responsesLoadedCompanyId === currentCompany?.id;
    const finalAndEmpty = responsesFinal && responses.length === 0;
    const backendMetricsReady = !companyMetricsLoading;

    // Judge readiness on the LOCATION-SCOPED rollup rows — the same set the
    // rendered visibility number consumes — not the scope-wide fetch result.
    // A selection whose bucket is missing from the visibility MV (differential
    // MV staleness) must keep waiting for the raw fallback, or the scorecard
    // would paint real sentiment next to a false 0% visibility.
    const visibilityReady =
      visibilityRowsForSelection.length > 0 ||
      (!visibilityMvLoading && responses.length > 0) ||
      responsesFinal;

    // Relevance is ready if backend metrics exist OR recency fetch completed
    const hasBackendRelevance = companyRelevanceMetrics !== null;
    const recencyFetchCompleted = !recencyDataLoading && (recencyData.length >= 0 || hasBackendRelevance);
    const relevanceReady = hasBackendRelevance || recencyFetchCompleted;

    const allReady = !loading && backendMetricsReady && visibilityReady && relevanceReady &&
      !locationMetricsLoading && !finalAndEmpty;
    setMetricsCalculating(!allReady);

  }, [loading, responses.length, responsesLoadedCompanyId, currentCompany?.id, companyMetricsLoading, companySentimentMetrics, companyRelevanceMetrics, recencyDataLoading, recencyData.length, locationMetricsLoading, visibilityMvLoading, visibilityRowsForSelection]);

  const metrics: DashboardMetrics = useMemo(() => {
    // Use period-filtered responses when a period is selected (multi-month companies)
    // This ensures all downstream metrics reflect the active period
    const responses = periodFilteredResponses;

    // PREFER backend-calculated metrics from materialized views if available
    // Fallback to frontend calculation if backend data is not available

    // Visibility rollup for the effective period, computed up front so BOTH
    // "is there any data at all" guards below can see it. Raw responses now
    // stream in after first paint, so responses.length === 0 no longer means
    // "no data" — the rollups may already carry exact numbers.
    const effectivePeriodKey = effectivePeriod?.key;
    const mvVisibility = visibilityFromMvRows(visibilityRowsForSelection, effectivePeriodKey ?? null, null);

    // Don't calculate if still loading AND no rollup source (sentiment/
    // relevance MV metrics or the visibility rollup) has anything. If any
    // rollup has data, compute from it even before responses arrive.
    if ((loading || responses.length === 0) && !effSentimentMetrics && !effRelevanceMetrics && !mvVisibility) {
      return {
        averageSentiment: 0,
        sentimentLabel: 'Neutral',
        sentimentTrendComparison: { value: 0, direction: 'neutral' as const },
        visibilityTrendComparison: { value: 0, direction: 'neutral' as const },
        citationsTrendComparison: { value: 0, direction: 'neutral' as const },
        totalCitations: 0,
        uniqueDomains: 0,
        totalResponses: 0,
        averageVisibility: 0,
        averageRelevance: 0,
        positiveCount: 0,
        neutralCount: 0,
        negativeCount: 0,
        perceptionScore: 0,
        perceptionLabel: 'No Data',
        // Required on DashboardMetrics — include them so the early-return
        // path typechecks. All zero because nothing has loaded yet.
        sentimentScore: 0,
        visibilityScore: 0,
        relevanceScore: 0,
      };
    }
    
    let averageSentiment = 0;
    let positiveCount = 0;
    let neutralCount = 0;
    let negativeCount = 0;

    // Use materialized view sentiment only — no frontend fallback
    if (effectivePeriodKey && effSentimentByMonth[effectivePeriodKey] !== undefined) {
      // Period selected — use per-month MV value
      averageSentiment = effSentimentByMonth[effectivePeriodKey];
    } else if (effSentimentMetrics) {
      // No specific period — use all-months aggregate from MV
      averageSentiment = effSentimentMetrics.sentiment_ratio || 0;
    }
    // Estimate counts based on ratios (for display purposes)
    const totalResponses = responses.length;
    if (effSentimentMetrics && effSentimentMetrics.total_themes > 0) {
      const positiveRatio = effSentimentMetrics.positive_themes / effSentimentMetrics.total_themes;
      const negativeRatio = effSentimentMetrics.negative_themes / effSentimentMetrics.total_themes;
      positiveCount = Math.round(totalResponses * positiveRatio);
      negativeCount = Math.round(totalResponses * negativeRatio);
      neutralCount = totalResponses - positiveCount - negativeCount;
    } else {
      neutralCount = totalResponses;
    }

    const sentimentLabel = averageSentiment > 0.6 ? 'Positive' : averageSentiment < 0.4 ? 'Negative' : 'Neutral';

    let sentimentTrendComparison: { value: number; direction: 'up' | 'down' | 'neutral' } = { value: 0, direction: 'neutral' };
    let visibilityTrendComparison: { value: number; direction: 'up' | 'down' | 'neutral' } = { value: 0, direction: 'neutral' };
    let citationsTrendComparison: { value: number; direction: 'up' | 'down' | 'neutral' } = { value: 0, direction: 'neutral' };
    
    if (responses.length > 1) {
      const sorted = [...responses].sort((a, b) => new Date(b.tested_at).getTime() - new Date(a.tested_at).getTime());
      
      const latestDate = new Date(sorted[0].tested_at).toDateString();
      
      const currentResponses = sorted.filter(r => new Date(r.tested_at).toDateString() === latestDate);
      const previousResponses = sorted.filter(r => new Date(r.tested_at).toDateString() !== latestDate);

      if (previousResponses.length > 0) {
        const previousUniqueDays = new Set(previousResponses.map(r => new Date(r.tested_at).toDateString()));
        const numPreviousDays = Math.max(1, previousUniqueDays.size);

        // Calculate sentiment trend using AI-based sentiment if available
        let currentSentimentAvg: number;
        let previousSentimentAvg: number;

        if (sentimentCacheState.size > 0) {
          const currentAISentiments = currentResponses.map(r => calculateAIBasedSentiment(r.id));
          const previousAISentiments = previousResponses.map(r => calculateAIBasedSentiment(r.id));
          
          currentSentimentAvg = currentAISentiments.length > 0 
            ? currentAISentiments.reduce((sum, s) => sum + s.sentiment_score, 0) / currentAISentiments.length
            : 0;
          
          previousSentimentAvg = previousAISentiments.length > 0
            ? previousAISentiments.reduce((sum, s) => sum + s.sentiment_score, 0) / previousAISentiments.length
            : 0;
        } else {
          // No fallback to original sentiment - use neutral when no AI themes
          currentSentimentAvg = 0;
          previousSentimentAvg = 0;
        }

        const sentimentChange = currentSentimentAvg - previousSentimentAvg;
        sentimentTrendComparison = {
          value: Math.abs(Math.round(sentimentChange * 100)),
          direction: sentimentChange > 0.05 ? 'up' : sentimentChange < -0.05 ? 'down' : 'neutral'
        };

        // Calculate visibility trend using company_mentioned percentage
        const currentMentionedCount = currentResponses.filter(r => r.company_mentioned === true).length;
        const currentVisibilityAvg = currentResponses.length > 0 ? (currentMentionedCount / currentResponses.length) * 100 : 0;
        
        const previousMentionedCount = previousResponses.filter(r => r.company_mentioned === true).length;
        const previousVisibilityAvg = previousResponses.length > 0 ? (previousMentionedCount / previousResponses.length) * 100 : 0;
        
        const visibilityChange = currentVisibilityAvg - previousVisibilityAvg;
        visibilityTrendComparison = {
          value: Math.abs(visibilityChange),
          direction: visibilityChange > 1 ? 'up' : visibilityChange < -1 ? 'down' : 'neutral'
        };

        // Calculate citations trend
        const currentCitationsTotal = currentResponses.reduce((sum, r) => sum + getCitations(r.id).length, 0);
        const previousCitationsTotal = previousResponses.reduce((sum, r) => sum + getCitations(r.id).length, 0);
        const previousCitationsAvg = previousCitationsTotal / numPreviousDays;
        const citationsChange = currentCitationsTotal - previousCitationsAvg;
        citationsTrendComparison = {
          value: Math.abs(Math.round(citationsChange)),
          direction: citationsChange > 0.1 ? 'up' : citationsChange < -0.1 ? 'down' : 'neutral'
        };
      }
    }

    const totalCitations = responses.reduce((sum, r) => sum + getCitations(r.id).length, 0);
    const uniqueDomains = new Set(
      responses.flatMap(r => getCitations(r.id).map((c: Citation) => c.domain).filter(Boolean))
    ).size;

    // Visibility: prefer the precomputed rollup (exact for the whole scope,
    // independent of how much of the raw response stream has arrived — see
    // mvVisibility hoisted above); fall back to counting loaded responses
    // when the rollup has no matching rows.
    const mentionedCount = responses.filter(r => r.company_mentioned === true).length;
    const averageVisibility = mvVisibility
      ? mvVisibility.pct
      : responses.length > 0
        ? (mentionedCount / responses.length) * 100
        : 0;

    // Use period-specific relevance from MV when a period is active, otherwise fall back to all-months aggregate
    const averageRelevance = (effectivePeriodKey && effRelevanceByMonth[effectivePeriodKey] !== undefined)
      ? effRelevanceByMonth[effectivePeriodKey]
      : effRelevanceMetrics?.relevance_score ?? 0;

    // Calculate overall perception score
    const calculatePerceptionScore = () => {
      // "No Data" only when NO source has anything — zero loaded responses
      // used to imply that, but raw rows now stream in after first paint
      // while the rollups already carry the exact score inputs.
      if (responses.length === 0 && !mvVisibility && !effSentimentMetrics && !effRelevanceMetrics) {
        return { score: 0, label: 'No Data', sentimentScore: 0, visibilityScore: 0, relevanceScore: 0 };
      }

      const sentimentScore = Math.round(Math.max(0, Math.min(100, averageSentiment * 100)));
      const visibilityScore = Math.round(averageVisibility);
      const relevanceScore = Math.round(averageRelevance);

      // Weighted formula: 50% sentiment + 30% visibility + 20% relevance
      const perceptionScore = Math.round(
        (sentimentScore * 0.5) + 
        (visibilityScore * 0.3) + 
        (relevanceScore * 0.2)
      );

      let perceptionLabel = 'Poor';
      if (perceptionScore >= 80) perceptionLabel = 'Excellent';
      else if (perceptionScore >= 65) perceptionLabel = 'Good';
      else if (perceptionScore >= 50) perceptionLabel = 'Fair';
      else if (perceptionScore >= 30) perceptionLabel = 'Poor';

      return { score: perceptionScore, label: perceptionLabel, sentimentScore, visibilityScore, relevanceScore };
    };

    const { score: perceptionScore, label: perceptionLabel, sentimentScore, visibilityScore, relevanceScore } = calculatePerceptionScore();

    const metricsResult = {
      averageSentiment,
      sentimentLabel,
      sentimentTrendComparison,
      visibilityTrendComparison,
      citationsTrendComparison,
      totalCitations,
      uniqueDomains,
      totalResponses: responses.length,
      averageVisibility,
      averageRelevance,
      positiveCount,
      neutralCount,
      negativeCount,
      perceptionScore,
      perceptionLabel,
      sentimentScore,
      visibilityScore,
      relevanceScore
    };
    
    return metricsResult;
  }, [periodFilteredResponses, promptsData, aiThemes, calculateAIBasedSentiment, effSentimentMetrics, effSentimentByMonth, effRelevanceMetrics, effRelevanceByMonth, effectivePeriod, getCitations, visibilityRowsForSelection]);

  // Per-month EPS trend powering the Overview headline sparkline. One point per
  // available month (oldest → selected period), each computed with the SAME
  // 50/30/20 weighting as the headline metric so the latest point equals the
  // big EPS number. Sentiment/relevance come from the monthly MVs (falling back
  // to the all-months aggregate when a month is missing, mirroring the headline
  // fallback); visibility is computed from that month's responses.
  const epsTrend = useMemo(() => {
    if (availablePeriods.length === 0) return [];
    const periodsAsc = [...availablePeriods].sort(
      (a, b) => a.startDate.getTime() - b.startDate.getTime()
    );
    const sentimentAgg = effSentimentMetrics?.sentiment_ratio;
    const relevanceAgg = effRelevanceMetrics?.relevance_score;

    const full = periodsAsc.map((p) => {
      // Snapshot-month bucketing (responseMonthKey), matching the period
      // filter — NOT tested_at, which can fall in the prior calendar month.
      // Visibility prefers the exact rollup for the month.
      const monthResponses = visibleResponses.filter((r) => responseMonthKey(r) === p.key);
      const mvMonth = visibilityFromMvRows(visibilityRowsForSelection, p.key, null);
      const mentioned = monthResponses.filter((r) => r.company_mentioned === true).length;
      const visibility = mvMonth
        ? Math.round(mvMonth.pct)
        : monthResponses.length > 0
          ? Math.round((mentioned / monthResponses.length) * 100)
          : 0;

      const sRatio = effSentimentByMonth[p.key] ?? sentimentAgg ?? 0;
      const sentiment = Math.round(Math.max(0, Math.min(100, sRatio * 100)));

      const rVal = effRelevanceByMonth[p.key] ?? relevanceAgg ?? 0;
      const relevance = Math.round(rVal);

      const score = Math.round(sentiment * 0.5 + visibility * 0.3 + relevance * 0.2);
      return {
        key: p.key,
        date: p.label,
        score,
        sentiment,
        visibility,
        relevance,
        responseCount: mvMonth ? mvMonth.total : monthResponses.length,
      };
    });

    // Trim to the selected period so the line ends on the month whose EPS the
    // card headline is showing (default selection is the latest month).
    const selIdx = effectivePeriod ? full.findIndex((d) => d.key === effectivePeriod.key) : full.length - 1;
    return selIdx >= 0 ? full.slice(0, selIdx + 1) : full;
  }, [availablePeriods, visibleResponses, effSentimentByMonth, effRelevanceByMonth, effSentimentMetrics, effRelevanceMetrics, effectivePeriod, visibilityRowsForSelection]);

  // Period-over-period EPS delta — last two points of the trimmed trend.
  const epsChange = useMemo<number | null>(() => {
    if (epsTrend.length < 2) return null;
    return epsTrend[epsTrend.length - 1].score - epsTrend[epsTrend.length - 2].score;
  }, [epsTrend]);

  // Per-job-function scorecard metrics, so the Overview tab can rescope EPS /
  // Breakdown when a function is selected. Sentiment & relevance come from the
  // MV rows (which now carry job_function_context); visibility is the
  // company_mentioned rate of that function's responses. EPS uses the same
  // 50/30/20 weighting as the global score.
  const metricsByJobFunction = useMemo(() => {
    const result: Record<string, {
      perceptionScore: number; perceptionLabel: string;
      sentimentScore: number; visibilityScore: number; relevanceScore: number;
    }> = {};

    const fns = new Set<string>();
    effSentimentMvRows.forEach(r => { if (r.job_function_context) fns.add(r.job_function_context); });
    effRelevanceMvRows.forEach(r => { if (r.job_function_context) fns.add(r.job_function_context); });
    visibilityRowsForSelection.forEach(r => { if (r.job_function_context) fns.add(r.job_function_context); });
    periodFilteredResponses.forEach(r => {
      const f = r.confirmed_prompts?.job_function_context?.trim();
      if (f) fns.add(f);
    });

    fns.forEach(fn => {
      // Sentiment — positive themes / total themes across this function's rows
      let totalThemes = 0, positiveThemes = 0;
      effSentimentMvRows.forEach(r => {
        if (r.job_function_context !== fn) return;
        totalThemes += r.total_themes || 0;
        positiveThemes += r.positive_themes || 0;
      });
      const sentimentScore = totalThemes > 0
        ? Math.round(Math.max(0, Math.min(100, (positiveThemes / totalThemes) * 100)))
        : 0;

      // Relevance — citation-weighted average recency score
      let relWeighted = 0, relWeight = 0;
      effRelevanceMvRows.forEach(r => {
        if (r.job_function_context !== fn) return;
        relWeighted += (r.relevance_score || 0) * (r.valid_citations || 0);
        relWeight += r.valid_citations || 0;
      });
      const relevanceScore = relWeight > 0 ? Math.round(relWeighted / relWeight) : 0;

      // Visibility — prefer the exact rollup for (function, effective period);
      // fall back to the company_mentioned rate of this function's responses.
      const mvFn = visibilityFromMvRows(visibilityRowsForSelection, effectivePeriod?.key ?? null, fn);
      const fnResponses = periodFilteredResponses.filter(
        r => r.confirmed_prompts?.job_function_context?.trim() === fn
      );
      const mentioned = fnResponses.filter(r => r.company_mentioned === true).length;
      const visibilityScore = mvFn
        ? Math.round(mvFn.pct)
        : fnResponses.length > 0
          ? Math.round((mentioned / fnResponses.length) * 100)
          : 0;

      const perceptionScore = Math.round(
        (sentimentScore * 0.5) + (visibilityScore * 0.3) + (relevanceScore * 0.2)
      );
      let perceptionLabel = 'Poor';
      if (perceptionScore >= 80) perceptionLabel = 'Excellent';
      else if (perceptionScore >= 65) perceptionLabel = 'Good';
      else if (perceptionScore >= 50) perceptionLabel = 'Fair';
      else if (perceptionScore >= 30) perceptionLabel = 'Poor';

      result[fn] = { perceptionScore, perceptionLabel, sentimentScore, visibilityScore, relevanceScore };
    });

    return result;
  }, [effSentimentMvRows, effRelevanceMvRows, periodFilteredResponses, visibilityRowsForSelection, effectivePeriod]);

  // Per-job-function monthly EPS trend — same 50/30/20 formula as
  // metricsByJobFunction, resolved one month at a time, so the headline
  // sparkline + delta work while a function filter is active. Only months
  // where the function actually has responses are included; when a month is
  // missing sentiment/relevance from the MVs we fall back to that function's
  // all-months aggregate so the line never dips to an artificial zero. The
  // selected-period point is aligned to metricsByJobFunction so the endpoint
  // equals the big EPS number on the card.
  const epsTrendByJobFunction = useMemo<Record<string, Array<{ key: string; date: string; score: number; sentiment: number; visibility: number; relevance: number; responseCount: number }>>>(() => {
    if (availablePeriods.length === 0) return {};
    const periodsAsc = [...availablePeriods].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    const fns = new Set<string>();
    effSentimentMvRows.forEach(r => { if (r.job_function_context) fns.add(r.job_function_context); });
    effRelevanceMvRows.forEach(r => { if (r.job_function_context) fns.add(r.job_function_context); });
    visibilityRowsForSelection.forEach(r => { if (r.job_function_context) fns.add(r.job_function_context); });
    visibleResponses.forEach(r => { const f = r.confirmed_prompts?.job_function_context?.trim(); if (f) fns.add(f); });

    // Pre-bucket MV rows by "fn YYYY-MM" so each (fn, month) lookup is O(1).
    const sentBucket = new Map<string, { pos: number; tot: number }>();
    effSentimentMvRows.forEach(r => {
      if (!r.job_function_context || !r.response_month) return;
      const k = `${r.job_function_context} ${r.response_month.slice(0, 7)}`;
      const b = sentBucket.get(k) || { pos: 0, tot: 0 };
      b.pos += r.positive_themes || 0; b.tot += r.total_themes || 0;
      sentBucket.set(k, b);
    });
    const relBucket = new Map<string, { w: number; wt: number }>();
    effRelevanceMvRows.forEach(r => {
      if (!r.job_function_context || !r.response_month) return;
      const k = `${r.job_function_context} ${r.response_month.slice(0, 7)}`;
      const b = relBucket.get(k) || { w: 0, wt: 0 };
      b.w += (r.relevance_score || 0) * (r.valid_citations || 0); b.wt += r.valid_citations || 0;
      relBucket.set(k, b);
    });

    const result: Record<string, any[]> = {};
    fns.forEach(fn => {
      const agg = metricsByJobFunction[fn]; // all-months aggregate (fallback + endpoint match)
      const series: any[] = [];
      periodsAsc.forEach(p => {
        const monthResponses = visibleResponses.filter(r =>
          r.confirmed_prompts?.job_function_context?.trim() === fn &&
          responseMonthKey(r) === p.key
        );
        // Exact rollup for (function, month) preferred; a month the function
        // wasn't measured in (no rollup rows AND no responses) is skipped.
        const mvFnMonth = visibilityFromMvRows(visibilityRowsForSelection, p.key, fn);
        if (monthResponses.length === 0 && !mvFnMonth) return; // not measured this month
        const mentioned = monthResponses.filter(r => r.company_mentioned === true).length;
        const visibility = mvFnMonth
          ? Math.round(mvFnMonth.pct)
          : Math.round((mentioned / monthResponses.length) * 100);

        const sb = sentBucket.get(`${fn} ${p.key}`);
        const sentiment = sb && sb.tot > 0
          ? Math.round(Math.max(0, Math.min(100, (sb.pos / sb.tot) * 100)))
          : (agg?.sentimentScore ?? 0);

        const rb = relBucket.get(`${fn} ${p.key}`);
        const relevance = rb && rb.wt > 0 ? Math.round(rb.w / rb.wt) : (agg?.relevanceScore ?? 0);

        const score = Math.round(sentiment * 0.5 + visibility * 0.3 + relevance * 0.2);
        series.push({ key: p.key, date: p.label, score, sentiment, visibility, relevance, responseCount: mvFnMonth ? mvFnMonth.total : monthResponses.length });
      });

      // Trim to the selected period; pin the endpoint to the headline metric.
      const selIdx = effectivePeriod ? series.findIndex(d => d.key === effectivePeriod.key) : series.length - 1;
      const trimmed = selIdx >= 0 ? series.slice(0, selIdx + 1) : series;
      if (trimmed.length > 0 && agg && effectivePeriod && trimmed[trimmed.length - 1].key === effectivePeriod.key) {
        const last = trimmed[trimmed.length - 1];
        trimmed[trimmed.length - 1] = {
          ...last,
          score: agg.perceptionScore,
          sentiment: agg.sentimentScore,
          visibility: agg.visibilityScore,
          relevance: agg.relevanceScore,
        };
      }
      result[fn] = trimmed;
    });
    return result;
  }, [availablePeriods, effSentimentMvRows, effRelevanceMvRows, visibleResponses, effectivePeriod, metricsByJobFunction, visibilityRowsForSelection]);

  // Per-function period-over-period EPS delta (last two trend points).
  const epsChangeByJobFunction = useMemo<Record<string, number | null>>(() => {
    const result: Record<string, number | null> = {};
    Object.entries(epsTrendByJobFunction).forEach(([fn, series]) => {
      result[fn] = series.length >= 2
        ? series[series.length - 1].score - series[series.length - 2].score
        : null;
    });
    return result;
  }, [epsTrendByJobFunction]);

  const topCitations: CitationCount[] = useMemo(() => {
    if (!currentCompany?.id || isSwitchingCompany) return [];

    // Start with MV data (AI citations, pre-aggregated on the backend) —
    // location-scoped when a location filter is active, else company-wide.
    const combined: Record<string, number> = {};
    effMvTopCitations.forEach(c => {
      combined[c.domain] = (combined[c.domain] || 0) + c.count;
    });

    // Merge in search result citations (already cached, lightweight)
    const currentCompanySearchResults = searchResults.filter(r => r.company_id === currentCompany.id);
    currentCompanySearchResults.forEach(result => {
      const domain = result.domain;
      if (domain) {
        combined[domain] = (combined[domain] || 0) + (result.mentionCount || 1);
      }
    });

    // Fallback: if the MV hasn't populated yet, compute from responses. Use the
    // location+period-scoped responses when a location is active so the fallback
    // stays scoped too. Responses span the whole brand scope (siblings), so
    // filter by the scope set rather than the current company row alone.
    const fallbackResponses = locActive ? periodFilteredResponses : responses;
    if (effMvTopCitations.length === 0 && fallbackResponses.length > 0) {
      const scopeSet = new Set(scopeCompanyIds);
      const currentCompanyResponses = fallbackResponses.filter(r => !r.company_id || scopeSet.has(r.company_id));
      const allCitations = currentCompanyResponses.flatMap(r => enhanceCitations(getCitations(r.id)));
      const websiteCitations = allCitations.filter(citation => citation.type === 'website' && citation.url);
      websiteCitations.forEach((citation: EnhancedCitation) => {
        const domain = citation.domain;
        if (domain) {
          combined[domain] = (combined[domain] || 0) + 1;
        }
      });
    }

    return Object.entries(combined)
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effMvTopCitations, locActive, periodFilteredResponses, searchResults, responses, currentCompany?.id, scopeKey, isSwitchingCompany, getCitations]);

  const preparePromptData = (prompts: any[], responses: any[]): PromptData[] => {
    return prompts.map(prompt => {
      const promptResponses = responses.filter(r => r.confirmed_prompt_id === prompt.id);
      const totalResponses = promptResponses.length;

      const sentiments = promptResponses.map(r => calculateAIBasedSentiment(r.id));
      const avgSentiment = totalResponses > 0
        ? sentiments.reduce((sum, s) => sum + s.sentiment_score, 0) / totalResponses
        : 0;
      const sentimentLabel = avgSentiment > 0.1 ? 'positive' : avgSentiment < -0.1 ? 'negative' : 'neutral';

      const mentionedCount = promptResponses.filter(r => r.company_mentioned === true).length;
      let averageVisibility: number | undefined = undefined;
      if (promptResponses.length > 0) {
        averageVisibility = (mentionedCount / promptResponses.length) * 100;
      }
      
      return {
        prompt: prompt.prompt_text,
        category: prompt.prompt_category,
        type: prompt.prompt_type,
        responses: totalResponses,
        avgSentiment,
        sentimentLabel,
        mentionRanking: undefined,
        competitivePosition: undefined,
        detectedCompetitors: promptResponses[0]?.detected_competitors,
        averageVisibility
      };
    });
  };


  const topCompetitors = useMemo(() => {
    if (!companyName || isSwitchingCompany) return [];

    // Start with MV data (AI responses, pre-aggregated on the backend) —
    // location-scoped when a location filter is active, else company-wide.
    const combined: Record<string, number> = {};
    effMvTopCompetitors.forEach(c => {
      combined[c.company] = (combined[c.company] || 0) + c.count;
    });

    // Merge in search result competitors (already cached, lightweight)
    searchResults.forEach(result => {
      if (result.detectedCompetitors && result.detectedCompetitors.trim()) {
        const validCompetitors = parseCompetitors(result.detectedCompetitors, companyName);
        validCompetitors.forEach(competitor => {
          const weight = result.mentionCount || 1;
          combined[competitor] = (combined[competitor] || 0) + weight;
        });
      }
    });

    // Fallback: if the MV hasn't populated yet, compute from responses
    // (location+period-scoped when a location is active).
    const fallbackResponses = locActive ? periodFilteredResponses : responses;
    if (effMvTopCompetitors.length === 0 && fallbackResponses.length > 0 && !loading) {
      fallbackResponses.forEach(response => {
        if (response.detected_competitors) {
          const validCompetitors = parseCompetitors(response.detected_competitors, companyName);
          validCompetitors.forEach(competitor => {
            combined[competitor] = (combined[competitor] || 0) + 1;
          });
        }
      });
    }

    return Object.entries(combined)
      .map(([company, count]) => ({ company, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
  }, [effMvTopCompetitors, locActive, periodFilteredResponses, searchResults, responses, companyName, loading, isSwitchingCompany]);

  const llmMentionRankings = useMemo(() => {
    // Use MV data if available (location-scoped when a location is active);
    // fall back to responses when the MV hasn't refreshed yet.
    if (effMvLlmRankings.length > 0) return effMvLlmRankings;

    const fallbackResponses = locActive ? periodFilteredResponses : responses;
    if (!fallbackResponses.length) return [];
    const modelMentions: Record<string, number> = {};
    fallbackResponses.forEach(response => {
      if (response.company_mentioned) {
        modelMentions[response.ai_model] = (modelMentions[response.ai_model] || 0) + 1;
      }
    });
    return Object.entries(modelMentions)
      .map(([model, mentions]) => ({
        model,
        displayName: getLLMDisplayName(model),
        mentions,
        logoUrl: getLLMLogo(model),
      }))
      .sort((a, b) => b.mentions - a.mentions);
  }, [effMvLlmRankings, locActive, periodFilteredResponses, responses]);

  const fixExistingPrompts = useCallback(async () => {
    // Legacy migration helper — used to backfill confirmed_prompts.user_id
    // by joining through user_onboarding. user_onboarding is retired and
    // there are no more unmigrated rows, so this is now a no-op.
    return;

    // eslint-disable-next-line no-unreachable
    if (!user) return;
    try {
      // unreachable
      const { data: userOnboarding, error: onboardingError } = { data: null, error: null } as any;
      if (onboardingError) return;
      if (userOnboarding && userOnboarding.length > 0) {
        const onboardingId = userOnboarding[0].id;
        const { error: updateError } = await supabase
          .from('confirmed_prompts')
          .update({ user_id: user.id })
          .eq('onboarding_id', onboardingId)
          .is('user_id', null);
        if (!updateError) fetchResponses();
      }
    } catch (error) {
      console.error('Error in fixMissingUserIds:', error);
    }
  }, [user, fetchResponses]);

  // Function to fetch historical responses for a specific time range
  // Enables time period comparison features in the dashboard
  const fetchHistoricalResponses = useCallback(async (startDate: Date, endDate: Date) => {
    if (!user || !currentCompany) {
      return [];
    }

    try {
      // Per-company queries (indexed (company_id, tested_at) path, bounded)
      // merged client-side — the merged .in() + ORDER BY tested_at shape is
      // the one that hit statement timeouts in the incident, and PostgREST's
      // max_rows clamp would silently truncate a single merged result anyway.
      const ids = scopeCompanyIds.length > 0 ? scopeCompanyIds : [currentCompany.id];
      const results = await Promise.all(ids.map(id =>
        withDbSlot(() => supabase
          // Canonicalized view — historical fetch should also see merged names.
          .from('prompt_responses_canonical')
          .select(`
            id,
            confirmed_prompt_id,
            company_id,
            ai_model,
            tested_at,
            created_at,
            updated_at,
            company_mentioned,
            detected_competitors,
            citations,
            for_index,
            index_period,
            confirmed_prompts(
              prompt_text,
              prompt_category,
              prompt_type
            )
          `)
          .eq('company_id', id)
          .gte('tested_at', startDate.toISOString())
          .lte('tested_at', endDate.toISOString())
          .order('tested_at', { ascending: false })
          .limit(1000))
      ));
      const err = results.find(r => r.error)?.error;
      if (err) throw err;
      const data = results
        .flatMap(r => r.data ?? [])
        .sort((a: any, b: any) => new Date(b.tested_at).getTime() - new Date(a.tested_at).getTime());

      // Filter to get only the latest response for each prompt+model in this time range
      const latestInRangeMap = new Map<string, any>();
      data.forEach(response => {
        const key = `${response.confirmed_prompt_id}_${response.ai_model}`;
        if (!latestInRangeMap.has(key)) {
          latestInRangeMap.set(key, response);
        }
      });

      return Array.from(latestInRangeMap.values());
    } catch (error) {
      console.error('Error fetching historical responses:', error);
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, currentCompany, scopeKey]);

  // Function to get all unique collection dates for this company
  // Useful for showing a timeline or date selector for comparisons
  const fetchCollectionDates = useCallback(async () => {
    if (!user || !currentCompany) {
      return [];
    }

    try {
      // Per-company (indexed path; avoids the merged-.in ordered scan) and
      // paginated — a single unbounded select is clamped to max_rows by
      // PostgREST, which would silently drop the oldest collection dates.
      const ids = scopeCompanyIds.length > 0 ? scopeCompanyIds : [currentCompany.id];
      const PAGE = 1000;
      const perCompany = await Promise.all(ids.map(async (id) => {
        const rows: any[] = [];
        for (let page = 0; page < 60; page += 1) {
          const { data, error } = await withDbSlot(() => supabase
            .from('prompt_responses')
            .select('tested_at')
            .eq('company_id', id)
            .order('tested_at', { ascending: false })
            .range(page * PAGE, (page + 1) * PAGE - 1));
          if (error) throw error;
          const chunk = data ?? [];
          rows.push(...chunk);
          if (chunk.length < PAGE) break;
        }
        return rows;
      }));

      // Get unique dates (just the date part, not time)
      const uniqueDates = new Set<string>();
      perCompany.flat().forEach(response => {
        const date = new Date(response.tested_at).toISOString().split('T')[0];
        uniqueDates.add(date);
      });

      return Array.from(uniqueDates).sort().reverse();
    } catch (error) {
      console.error('Error fetching collection dates:', error);
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, currentCompany, scopeKey]);

  return {
    responses: periodFilteredResponses, // period-filtered when multi-month
    allResponses: responses, // unfiltered, for period detection
    loading,
    competitorLoading,
    metricsLoading,
    isFullyLoaded,
    companyName,
    metrics,
    metricsByJobFunction, // Per-job-function scorecard metrics for the Overview filter
    epsTrend, // Per-month EPS series for the Overview headline sparkline
    epsChange, // Period-over-period EPS delta
    epsTrendByJobFunction, // Per-function per-month EPS series (for the function filter)
    epsChangeByJobFunction, // Per-function period-over-period EPS delta
    topCitations,
    promptsData,
    refreshData,
    parseCitations,
    getCitations,
    topCompetitors,
    lastUpdated,
    llmMentionRankings,
    fixExistingPrompts,
    hasDataIssues,
    searchResults,
    searchResultsLoading,
    searchTermsData,
    fetchSearchResults,
    aiThemes: effAiThemes, // Raw AI themes (lazy, Thematic tab) — location-scoped when a location is active
    fetchAIThemes, // Lazy raw-themes fetch (called when Thematic tab mounts)
    attributeThemes: effAttributeThemes, // Pre-aggregated attribute scores — location-scoped when a location is active
    responseSentimentRows, // Per-response sentiment ratios (company_response_sentiment_mv)
    fetchHistoricalResponses, // Fetch responses for a specific time range
    fetchCollectionDates, // Get all collection dates for timeline/comparison
    isOnline, // Network status
    connectionError, // Connection error message
    recencyDataError, // Recency data specific error message
    recencyData, // Export recency data for components
    recencyDataLoading, // Loading state for recency data
    companySentimentMetrics, // Backend-calculated sentiment metrics from materialized view
    companyRelevanceMetrics, // Backend-calculated relevance metrics from materialized view
    companyMetricsLoading, // Loading state for company metrics
    aiThemesLoading, // Loading state for AI themes
    hasMoreResponses, // Whether there are more responses to load
    loadAllHistoricalResponses, // Function to load all historical responses
    metricsCalculating, // Whether metrics are still being calculated (for UX - show all together)
    fetchMVData, // Refresh materialized-view-backed data (sources, competitors, LLM rankings)
    responseTexts,
    responseTextsLoading,
    fetchResponseTexts,
    // Period comparison
    availablePeriods,
    selectedPeriod,
    setSelectedPeriod,
    effectivePeriod,
    previousPeriodMetrics,
    companyRelevanceByMonth,
    previousPeriodResponses,
    // Location filter
    selectedLocation,
    setSelectedLocation,
    setPendingLocation, // Stash a location to apply right after a company switch (sibling-row brands)
    locationOptions, // Merged dropdown options (in-company location_context + sibling-company switches)
    locationMetricsLoading,
    // Brand scope: current company + same-org same-name siblings. Consumers
    // that resolve prompts/companies (e.g. the modal refresh, reports) must
    // scope to this, not the single current company or all userCompanies.
    scopeCompanyIds,
    responsesLoadedCompanyId, // company whose responses are FINAL (loaded/empty/cached)
  };
};
