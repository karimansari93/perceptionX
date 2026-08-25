import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from "@/integrations/supabase/client";
import {
  dashboardKeys,
  fetchScopePrompts,
  fetchScopeRollups,
  fetchScopeStats,
  fetchLocationRollups,
  fetchResponsesFirstPages,
  fetchResponsesRemaining,
  sentimentRowsFromStream,
  type FirstPages,
  type ScopeRollups,
  type ScopeStats,
  type LocationRollups,
} from "@/hooks/dashboard/dashboardQueries";
import {
  selectDailyBuckets,
  selectScopeRows,
  sumScopeRows,
  type StatsSelection,
} from "@/hooks/dashboard/scopeStatsSelect";
import { quarterKeyOfMonthStr } from "@/utils/quarterKey";
import { useAuth } from "@/contexts/AuthContext";
import { useCompany } from "@/contexts/CompanyContext";
import { PromptResponse, DashboardMetrics, CitationCount, PromptData, Citation, CompetitorMention, LLMMentionRanking } from "@/types/dashboard";
import { enhanceCitations, EnhancedCitation } from "@/utils/citationUtils";
import { getLLMDisplayName, getLLMLogo } from "@/config/llmLogos";
import { retrySupabaseQuery, retrySupabaseFunction, queryDebouncer, networkMonitor } from "@/utils/supabaseRetry";
import { parseDetectedCompetitors } from "@/utils/competitorDetection";
import { buildLocationOptions, canonicalizeLocationContext, companyCountryKey, GENERAL_KEY, resolveResponseLocationKey } from "@/utils/locationContext";
import { GLOBAL_LIKE } from "@/utils/locations";
import { LEGACY_ATTRIBUTE_MAP } from "@/config/attributes";
import { readStarredView, stampStarredViewCompany, starredViewAppliesTo } from "@/hooks/useStarredView";
import { sentimentRatioV2, EXCLUDED_AI_MODELS_FILTER } from "@/lib/sentimentV2";

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

  // Methodology v2: headline ratio pools positive/(positive+negative);
  // neutrals stay in the composition counts only.
  const metrics = agg.totalThemes > 0 ? {
    sentiment_ratio: sentimentRatioV2(agg.positiveThemes, agg.negativeThemes),
    avg_sentiment_score: agg.totalWeight > 0 ? agg.totalSentimentScore / agg.totalWeight : 0, // internal only
    total_themes: agg.totalThemes,
    positive_themes: agg.positiveThemes,
    negative_themes: agg.negativeThemes,
    neutral_themes: agg.neutralThemes,
  } : null;

  // Keyed by quarter ("YYYY-Qn"); the MV stays month-grain and quarters pool
  // their months' counts here.
  const byMonthAcc: Record<string, { positive: number; negative: number }> = {};
  rows.forEach(row => {
    if (!row.response_month) return;
    const key = quarterKeyOfMonthStr(String(row.response_month));
    if (!key) return;
    if (!byMonthAcc[key]) byMonthAcc[key] = { positive: 0, negative: 0 };
    byMonthAcc[key].positive += row.positive_themes || 0;
    byMonthAcc[key].negative += row.negative_themes || 0;
  });
  const byMonth: Record<string, number> = {};
  for (const [key, val] of Object.entries(byMonthAcc)) {
    const ratio = sentimentRatioV2(val.positive, val.negative);
    if (ratio !== null) byMonth[key] = ratio;
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

  // Keyed by quarter ("YYYY-Qn") — see aggregateSentimentRows.
  const byMonthAcc: Record<string, { scoreSum: number; weight: number }> = {};
  rows.forEach(row => {
    if (!row.response_month) return;
    const key = quarterKeyOfMonthStr(String(row.response_month));
    if (!key) return;
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
// percentage + counts, optionally scoped to one period (quarter key
// "YYYY-Qn") and one job function ('' = untagged bucket). The MV rows are
// month-grain; a quarter scope pools all its months. Returns null when no
// rows match so callers fall back to raw-response computation (MV empty /
// not yet refreshed) instead of showing a false 0%.
const visibilityFromMvRows = (
  rows: any[],
  periodKey: string | null,
  jobFn: string | null
): { pct: number; total: number; mentioned: number } | null => {
  let total = 0;
  let mentioned = 0;
  for (const r of rows) {
    if (periodKey && quarterKeyOfMonthStr(String(r.response_month)) !== periodKey) continue;
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

// Stable identities for empty derived values, so memo cascades don't re-run
// when a query has no data yet.
const EMPTY_ARRAY: any[] = [];
const EMPTY_OBJECT = Object.freeze({});

// Join slim response rows to their prompts (the stream no longer embeds a
// copy of the prompt in every row — that duplication alone was ~40% of the
// old 73 MB payload) and mirror the historical shaping: rows whose prompt is
// missing are dropped (the old !inner join semantics), and attribute-tagged
// rows get the reformatted duplicate entry the Thematic/Overview attribute
// views consume.
const stitchResponses = (rows: any[], prompts: any[]): PromptResponse[] => {
  const promptById = new Map<string, any>(prompts.map(p => [p.id, p]));
  const base: any[] = [];
  for (const r of rows) {
    const prompt = promptById.get(r.confirmed_prompt_id);
    if (!prompt) continue;
    base.push({ ...r, confirmed_prompts: prompt });
  }

  const attributeRaw = base.filter(r =>
    r.confirmed_prompts?.attribute_id != null &&
    (r.confirmed_prompts?.company_id == null || r.confirmed_prompts.company_id === r.company_id)
  );
  const attributeLatestMap = new Map<string, any>();
  attributeRaw.forEach(response => {
    const key = `${response.confirmed_prompt_id}_${response.ai_model}`;
    if (!attributeLatestMap.has(key)) {
      attributeLatestMap.set(key, response);
    }
  });
  const attributeResponsesFormatted: PromptResponse[] = Array.from(attributeLatestMap.values()).map(response => {
    const promptType = response.confirmed_prompts.prompt_type;
    const attributeId = response.confirmed_prompts.attribute_id || promptType;
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

  return [...base, ...attributeResponsesFormatted];
};

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
  key: string;       // e.g. "2026-Q1"
  label: string;     // e.g. "Q1 2026"
  startDate: Date;
  endDate: Date;
}

// The dashboard period is the QUARTER. Keys are "YYYY-Qn", which sorts
// lexically in chronological order — the prior-period lookups below rely on
// that. Collection stays monthly underneath (response_month / the unique
// per-month response index are untouched); quarters exist only at read time.
export const quarterKeyOfDate = (d: Date): string =>
  `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;

// Quarter key from a "YYYY-MM…" date string (e.g. response_month
// "2026-05-01" → "2026-Q2"). String math on purpose: date-only strings parse
// as UTC midnight, which shifts into the prior month (and possibly quarter)
// in negative-offset timezones.
export { quarterKeyOfMonthStr };

// Canonical period bucket for a response: the quarter containing its snapshot
// month (response_month = collection_cycle, falling back to the write month),
// NOT when the row was physically written (tested_at/created_at). A run
// collected on May 30 but tagged collection_cycle = June must show under
// June's quarter everywhere. tested_at/created_at are only used for legacy
// rows missing response_month.
export const responsePeriodKey = (r: { response_month?: string | null; tested_at?: string; created_at?: string }): string | null => {
  if (r.response_month) return quarterKeyOfMonthStr(String(r.response_month));
  const t = r.tested_at || r.created_at;
  if (!t) return null;
  const d = new Date(t);
  if (isNaN(d.getTime())) return null;
  return quarterKeyOfDate(d);
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
  // v2 attribute ids whose raw themes are fully loaded for the current scope
  // (raw themes accumulate per drilled attribute — see
  // fetchAIThemesForAttribute). The ref mirrors the state so the fetch
  // callback can guard without re-creating itself on every load.
  const [aiThemeAttrsLoaded, setAiThemeAttrsLoaded] = useState<string[]>([]);
  const aiThemeAttrsLoadedRef = useRef<Set<string>>(new Set());
  const aiThemeAttrsInFlightRef = useRef<Set<string>>(new Set());
  const [isOnline, setIsOnline] = useState(networkMonitor.online);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [recencyDataError, setRecencyDataError] = useState<string | null>(null);
  // Location filter (canonical key from confirmed_prompts.location_context, or
  // null for "all locations"). When set, sentiment/relevance are re-scoped from
  // the `_by_location_mv` rollups; responses are filtered in-memory.
  const [selectedLocation, setSelectedLocationState] = useState<string | null>(null);
  // Company whose responses have FULLY loaded (all pages committed, loaded
  // empty, or restored from cache). Distinguishes "no data yet" (selection
  // validity unknowable — don't judge) from "loaded with zero rows" (final —
  // a stale selection must clear).
  const [responsesLoadedCompanyId, setResponsesLoadedCompanyId] = useState<string | null>(null);

  // ---- Query-cached fetch families (TanStack Query) ----
  // Every family is keyed by the brand-scope signature, so anything the user
  // has already seen this session (any company, any country) renders
  // instantly from cache and revalidates in the background when stale. This
  // replaces the per-family fetch effects, the module-global DB slot gate for
  // these paths, and the 5-minute companyDataCacheRef restore machinery.
  const queryClient = useQueryClient();
  const scopeReady = !!user?.id && !!currentCompany?.id && scopeCompanyIds.length > 0;
  const FRESH_MS = 5 * 60 * 1000; // parity with the old per-company cache TTL
  const KEEP_MS = 45 * 60 * 1000;

  const promptsQuery = useQuery({
    queryKey: dashboardKeys.prompts(scopeKey),
    queryFn: ({ signal }) => fetchScopePrompts(scopeCompanyIds, signal),
    enabled: scopeReady,
    staleTime: FRESH_MS,
    gcTime: KEEP_MS,
    refetchOnMount: true,
  });
  const rollupsQuery = useQuery({
    queryKey: dashboardKeys.rollups(scopeKey),
    queryFn: ({ signal }) => fetchScopeRollups(scopeCompanyIds, signal),
    enabled: scopeReady,
    staleTime: FRESH_MS,
    gcTime: KEEP_MS,
    refetchOnMount: true,
  });
  // Phase-3 scope-stats cube (~4 KB/company). Fetched alongside the rollups;
  // consumers switch from raw-row memos to this cube one at a time (each flip
  // verified old-vs-new), so it rides inert until then.
  const scopeStatsQuery = useQuery({
    queryKey: dashboardKeys.scopeStats(scopeKey),
    queryFn: ({ signal }) => fetchScopeStats(scopeCompanyIds, signal),
    enabled: scopeReady,
    staleTime: FRESH_MS,
    gcTime: KEEP_MS,
    refetchOnMount: true,
  });
  const scopeStats: ScopeStats | undefined = scopeStatsQuery.data;
  // Response stream, two stages: the newest page of every profile commits
  // eagerly (tables hydrate fast), then the full keyset walk replaces it.
  // Prompts gate the stream so the critical path gets bandwidth first.
  const firstPagesQuery = useQuery({
    queryKey: dashboardKeys.responsesFirst(scopeKey),
    queryFn: ({ signal }) => fetchResponsesFirstPages(scopeCompanyIds, signal),
    enabled: scopeReady && promptsQuery.data !== undefined,
    staleTime: FRESH_MS,
    gcTime: KEEP_MS,
    refetchOnMount: true,
    // Each page already retries 3 attempts internally (with shrunken retry
    // pages); the default query-level retry (3) on top of that multiplied a
    // failing wide-scope walk into dozens of extra 8-second statement-timeout
    // requests against an already saturated database.
    retry: 1,
  });
  const fullStreamQuery = useQuery({
    queryKey: dashboardKeys.responsesFull(scopeKey),
    queryFn: ({ signal }) => fetchResponsesRemaining(
      scopeCompanyIds,
      queryClient.getQueryData<FirstPages>(dashboardKeys.responsesFirst(scopeKey)),
      signal
    ),
    enabled: scopeReady && firstPagesQuery.data !== undefined,
    staleTime: FRESH_MS,
    gcTime: KEEP_MS,
    refetchOnMount: true,
    retry: 1,
  });
  // ---- Values derived from the cached families. Same names and shapes the
  // rest of the hook (and its consumers) always used. ----
  const activePrompts = promptsQuery.data ?? EMPTY_ARRAY;
  // True only while a scope loads with NOTHING cached — a switch back to an
  // already-seen scope paints instantly while revalidation runs silently.
  const loading = scopeReady && promptsQuery.isLoading;
  const competitorLoading = loading;
  // Downstream memos gate on this while a NEW scope's first load is in
  // flight; cached switch-backs never raise it, so they compute immediately.
  const isSwitchingCompany = loading;
  const companyMetricsLoading = scopeReady && rollupsQuery.isLoading;
  // Same signal: visibility rows arrive with the rollups call.
  const visibilityMvLoading = scopeReady && rollupsQuery.isLoading;

  const rollups: ScopeRollups | undefined = rollupsQuery.data;
  const sentimentMvRows = rollups?.sentiment ?? EMPTY_ARRAY;
  const relevanceMvRows = rollups?.relevance ?? EMPTY_ARRAY;
  const visibilityMvRows = rollups?.visibility ?? EMPTY_ARRAY;
  const mvLocationBuckets = useMemo(
    () => (rollups?.location_buckets ?? []).map(b => b ?? ''),
    [rollups]
  );
  const attributeThemes = useMemo(
    () => aggregateAttributeThemeRows(rollups?.attribute_themes ?? []),
    [rollups]
  );
  // Per-response sentiment rides along on the streamed rows (RPC join) — no
  // separate fetch family. Old shape preserved for every consumer.
  const responseSentimentRows = useMemo(() => {
    const rows = (fullStreamQuery.data ?? firstPagesQuery.data)?.rows;
    return rows && rows.length > 0 ? sentimentRowsFromStream(rows) : EMPTY_ARRAY;
  }, [fullStreamQuery.data, firstPagesQuery.data]);

  const companyMetricsAgg = useMemo(() => ({
    sentiment: aggregateSentimentRows(sentimentMvRows),
    relevance: aggregateRelevanceRows(relevanceMvRows),
  }), [sentimentMvRows, relevanceMvRows]);
  const companySentimentMetrics = companyMetricsAgg.sentiment.metrics;
  const companyRelevanceMetrics = companyMetricsAgg.relevance.metrics;
  const companySentimentByMonth = companyMetricsAgg.sentiment.byMonth;
  const companyRelevanceByMonth = companyMetricsAgg.relevance.byMonth;

  const mvTopCitations: CitationCount[] = useMemo(() =>
    Object.entries(sumRowsBy(rollups?.top_sources ?? [], 'domain', 'citation_count'))
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30),
    [rollups]
  );
  const mvTopCompetitors = useMemo(() =>
    Object.entries(sumRowsBy(rollups?.competitors ?? [], 'competitor_name', 'mention_count'))
      .map(([company, count]) => ({ company, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30),
    [rollups]
  );
  const mvLlmRankings: LLMMentionRanking[] = useMemo(() =>
    Object.entries(sumRowsBy(rollups?.llm_rankings ?? [], 'ai_model', 'mentions'))
      .map(([model, mentions]) => ({
        model,
        displayName: getLLMDisplayName(model),
        mentions,
        logoUrl: getLLMLogo(model),
      }))
      .sort((a, b) => b.mentions - a.mentions),
    [rollups]
  );

  // Public location setter. Location loading is derived from the location
  // query below, so a cached location renders on the same tick — no eager
  // flag needed.
  const setSelectedLocation = setSelectedLocationState;
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
        if (user?.id && currentCompany?.id && wasOffline && !document.hidden && responses.length === 0) {
          // Data never arrived while offline — refetch the scope fresh.
          queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
        }
      } else {
        setConnectionError('No internet connection. Please check your network.');
      }
    });

    return removeListener;
  }, [user?.id, currentCompany?.id, responses.length]); // Only IDs and responses length

  // ---- Response stream → state sync ----
  // `responses` stays as state (loadAllHistoricalResponses appends to it);
  // it is synced from the cached stream queries: first pages commit eagerly,
  // the full keyset walk replaces them, and a scope with nothing cached yet
  // clears so the previous company's rows never render under the new header.
  const streamData = fullStreamQuery.data ?? firstPagesQuery.data;
  useEffect(() => {
    if (!scopeReady) return;
    const prompts = promptsQuery.data;
    if (prompts === undefined || streamData === undefined) {
      setResponses([]);
      setResponsesLoadedCompanyId(null);
      setLastUpdated(undefined);
      return;
    }
    const stitched = stitchResponses(streamData.rows, prompts);
    setResponses(stitched);
    if (stitched.length > 0) {
      const newest = stitched[0];
      setLastUpdated(new Date(newest.tested_at || newest.updated_at || newest.created_at));
    } else {
      setLastUpdated(undefined);
    }
    // Final only when every profile streamed to its last page — the location
    // reconcile effect must not judge selection validity before that.
    setResponsesLoadedCompanyId(
      streamData.complete && currentCompany?.id ? currentCompany.id : null
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeReady, promptsQuery.data, streamData, scopeKey, currentCompany?.id]);

  // The full-screen "Connection Issue" swap is reserved for the critical
  // path failing with nothing cached to render (contract #3: never blank
  // rendered content). The response stream is background hydration
  // (contract #4): its failures log and leave the rollup-rendered dashboard
  // on screen — during the 2026-08-25 statement-timeout incident, a single
  // background page 500 was replacing an otherwise-loaded Overview tab with
  // the error screen.
  const criticalError: any =
    (promptsQuery.data === undefined && promptsQuery.error) ||
    (rollupsQuery.data === undefined && rollupsQuery.error) ||
    null;
  const backgroundError: any = firstPagesQuery.error || fullStreamQuery.error;
  useEffect(() => {
    if (backgroundError) {
      console.error('Error loading dashboard response stream (background):', backgroundError);
    }
  }, [backgroundError]);
  useEffect(() => {
    if (!criticalError) {
      setConnectionError(null);
      return;
    }
    console.error('Error loading dashboard data:', criticalError);
    const msg = String(criticalError?.message ?? '');
    if (msg.includes('permission') || msg.includes('policy')) {
      setConnectionError("Permission denied. Please ensure you have access to this company's data.");
    } else if (msg.includes('timeout')) {
      setConnectionError('Request timed out. The server may be busy. Please try again in a moment.');
    } else if (msg.includes('network') || msg.includes('fetch')) {
      setConnectionError('Network error. Please check your internet connection and try again.');
    } else {
      setConnectionError('Unable to load data. Please refresh the page or try again later.');
    }
  }, [criticalError]);

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

  // Kept API: consumers call this to refresh MV-backed data after
  // admin-side changes. Invalidation revalidates in the background — content
  // stays on screen.
  const fetchMVData = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: dashboardKeys.rollups(scopeKey) });
  }, [queryClient, scopeKey]);

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

  // Lazy per-attribute raw-themes fetch for the Thematic drilldown. The tab's
  // main ranking is MV-driven; only the per-attribute drilldown needs raw
  // rows (subtheme names, response links for quotes/sources/visibility). The
  // old design bulk-paginated the whole 180-day window on tab mount — ~130
  // requests / ~130k rows in browser memory on an 18-profile brand — for data
  // the user might never drill into. A subtheme-level rollup was measured and
  // rejected: LLM-generated theme names are ~75% unique (Ford US: 18,640 raw
  // rows → 14,017 distinct names), so a (theme_name, month, fn) grain barely
  // compresses. Fetching one attribute on drilldown open (~1-3 pages per
  // scope profile via the indexed RPC) is the real win.
  //
  // Rows ACCUMULATE across drilled attributes (merge replaces per attribute,
  // so re-fetch after an explicit refresh can't duplicate). aiThemeAttrsLoaded
  // tracks completed v2 attribute ids; consumers that opportunistically scan
  // aiThemes (OverviewTab insights) therefore see partial-by-attribute data —
  // same class of partiality as the old "empty until the Thematic tab was
  // visited" behavior, but never partial WITHIN an attribute.
  const fetchAIThemesForAttribute = useCallback(async (attributeId: string) => {
    if (!user || !currentCompany?.id || !attributeId) return;
    if (aiThemeAttrsLoadedRef.current.has(attributeId)) return;
    if (aiThemeAttrsInFlightRef.current.has(attributeId)) return;

    // requestedCompanyId pins this call to the company that triggered it;
    // anything not matching the live ref at commit time is discarded so it
    // can't overwrite the new company's themes.
    const requestedCompanyId = currentCompany.id;
    const isStale = () => currentCompanyIdRef.current !== requestedCompanyId;
    const requestedScopeIds = scopeCompanyIds.length > 0 ? scopeCompanyIds : [requestedCompanyId];

    // Stored rows carry either the v2 id or a legacy v1 id that folds into
    // it (normalizeAttributeId) — filter server-side on the whole family.
    const rawIds = [
      attributeId,
      ...Object.entries(LEGACY_ATTRIBUTE_MAP)
        .filter(([, v2]) => v2 === attributeId)
        .map(([legacy]) => legacy),
    ];

    aiThemeAttrsInFlightRef.current.add(attributeId);
    try {
      setAiThemesLoading(true);

      // Bound by 180 days. Served by idx_ai_themes_company_created_id
      // (company_id, created_at DESC, id DESC): an index range scan, no sort.
      const AI_THEMES_DAYS = 180;
      const aiThemesCutoffIso = new Date(Date.now() - AI_THEMES_DAYS * 24 * 60 * 60 * 1000).toISOString();

      const PAGE_SIZE = 1000;

      // Keyset pagination on (created_at DESC, id DESC), via the
      // ai_themes_keyset_page RPC instead of a PostgREST table read. The RPC
      // exists for two measured reasons (2026-07, 18-profile Ford brand):
      // - PostgREST can only express the cursor as
      //   or=(created_at.lt.X,and(created_at.eq.X,id.lt.Y)), which Postgres
      //   cannot use as a btree boundary — every page re-scanned all
      //   previously-fetched rows and filtered them out (page N read N×1000
      //   rows, so deep pages crossed the ~8s statement timeout). The RPC's
      //   row-value comparison (created_at, id) < (X, Y) is an exact index
      //   boundary, keeping every page O(PAGE_SIZE) regardless of depth.
      // - The ai_themes RLS policy called user_can_access_company() per
      //   scanned row (~1.6s per 1000-row page on its own). The RPC is
      //   SECURITY DEFINER and makes the identical access check once per
      //   page. Worst-case page: ~8s before, ~8ms after.
      // The RPC returns only the columns the themes/attributes UIs consume —
      // skips heavy theme_description / context_snippets[] / keywords[].
      // One pagination PER scope company (merged after): keeps every page on
      // the (company_id, created_at, id) index instead of a cross-company merge.
      const fetchThemesForCompany = async (companyId: string): Promise<any[]> => {
        let all: any[] = [];
        let cursor: { created_at: string; id: string } | null = null;
        // Hard cap to avoid an unbounded loop if data is pathological.
        for (let guard = 0; guard < 200; guard += 1) {
          // bulk: drilldown pages must never jump ahead of queued critical
          // first-paint fetches in the gate. (Post-RPC this family is a
          // handful of ~10ms pages per drilled attribute, not the ~90-query
          // stream that once starved the prompts fetch — bulk is now just
          // politeness, not survival.)
          const { data, error } = (await withDbSlot(() => retrySupabaseQuery(() =>
            (supabase as any).rpc('ai_themes_keyset_page', {
              p_company_id: companyId,
              p_cutoff: aiThemesCutoffIso,
              p_cursor_created_at: cursor?.created_at ?? null,
              p_cursor_id: cursor?.id ?? null,
              p_limit: PAGE_SIZE,
              p_attribute_ids: rawIds,
            })
          ) as Promise<{
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
      const rawIdSet = new Set(rawIds);
      setAiThemes(prev => [
        ...prev.filter(t => !rawIdSet.has(t.attribute_id)),
        ...perCompanyThemes.flat(),
      ]);
      aiThemeAttrsLoadedRef.current.add(attributeId);
      setAiThemeAttrsLoaded(prev => (prev.includes(attributeId) ? prev : [...prev, attributeId]));
    } catch (error) {
      if (isStale()) return;
      // Leave the loaded flag unset so reopening the drilldown retries.
      console.error('Error in fetchAIThemesForAttribute:', error);
    } finally {
      aiThemeAttrsInFlightRef.current.delete(attributeId);
      // Don't flip the loading flag off while another attribute's fetch is
      // still in flight — it owns the spinner now.
      if (!isStale() && aiThemeAttrsInFlightRef.current.size === 0) {
        setAiThemesLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, currentCompany?.id, scopeKey]);

  // Accumulated raw themes only cover the scope they were fetched for — a
  // scope change (sibling profiles resolving after companies load) must
  // invalidate them so drilldowns refetch at the new scope. Also fires on
  // company switches (scopeKey changes with the company); the company-change
  // effect clears the same state, so that's a harmless double-clear.
  useEffect(() => {
    setAiThemes([]);
    setAiThemeAttrsLoaded([]);
    aiThemeAttrsLoadedRef.current = new Set();
  }, [scopeKey]);

  // Pre-aggregated attribute scores from company_attribute_themes_mv. A few
  // hundred rows per company (16 attributes x months x job functions) instead
  // of the tens of thousands of raw theme rows the dashboard used to pull.

  // Per-response sentiment ratios from company_response_sentiment_mv. Feeds the
  // sentiment cache (trend chart, trend arrows, per-prompt sentiment) without
  // shipping raw theme rows.

  // Memoized cache of sentiment calculations per response ID
  // OPTIMIZED: Only recalculates when themes change, not on every render
  // This prevents expensive calculations on every render
  const [sentimentCacheState, setSentimentCacheState] = useState<Map<string, { sentiment_score: number | null; sentiment_label: string; positive: number; negative: number }>>(new Map());

  // Build the per-response sentiment cache from the pre-aggregated MV
  // (company_response_sentiment_mv) instead of scanning raw ai_themes.
  // Methodology v2: the MV ratio is positive/(positive+negative); null means
  // the response had themes but none polarized ("no signal"). The counts ride
  // along so per-prompt sentiment can pool them with the same formula.
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

    const cache = new Map<string, { sentiment_score: number | null; sentiment_label: string; positive: number; negative: number }>();
    responseSentimentRows.forEach(row => {
      if (scopeToResponses && !companyResponseIds.has(row.response_id)) return;
      const positive = Number(row.positive_themes) || 0;
      const negative = Number(row.negative_themes) || 0;
      const ratio = row.sentiment_ratio === null || row.sentiment_ratio === undefined
        ? sentimentRatioV2(positive, negative)
        : (typeof row.sentiment_ratio === 'number' ? row.sentiment_ratio : Number(row.sentiment_ratio));
      const sentimentLabel = ratio === null ? 'neutral' : ratio > 0.6 ? 'positive' : ratio < 0.4 ? 'negative' : 'neutral';
      cache.set(row.response_id, { sentiment_score: ratio, sentiment_label: sentimentLabel, positive, negative });
    });

    setSentimentCacheState(cache);
  }, [responseSentimentRows, responses]);

  // Use state-based cache instead of useMemo (prevents recalculation on every render)
  const sentimentCache = sentimentCacheState;

  // Helper function to calculate AI-based sentiment for a response
  // Uses the state-based cache for O(1) lookup (calculated only when themes change)
  // sentiment_score === null means "no polarized themes" — callers averaging
  // scores must skip those entries rather than counting them as 0.
  const calculateAIBasedSentiment = useCallback((responseId: string) => {
    // Check cache first
    const cached = sentimentCacheState.get(responseId);
    if (cached) {
      return cached;
    }

    // No AI themes available for this response - no sentiment signal
    return {
      sentiment_score: null as number | null,
      sentiment_label: 'neutral',
      positive: 0,
      negative: 0
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
  // On company switch, reset only the NON-query state (drilldown caches,
  // search, recency). Query-backed families switch by key: cached scopes
  // restore instantly, uncached ones load fresh — no manual snapshot/restore.
  useEffect(() => {
    if (currentCompany?.id !== currentCompanyIdRef.current && currentCompany?.id !== undefined) {
      currentCompanyIdRef.current = currentCompany?.id;
      setResponseTexts({});
      setAiThemes([]);
      setAiThemeAttrsLoaded([]);
      aiThemeAttrsLoadedRef.current = new Set();
      setAiThemesLoading(false);
      setSearchResults([]);
      setSearchTermsData([]);
      setRecencyData([]);
      searchResultsCache.current = { companyId: null, timestamp: 0, data: [] };
      recencyDataCacheRef.current = null;
    }
  }, [currentCompany?.id]);

  useEffect(() => {
    setCompanyName(currentCompany?.name ?? '');
  }, [currentCompany?.id, currentCompany?.name]);

  // Reset pagination when company changes
  useEffect(() => {
    setLoadAllResponses(false);
    setHasMoreResponses(false);
  }, [currentCompany?.id]);


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

  // Raw-theme drilldown state only exists per company — clear when signed
  // out / no company. (Attribute scores + per-response sentiment are
  // query-backed now.)
  useEffect(() => {
    if (!user || !currentCompany?.id) {
      setAiThemes([]);
      setAiThemeAttrsLoaded([]);
      aiThemeAttrsLoadedRef.current = new Set();
      setAiThemesLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, currentCompany?.id]);



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
    recencyDataCacheRef.current = null;
    previousResponseIdsRef.current = '';
    setAiThemes([]);
    setAiThemeAttrsLoaded([]);
    aiThemeAttrsLoadedRef.current = new Set();
    await queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
  }, [queryClient]);

  // Function to load all historical responses (for complete trend analysis)
  const loadAllHistoricalResponses = useCallback(async () => {
    setLoadAllResponses(true);
    await queryClient.invalidateQueries({ queryKey: dashboardKeys.responsesFull(scopeKey) });
  }, [queryClient, scopeKey]);

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

  // --- Period detection: group responses by the QUARTER of their snapshot
  // month (response_month), so a run tagged for a given collection cycle
  // shows under that cycle's quarter regardless of when it was physically
  // written. Built from the LOCATION-FILTERED responses: with a location
  // active, the period dropdown used to offer periods with zero in-location
  // data, whose selection produced a mixed-scope scorecard (0% visibility
  // next to aggregate sentiment). ---
  const availablePeriods: PeriodInfo[] = useMemo(() => {
    const periodSet = new Set<string>();
    visibleResponses.forEach(r => {
      const key = responsePeriodKey(r);
      if (key) periodSet.add(key);
    });
    // Raw responses stream in AFTER first paint now, so until this company's
    // stream has fully landed, widen the period set from the visibility
    // rollup (already scoped to the active location by the same attribution
    // rule), clamped to the eager response window so the interim list covers
    // the same quarters the raw set will. Once the load is FINAL the fallback
    // stops contributing and periods derive from responses alone — exactly
    // the pre-streaming behavior (never offering a period whose in-location
    // raw data doesn't exist, which produced mixed-scope scorecards).
    if (responsesLoadedCompanyId !== currentCompany?.id) {
      const cutoff = new Date(Date.now() - EAGER_DAYS * 24 * 60 * 60 * 1000);
      // Clamp at MONTH grain before mapping to a quarter: a quarter-grain
      // cutoff would admit MV months up to two months older than the eager
      // raw window (cutoff Feb 11 → "2026-Q1" would let January in), briefly
      // offering a period whose raw data will never arrive.
      const cutoffMonthKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`;
      visibilityRowsForSelection.forEach(row => {
        if (!row.response_month) return;
        const monthKey = String(row.response_month).slice(0, 7);
        if (monthKey < cutoffMonthKey) return;
        const key = quarterKeyOfMonthStr(monthKey);
        if (key) periodSet.add(key);
      });
    }
    if (periodSet.size === 0) return [];
    const periods: PeriodInfo[] = Array.from(periodSet)
      .map((key) => {
        const y = Number(key.slice(0, 4));
        const q = Number(key.slice(6));
        const startDate = new Date(y, (q - 1) * 3, 1);
        const endDate = new Date(y, (q - 1) * 3 + 3, 0, 23, 59, 59, 999);
        const label = `Q${q} ${y}`;
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

  // Location rollups: ONE cached RPC per (scope, location) replaces the
  // 6-family × N-company × pages fan-out that ran on every country switch
  // (measured: 119 REST round-trips, re-paid on every revisit). Cached
  // locations render on the same tick; uncached ones fetch once per scope.
  const isGeneralSelection = selectedLocation === GENERAL_KEY;
  // Server-side bucket narrowing for owned profiles: the buckets that can
  // possibly match are the untagged ones ('' + GLOBAL-like sentinels) plus
  // the selection's spellings.
  const ownedBucketList = useMemo(() => (
    isGeneralSelection
      ? ['', ...GLOBAL_LIKE]
      : Array.from(new Set(['', ...GLOBAL_LIKE, ...selectedRawValues]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [isGeneralSelection, selectedRawKey]);
  const otherCompanyIds = useMemo(() => {
    const ownedSet = new Set(selectedOwnedCompanyIds);
    return scopeCompanyIds.filter(id => !ownedSet.has(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOwnedKey, scopeKey]);

  const locationQueryEnabled = scopeReady && !!selectedLocation && locSelectionFetchable;
  const locRollupsQuery = useQuery({
    queryKey: dashboardKeys.locationRollups(scopeKey, selectedLocation ?? ''),
    queryFn: ({ signal }) => fetchLocationRollups({
      ownedIds: selectedOwnedCompanyIds,
      ownedBuckets: ownedBucketList,
      otherIds: isGeneralSelection ? [] : otherCompanyIds,
      otherBuckets: isGeneralSelection ? [] : selectedRawValues,
    }, signal),
    enabled: locationQueryEnabled,
    staleTime: FRESH_MS,
    gcTime: KEEP_MS,
    refetchOnMount: true,
  });

  // Raw spellings can widen while the response stream lands. The query key
  // deliberately excludes them (identical selections must share the cache);
  // widening invalidates instead — a background revalidation, not the old
  // content → skeleton → content flash.
  // Signatures are tracked PER (scope, location) key: comparing across
  // different locations would read a location change itself as a widening and
  // spuriously invalidate a warm cache entry on every revisit.
  const locInputsSigRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (!locationQueryEnabled || !selectedLocation) return;
    const mapKey = `${scopeKey}::${selectedLocation}`;
    const sig = `${selectedRawKey}::${selectedOwnedKey}`;
    const prev = locInputsSigRef.current.get(mapKey);
    if (prev !== undefined && prev !== sig) {
      queryClient.invalidateQueries({
        queryKey: dashboardKeys.locationRollups(scopeKey, selectedLocation),
      });
    }
    locInputsSigRef.current.set(mapKey, sig);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationQueryEnabled, selectedLocation, selectedRawKey, selectedOwnedKey, scopeKey]);

  // Bucket-level mirror of resolveResponseLocationKey. The other-arm rows'
  // buckets are the selection's spellings (they canonicalize to the selection
  // by construction), so one filter serves the merged owned+other rows with
  // the same outcome as the old per-arm filtering.
  const locRollupsFiltered: LocationRollups | null = useMemo(() => {
    const data = locRollupsQuery.data;
    if (!data || !selectedLocation) return null;
    const matches = (bucket: string | null | undefined) => {
      const key = canonicalizeLocationContext(bucket);
      return isGeneralSelection ? key === null : (key === null || key === selectedLocation);
    };
    return {
      sentiment: data.sentiment.filter(r => matches(r.location_context)),
      relevance: data.relevance.filter(r => matches(r.location_context)),
      top_sources: data.top_sources.filter(r => matches(r.location_context)),
      competitors: data.competitors.filter(r => matches(r.location_context)),
      llm_rankings: data.llm_rankings.filter(r => matches(r.location_context)),
      attribute_themes: data.attribute_themes.filter(r => matches(r.location_context)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locRollupsQuery.data, selectedLocation, isGeneralSelection]);

  const locAgg = useMemo(() => ({
    sentiment: aggregateSentimentRows(locRollupsFiltered?.sentiment ?? []),
    relevance: aggregateRelevanceRows(locRollupsFiltered?.relevance ?? []),
  }), [locRollupsFiltered]);
  const locSentimentMetrics = locRollupsFiltered ? locAgg.sentiment.metrics : null;
  const locRelevanceMetrics = locRollupsFiltered ? locAgg.relevance.metrics : null;
  const locSentimentByMonth = locRollupsFiltered ? locAgg.sentiment.byMonth : (EMPTY_OBJECT as Record<string, number>);
  const locRelevanceByMonth = locRollupsFiltered ? locAgg.relevance.byMonth : (EMPTY_OBJECT as Record<string, number>);
  const locSentimentMvRows = locRollupsFiltered?.sentiment ?? EMPTY_ARRAY;
  const locRelevanceMvRows = locRollupsFiltered?.relevance ?? EMPTY_ARRAY;
  // A location can span several raw spellings and several companies — sum
  // each domain/competitor/model across the returned buckets, then sort,
  // mirroring the company-wide shaping.
  const locMvTopCitations: CitationCount[] = useMemo(() =>
    Object.entries(sumRowsBy(locRollupsFiltered?.top_sources ?? [], 'domain', 'citation_count'))
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30),
    [locRollupsFiltered]
  );
  const locMvTopCompetitors = useMemo(() =>
    Object.entries(sumRowsBy(locRollupsFiltered?.competitors ?? [], 'competitor_name', 'mention_count'))
      .map(([company, count]) => ({ company, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30),
    [locRollupsFiltered]
  );
  const locMvLlmRankings: LLMMentionRanking[] = useMemo(() =>
    Object.entries(sumRowsBy(locRollupsFiltered?.llm_rankings ?? [], 'ai_model', 'mentions'))
      .map(([model, mentions]) => ({
        model,
        displayName: getLLMDisplayName(model),
        mentions,
        logoUrl: getLLMLogo(model),
      }))
      .sort((a, b) => b.mentions - a.mentions),
    [locRollupsFiltered]
  );
  const locAttributeThemes = useMemo(
    () => aggregateAttributeThemeRows(locRollupsFiltered?.attribute_themes ?? []),
    [locRollupsFiltered]
  );

  // Location loading, derived: a resolvable selection is loading only while
  // its query has no data yet (cache hits never show a skeleton); a
  // not-yet-resolvable selection (pending/starred mid-switch) holds its
  // skeleton until this scope's stream is final — release-effect parity.
  const locationMetricsLoading = !!selectedLocation && (
    locationQueryEnabled
      ? locRollupsQuery.isPending
      : responsesLoadedCompanyId !== currentCompany?.id
  );

  // Intent prefetch: called on dropdown open/hover so a target's rollups are
  // already cached before the click. prefetchQuery respects staleTime — an
  // already-fresh key is a no-op.
  const prefetchLocationRollups = useCallback((locKey: string | null) => {
    if (!locKey || !scopeReady || locKey === selectedLocation) return;
    const isGeneral = locKey === GENERAL_KEY;
    const rawValues = isGeneral ? [] : (locationRawValues[locKey] || []);
    const entry = locationOptions.find(o => o.canonicalKey === locKey);
    const ownedIds = isGeneral
      ? scopeCompanies.filter(c => companyCountryKey(c.country) === null).map(c => c.id)
      : (entry?.companyIds ?? []);
    if (rawValues.length === 0 && ownedIds.length === 0) return;
    const ownedSet = new Set(ownedIds);
    const otherIds = isGeneral ? [] : scopeCompanyIds.filter(id => !ownedSet.has(id));
    const ownedBuckets = isGeneral ? ['', ...GLOBAL_LIKE] : Array.from(new Set(['', ...GLOBAL_LIKE, ...rawValues]));
    queryClient.prefetchQuery({
      queryKey: dashboardKeys.locationRollups(scopeKey, locKey),
      queryFn: ({ signal }) => fetchLocationRollups(
        { ownedIds, ownedBuckets, otherIds, otherBuckets: isGeneral ? [] : rawValues },
        signal
      ),
      staleTime: FRESH_MS,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeReady, selectedLocation, locationRawValues, locationOptions, scopeCompanies, scopeKey, queryClient]);

  // Prefetch another company's scope rollups + prompts on hover/open, so the
  // headline numbers are cached before the switch lands.
  const prefetchCompanyRollups = useCallback((companyId: string) => {
    const target = userCompanies.find(c => c.id === companyId);
    if (!target || companyId === currentCompany?.id) return;
    const nameLower = target.name.toLowerCase();
    const orgId = target.organization_id ?? null;
    const ids = userCompanies
      .filter(c => c.name.toLowerCase() === nameLower && (c.organization_id ?? null) === orgId)
      .map(c => c.id);
    const scope = ids.length > 0 ? ids : [companyId];
    const key = [...scope].sort().join(',');
    queryClient.prefetchQuery({
      queryKey: dashboardKeys.rollups(key),
      queryFn: ({ signal }) => fetchScopeRollups(scope, signal),
      staleTime: FRESH_MS,
    });
    queryClient.prefetchQuery({
      queryKey: dashboardKeys.prompts(key),
      queryFn: ({ signal }) => fetchScopePrompts(scope, signal),
      staleTime: FRESH_MS,
    });
    // The stats cube is part of the headline paint now — warm it with the
    // rollups (found via E2E: hover prefetched rollups+prompts but the
    // switch still had to fetch stats).
    queryClient.prefetchQuery({
      queryKey: dashboardKeys.scopeStats(key),
      queryFn: ({ signal }) => fetchScopeStats(scope, signal),
      staleTime: FRESH_MS,
    });
  }, [userCompanies, currentCompany?.id, queryClient]);

  // Hydration stages for the branded first-load screen: which fetch families
  // have landed, derived synchronously from query data so cached scopes read
  // complete on their very first render (no loader flash on switch-back).
  // A fetch error counts as complete so the loader can hand off to the
  // connection-error state instead of hanging.
  const hydration = useMemo(() => {
    const errored = !!(promptsQuery.error || rollupsQuery.error || firstPagesQuery.error || fullStreamQuery.error);
    const prompts = !scopeReady || errored || promptsQuery.data !== undefined;
    const rollupsDone = !scopeReady || errored || rollupsQuery.data !== undefined;
    const responsesFirst = !scopeReady || errored || firstPagesQuery.data !== undefined;
    const responsesFull = !scopeReady || errored || fullStreamQuery.data !== undefined;
    return {
      prompts,
      rollups: rollupsDone,
      responsesFirst,
      responsesFull,
      complete: prompts && rollupsDone && responsesFirst && responsesFull,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeReady, promptsQuery.data, rollupsQuery.data, firstPagesQuery.data, fullStreamQuery.data,
      promptsQuery.error, rollupsQuery.error, firstPagesQuery.error, fullStreamQuery.error]);

  // True while any dashboard family revalidates in the background with data
  // already on screen — consumers show a subtle indicator, never a skeleton.
  const isRefreshing = (
    (promptsQuery.isFetching && promptsQuery.data !== undefined) ||
    (rollupsQuery.isFetching && rollupsQuery.data !== undefined) ||
    (fullStreamQuery.isFetching && fullStreamQuery.data !== undefined) ||
    (locRollupsQuery.isFetching && locRollupsQuery.data !== undefined)
  );

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

  // Previous period (quarter before the effective one)
  const previousPeriodInfo = useMemo(() => {
    if (!effectivePeriod || availablePeriods.length < 2) return null;
    const idx = availablePeriods.findIndex(p => p.key === effectivePeriod.key);
    return idx >= 0 && idx + 1 < availablePeriods.length ? availablePeriods[idx + 1] : null;
  }, [availablePeriods, effectivePeriod]);

  // Filter responses to the selected period (by snapshot quarter).
  const periodFilteredResponses = useMemo(() => {
    if (!effectivePeriod || availablePeriods.length <= 1) return visibleResponses;
    return visibleResponses.filter(r => responsePeriodKey(r) === effectivePeriod.key);
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
    return visibleResponses.filter(r => responsePeriodKey(r) === previousPeriodInfo.key);
  }, [visibleResponses, previousPeriodInfo]);

  // Previous-period metrics for delta display.
  //
  // Each metric independently finds the MOST RECENT PRIOR QUARTER that
  // actually has data from its own source. A company with data in Q1 + Q3
  // but no Q2 should compare Q3 to Q1 for sentiment — skipping the gap —
  // rather than compare against a fake 0.
  //
  // Sources (each independent):
  //   - sentiment: companySentimentByMonth (MV-backed)
  //   - relevance: companyRelevanceByMonth (MV-backed)
  //   - visibility: response counts in availablePeriods (response-backed)
  //
  // If no prior quarter with data exists for a given metric, that field is
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

    // Helper: given a map keyed on "YYYY-Qn", find the most recent key
    // lexically less than currentKey that has a numeric value.
    const findMostRecentPrior = (map: Record<string, number>): number | undefined => {
      const priorKeys = Object.keys(map)
        .filter((k) => k < currentKey && typeof map[k] === 'number')
        .sort(); // lex sort works for YYYY-Qn
      if (priorKeys.length === 0) return undefined;
      return map[priorKeys[priorKeys.length - 1]];
    };

    // Sentiment — most recent prior quarter in the sentiment MV.
    const prevSentimentRatio = findMostRecentPrior(effSentimentByMonth);
    const sentimentScore = typeof prevSentimentRatio === 'number'
      ? Math.round(Math.max(0, Math.min(100, prevSentimentRatio * 100)))
      : undefined;

    // Relevance — most recent prior quarter in the relevance MV.
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
      // precomputed rollup for the prior quarter; fall back to counting loaded
      // responses bucketed by snapshot month (responsePeriodKey).
      const chosen = priorAvailable[0];
      const mvPrior = visibilityFromMvRows(visibilityRowsForSelection, chosen.key, null);
      if (mvPrior) {
        visibilityScore = Math.round(mvPrior.pct);
      } else {
        const chosenResponses = visibleResponses.filter((r) => responsePeriodKey(r) === chosen.key);
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
        // Methodology v2: pool positive/negative counts across the prompt's
        // responses, then take positive/(positive+negative).
        (existing as any)._pos = ((existing as any)._pos || 0) + aiSentiment.positive;
        (existing as any)._neg = ((existing as any)._neg || 0) + aiSentiment.negative;
        existing.avgSentiment = sentimentRatioV2((existing as any)._pos, (existing as any)._neg) ?? 0;
        existing.sentimentLabel = existing.avgSentiment > 0.6 ? 'positive' : ((existing as any)._pos + (existing as any)._neg) > 0 && existing.avgSentiment < 0.4 ? 'negative' : 'neutral';
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
          avgSentiment: aiSentiment.sentiment_score ?? 0,
          sentimentLabel: aiSentiment.sentiment_label,
          ...({ _pos: aiSentiment.positive, _neg: aiSentiment.negative } as any),
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

    // Phase-3 scope-stats cube for the active selection. Additive measures
    // (citation totals, day-grain trend inputs) come from here when the cube
    // has landed; the raw-row math below stays as the fallback for scopes
    // awaiting their first stats refresh. The cube covers all time (not just
    // the eager stream window) and counts each response once (the raw path
    // double-counts stitched attribute rows) — both deliberate corrections.
    const statsSel: StatsSelection = {
      locationKey: selectedLocation && selectedLocationEntry ? selectedLocation : null,
      countryKeyByCompanyId,
      // Mirror periodFilteredResponses' single-period bypass exactly: with one
      // (or zero) available periods the raw path returns ALL visible rows, so
      // the cube must not quarter-filter either.
      quarterKey: (effectivePeriod && availablePeriods.length > 1) ? (effectivePeriodKey ?? null) : null,
    };
    const cubeScopeSelected = scopeStats ? selectScopeRows(scopeStats.scope, statsSel) : [];
    const cubeTotals = sumScopeRows(cubeScopeSelected);
    // The cube is trustworthy only when every company contributing raw rows
    // has cube rows too — a freshly added sibling profile streams responses
    // before its first stats refresh, and a scope-global gate would silently
    // compute mixed-scope numbers from the other profiles' cube rows.
    const cubeCompanyIds = new Set((scopeStats?.scope ?? []).map(r => r.company_id));
    const rawCompaniesCovered = responses.every(r => r.company_id == null || cubeCompanyIds.has(r.company_id));
    const scopeCubeReady = !!scopeStats && scopeStats.scope.length > 0 && rawCompaniesCovered;
    const dailySelection = scopeStats ? selectDailyBuckets(scopeStats.daily, statsSel) : null;
    // Period filtering over day rows needs the response_month column; until a
    // company's daily rows carry it (post-migration refresh), period-scoped
    // day math is unsound — fall back to raw rows.
    const dailyCubeReady = scopeCubeReady && dailySelection !== null &&
      !(statsSel.quarterKey && dailySelection.hasUnrefreshedRows);

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
      // No specific period — use all-months aggregate from MV.
      // (v2 ratio is null when no polarized themes exist; counts below are
      // all-neutral in that case so 0 here can't read as "fully negative".)
      averageSentiment = effSentimentMetrics.sentiment_ratio ?? 0;
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
    
    if (dailyCubeReady && dailySelection!.buckets.length > 1) {
      // Cube path: latest collection day vs all earlier days, same formulas
      // and thresholds as the raw path below. Day identity is the UTC date of
      // tested_at (the raw path used the viewer's local date — near-midnight
      // runs can shift a day, an accepted normalization).
      const buckets = dailySelection!.buckets;
      const latest = buckets[buckets.length - 1];
      const previous = buckets.slice(0, -1);
      const prevAgg = previous.reduce(
        (a, b) => ({
          pos: a.pos + b.positiveThemes,
          neg: a.neg + b.negativeThemes,
          total: a.total + b.totalResponses,
          mentioned: a.mentioned + b.mentionedResponses,
          citations: a.citations + b.totalCitations,
        }),
        { pos: 0, neg: 0, total: 0, mentioned: 0, citations: 0 }
      );

      const currentSentiment = sentimentRatioV2(latest.positiveThemes, latest.negativeThemes) ?? 0;
      const previousSentiment = sentimentRatioV2(prevAgg.pos, prevAgg.neg) ?? 0;
      const sentimentChange = currentSentiment - previousSentiment;
      sentimentTrendComparison = {
        value: Math.abs(Math.round(sentimentChange * 100)),
        direction: sentimentChange > 0.05 ? 'up' : sentimentChange < -0.05 ? 'down' : 'neutral'
      };

      const currentVisibility = latest.totalResponses > 0 ? (latest.mentionedResponses / latest.totalResponses) * 100 : 0;
      const previousVisibility = prevAgg.total > 0 ? (prevAgg.mentioned / prevAgg.total) * 100 : 0;
      const visibilityChange = currentVisibility - previousVisibility;
      visibilityTrendComparison = {
        value: Math.abs(visibilityChange),
        direction: visibilityChange > 1 ? 'up' : visibilityChange < -1 ? 'down' : 'neutral'
      };

      const previousCitationsAvg = prevAgg.citations / Math.max(1, previous.length);
      const citationsChange = latest.totalCitations - previousCitationsAvg;
      citationsTrendComparison = {
        value: Math.abs(Math.round(citationsChange)),
        direction: citationsChange > 0.1 ? 'up' : citationsChange < -0.1 ? 'down' : 'neutral'
      };
    } else if (responses.length > 1) {
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
          // Pool positive/negative counts (methodology v2) — responses with no
          // polarized themes contribute nothing rather than dragging toward 0.
          const poolRatio = (rs: typeof currentResponses): number => {
            let pos = 0, neg = 0;
            rs.forEach(r => {
              const s = calculateAIBasedSentiment(r.id);
              pos += s.positive;
              neg += s.negative;
            });
            return sentimentRatioV2(pos, neg) ?? 0;
          };
          currentSentimentAvg = poolRatio(currentResponses);
          previousSentimentAvg = poolRatio(previousResponses);
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

    // Citation total from the cube ONLY when a quarter is active — the other
    // card numbers (totalResponses, uniqueDomains) still come from the raw
    // window, and an all-time cube figure next to window-limited counts reads
    // as inconsistent on one card. The quarter-scoped read agrees with the
    // quarter-scoped raw numbers (modulo the documented dedup fix).
    // uniqueDomains stays raw — the cube's per-key distinct counts can't be
    // unioned across months; it waits for the domain-grain cube (slice 2).
    const totalCitations = (scopeCubeReady && statsSel.quarterKey)
      ? cubeTotals.totalCitations
      : responses.reduce((sum, r) => sum + getCitations(r.id).length, 0);
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
  }, [periodFilteredResponses, promptsData, aiThemes, calculateAIBasedSentiment, effSentimentMetrics, effSentimentByMonth, effRelevanceMetrics, effRelevanceByMonth, effectivePeriod, getCitations, visibilityRowsForSelection, scopeStats, selectedLocation, selectedLocationEntry, countryKeyByCompanyId, availablePeriods]);

  // Per-quarter EPS trend powering the Overview headline sparkline. One point
  // per available quarter (oldest → selected period), each computed with the
  // SAME 50/30/20 weighting as the headline metric so the latest point equals
  // the big EPS number. Sentiment/relevance come from the month-grain MVs
  // pooled by quarter (falling back to the all-periods aggregate when a
  // quarter is missing, mirroring the headline fallback); visibility is
  // computed from that quarter's responses.
  const epsTrend = useMemo(() => {
    if (availablePeriods.length === 0) return [];
    const periodsAsc = [...availablePeriods].sort(
      (a, b) => a.startDate.getTime() - b.startDate.getTime()
    );
    const sentimentAgg = effSentimentMetrics?.sentiment_ratio;
    const relevanceAgg = effRelevanceMetrics?.relevance_score;

    const full = periodsAsc.map((p) => {
      // Snapshot-quarter bucketing (responsePeriodKey), matching the period
      // filter — NOT tested_at, which can fall in the prior calendar quarter.
      // Visibility prefers the exact rollup for the quarter.
      const monthResponses = visibleResponses.filter((r) => responsePeriodKey(r) === p.key);
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

    // Trim to the selected period so the line ends on the quarter whose EPS the
    // card headline is showing (default selection is the latest quarter).
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
      // Sentiment — methodology v2: positive/(positive+negative) pooled
      // across this function's rows (neutrals excluded from the score).
      let positiveThemes = 0, negativeThemes = 0;
      effSentimentMvRows.forEach(r => {
        if (r.job_function_context !== fn) return;
        positiveThemes += r.positive_themes || 0;
        negativeThemes += r.negative_themes || 0;
      });
      const fnRatio = sentimentRatioV2(positiveThemes, negativeThemes);
      const sentimentScore = fnRatio !== null
        ? Math.round(Math.max(0, Math.min(100, fnRatio * 100)))
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

  // Per-job-function quarterly EPS trend — same 50/30/20 formula as
  // metricsByJobFunction, resolved one quarter at a time, so the headline
  // sparkline + delta work while a function filter is active. Only quarters
  // where the function actually has responses are included; when a quarter is
  // missing sentiment/relevance from the MVs we fall back to that function's
  // all-periods aggregate so the line never dips to an artificial zero. The
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

    // Pre-bucket MV rows by "fn YYYY-Qn" so each (fn, period) lookup is O(1);
    // month-grain MV rows pool into their quarter.
    const sentBucket = new Map<string, { pos: number; neg: number }>();
    effSentimentMvRows.forEach(r => {
      if (!r.job_function_context || !r.response_month) return;
      const qk = quarterKeyOfMonthStr(String(r.response_month));
      if (!qk) return;
      const k = `${r.job_function_context} ${qk}`;
      const b = sentBucket.get(k) || { pos: 0, neg: 0 };
      b.pos += r.positive_themes || 0; b.neg += r.negative_themes || 0;
      sentBucket.set(k, b);
    });
    const relBucket = new Map<string, { w: number; wt: number }>();
    effRelevanceMvRows.forEach(r => {
      if (!r.job_function_context || !r.response_month) return;
      const qk = quarterKeyOfMonthStr(String(r.response_month));
      if (!qk) return;
      const k = `${r.job_function_context} ${qk}`;
      const b = relBucket.get(k) || { w: 0, wt: 0 };
      b.w += (r.relevance_score || 0) * (r.valid_citations || 0); b.wt += r.valid_citations || 0;
      relBucket.set(k, b);
    });

    const result: Record<string, any[]> = {};
    fns.forEach(fn => {
      const agg = metricsByJobFunction[fn]; // all-periods aggregate (fallback + endpoint match)
      const series: any[] = [];
      periodsAsc.forEach(p => {
        const monthResponses = visibleResponses.filter(r =>
          r.confirmed_prompts?.job_function_context?.trim() === fn &&
          responsePeriodKey(r) === p.key
        );
        // Exact rollup for (function, quarter) preferred; a quarter the function
        // wasn't measured in (no rollup rows AND no responses) is skipped.
        const mvFnMonth = visibilityFromMvRows(visibilityRowsForSelection, p.key, fn);
        if (monthResponses.length === 0 && !mvFnMonth) return; // not measured this quarter
        const mentioned = monthResponses.filter(r => r.company_mentioned === true).length;
        const visibility = mvFnMonth
          ? Math.round(mvFnMonth.pct)
          : Math.round((mentioned / monthResponses.length) * 100);

        const sb = sentBucket.get(`${fn} ${p.key}`);
        const sbRatio = sb ? sentimentRatioV2(sb.pos, sb.neg) : null;
        const sentiment = sbRatio !== null
          ? Math.round(Math.max(0, Math.min(100, sbRatio * 100)))
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

      // Methodology v2: pool positive/negative theme counts across the
      // prompt's responses; neutral-only responses carry no signal.
      const pooled = promptResponses.reduce(
        (acc, r) => {
          const s = calculateAIBasedSentiment(r.id);
          acc.pos += s.positive;
          acc.neg += s.negative;
          return acc;
        },
        { pos: 0, neg: 0 }
      );
      const pooledRatio = sentimentRatioV2(pooled.pos, pooled.neg);
      const avgSentiment = pooledRatio ?? 0;
      const sentimentLabel = pooledRatio === null ? 'neutral' : pooledRatio > 0.6 ? 'positive' : pooledRatio < 0.4 ? 'negative' : 'neutral';

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
        const validCompetitors = parseDetectedCompetitors(result.detectedCompetitors, companyName);
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
          const validCompetitors = parseDetectedCompetitors(response.detected_competitors, companyName);
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
        if (!updateError) refreshData();
      }
    } catch (error) {
      console.error('Error in fixMissingUserIds:', error);
    }
  }, [user, refreshData]);


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
    aiThemes: effAiThemes, // Raw AI themes (lazy, accumulated per drilled attribute) — location-scoped when a location is active
    fetchAIThemesForAttribute, // Lazy per-attribute raw-themes fetch (Thematic drilldown open)
    aiThemeAttrsLoaded, // v2 attribute ids whose raw themes are loaded for the current scope
    attributeThemes: effAttributeThemes, // Pre-aggregated attribute scores — location-scoped when a location is active
    responseSentimentRows, // Per-response sentiment ratios (company_response_sentiment_mv)
    scopeStats, // Phase-3 pre-aggregated stats cube (month/day × job fn × location [+ prompt_type / ai_model])
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
    isRefreshing, // background revalidation with content on screen — subtle indicator, never a skeleton
    hydration, // per-family first-load progress for the branded loading screen
    prefetchLocationRollups, // intent prefetch for the location dropdown
    prefetchCompanyRollups, // intent prefetch for the company switcher
  };
};
