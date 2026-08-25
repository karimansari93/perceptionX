import { supabase } from "@/integrations/supabase/client";
import { EXCLUDED_AI_MODELS } from "@/lib/sentimentV2";

// Query-key factory for every dashboard fetch family. Keys are scoped by the
// BRAND SCOPE signature (sorted sibling company ids), not the entry company:
// Ford-US and Ford-CA share one scope, so a country switch that swaps the
// entry company reuses the cached scope data instead of re-downloading it —
// the measured 73 MB-per-country-switch failure mode.
export const dashboardKeys = {
  all: ['dashboard'] as const,
  scope: (scopeKey: string) => ['dashboard', 'scope', scopeKey] as const,
  prompts: (scopeKey: string) => ['dashboard', 'scope', scopeKey, 'prompts'] as const,
  rollups: (scopeKey: string) => ['dashboard', 'scope', scopeKey, 'rollups'] as const,
  responsesFirst: (scopeKey: string) => ['dashboard', 'scope', scopeKey, 'responses', 'first'] as const,
  responsesFull: (scopeKey: string) => ['dashboard', 'scope', scopeKey, 'responses', 'full'] as const,
  // Location keys deliberately EXCLUDE the raw-spelling signature: spellings
  // can widen while the response stream lands, and keying on them re-fired
  // identical fetches 2-3x per switch. Widening instead invalidates the key.
  locationRollups: (scopeKey: string, locationKey: string) =>
    ['dashboard', 'scope', scopeKey, 'location', locationKey] as const,
  scopeStats: (scopeKey: string) => ['dashboard', 'scope', scopeKey, 'stats'] as const,
  // Interactive cubes: one fetch per (scope, location selection); month ×
  // job-function (× prompt_type) stay in the payload so filter toggles pool
  // client-side with no fetch. '' = all locations.
  domainStats: (scopeKey: string, locationKey: string) =>
    ['dashboard', 'scope', scopeKey, 'domains', locationKey] as const,
  competitorStats: (scopeKey: string, locationKey: string) =>
    ['dashboard', 'scope', scopeKey, 'competitors', locationKey] as const,
};

export interface ScopeRollups {
  sentiment: any[];
  relevance: any[];
  top_sources: { domain: string; citation_count: number }[];
  competitors: { competitor_name: string; mention_count: number }[];
  llm_rankings: { ai_model: string; mentions: number }[];
  attribute_themes: any[];
  visibility: any[];
  location_buckets: string[];
}

export interface LocationRollups {
  sentiment: any[];
  relevance: any[];
  top_sources: { domain: string; citation_count: number; location_context: string | null }[];
  competitors: { competitor_name: string; mention_count: number; location_context: string | null }[];
  llm_rankings: { ai_model: string; mentions: number; location_context: string | null }[];
  attribute_themes: any[];
}

export interface ResponseStream {
  rows: any[];        // slim canonical rows, tested_at DESC, deduped by id
  complete: boolean;  // every scope company streamed to its final page
}

// Phase-3 scope-stats cube (get_scope_stats): pre-aggregated per-company
// stats at month/day × job-function × location grain, plus prompt-type and
// ai-model variants. Small enough (~4 KB/company) to ship whole, so filter
// toggles keep computing client-side with no fetch per toggle. Dimension
// conventions: '' = untagged job function / location; location_context is the
// RAW spelling (canonicalize client-side, same as the by-location rollups).
export interface ScopeStatsRow {
  company_id: string;
  response_month: string;
  job_function_context: string;
  location_context: string;
  total_responses: number;
  mentioned_responses: number;
  total_citations: number;
  distinct_domains: number;
  distinct_models: number;
  positive_themes: number;
  negative_themes: number;
  neutral_themes: number;
}
export interface ScopeDailyStatsRow {
  company_id: string;
  tested_day: string;
  // Collection-cycle month of the rows pooled into this day (a tested day can
  // span two cycles → two rows). NULL only while a company awaits its first
  // refresh after the 20260825140000 migration — treat as not-yet-refreshed.
  response_month: string | null;
  job_function_context: string;
  location_context: string;
  total_responses: number;
  mentioned_responses: number;
  total_citations: number;
  distinct_prompt_models: number;
  positive_themes: number;
  negative_themes: number;
}
export interface ScopePromptTypeStatsRow {
  company_id: string;
  response_month: string;
  job_function_context: string;
  location_context: string;
  prompt_type: string;
  total_responses: number;
  mentioned_responses: number;
}
export interface ScopeLlmStatsRow {
  company_id: string;
  response_month: string;
  job_function_context: string;
  location_context: string;
  ai_model: string;
  total_responses: number;
  mentions: number;
}
export interface ScopeStats {
  scope: ScopeStatsRow[];
  daily: ScopeDailyStatsRow[];
  prompt_types: ScopePromptTypeStatsRow[];
  llm: ScopeLlmStatsRow[];
}

// Domain cube (get_domain_stats, p_keep_functions=true): top-N domains for
// the scope+location, month × job-function grain. responses_citing /
// mentioned_responses_citing are deduped per response; citation_count counts
// occurrences (the top_sources measure).
export interface DomainStatsRow {
  domain: string;
  response_month: string;
  job_function_context: string;
  responses_citing: number;
  mentioned_responses_citing: number;
  citation_count: number;
}
export interface DomainStats {
  rows: DomainStatsRow[];
  domain_total: number; // distinct domains in the filtered window (pre top-N)
}

// Competitor cube (get_competitor_stats): top-N canonical competitors,
// month × job-function × prompt_type grain, deduped per response.
export interface CompetitorStatsRow {
  competitor_name: string;
  response_month: string;
  job_function_context: string;
  prompt_type: string;
  responses_mentioning: number;
  co_mentions: number;
}
export interface CompetitorStats {
  rows: CompetitorStatsRow[];
  competitor_total: number;
}

export interface CubeLocationParams {
  ownedIds: string[];
  ownedBuckets: string[] | null; // null = no location predicate (all locations)
  otherIds: string[];
  otherBuckets: string[];
}

const PAGE_SIZE = 1000;
const RETRY_PAGE_SIZE = 250;
const EAGER_DAYS = 180;

const rpc = async <T,>(fn: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> => {
  let q: any = (supabase as any).rpc(fn, args);
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q;
  if (error) throw error;
  return data as T;
};

export const fetchScopePrompts = (scopeIds: string[], signal?: AbortSignal): Promise<any[]> =>
  rpc<any[]>('get_scope_prompts', { p_company_ids: scopeIds }, signal);

export const fetchScopeRollups = (scopeIds: string[], signal?: AbortSignal): Promise<ScopeRollups> =>
  rpc<ScopeRollups>('get_dashboard_rollups', { p_company_ids: scopeIds }, signal);

export const fetchScopeStats = (scopeIds: string[], signal?: AbortSignal): Promise<ScopeStats> =>
  rpc<ScopeStats>('get_scope_stats', { p_company_ids: scopeIds }, signal);

export const fetchDomainStats = (params: CubeLocationParams, signal?: AbortSignal): Promise<DomainStats> =>
  rpc<DomainStats>('get_domain_stats', {
    p_owned_ids: params.ownedIds,
    p_owned_buckets: params.ownedBuckets,
    p_other_ids: params.otherIds,
    p_other_buckets: params.otherBuckets,
    p_keep_functions: true,
    p_limit: 300,
  }, signal);

export const fetchCompetitorStats = (params: CubeLocationParams, signal?: AbortSignal): Promise<CompetitorStats> =>
  rpc<CompetitorStats>('get_competitor_stats', {
    p_owned_ids: params.ownedIds,
    p_owned_buckets: params.ownedBuckets,
    p_other_ids: params.otherIds,
    p_other_buckets: params.otherBuckets,
    p_limit: 300,
  }, signal);

export const fetchLocationRollups = (
  params: { ownedIds: string[]; ownedBuckets: string[]; otherIds: string[]; otherBuckets: string[] },
  signal?: AbortSignal
): Promise<LocationRollups> =>
  rpc<LocationRollups>('get_location_rollups', {
    p_owned_ids: params.ownedIds,
    p_owned_buckets: params.ownedBuckets,
    p_other_ids: params.otherIds,
    p_other_buckets: params.otherBuckets,
  }, signal);

const eagerCutoffIso = () => new Date(Date.now() - EAGER_DAYS * 24 * 60 * 60 * 1000).toISOString();

const byTestedAtDesc = (a: any, b: any) =>
  new Date(b.tested_at || b.created_at || 0).getTime() - new Date(a.tested_at || a.created_at || 0).getTime();

const dedupeById = (rows: any[]): any[] => {
  const seen = new Set<string>();
  return rows.filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true)));
};

// Pages retry individually so one transient failure under a parallel burst
// doesn't force React Query to re-run the whole multi-page stream fetch.
//
// The dominant page failure is Postgres cancelling the statement at the
// 8s `authenticated` role timeout (PostgREST surfaces it as a 500) when a
// wide scope's parallel pages saturate the database. Page cost scales with
// row count, so retries shrink the page to a size that completes under the
// timeout, and back off long enough (with jitter) that the retry wave
// doesn't re-form the same herd that caused the cancellations.
const fetchResponsePage = async (
  companyId: string,
  cursor: { tested_at: string; id: string } | null,
  signal?: AbortSignal
): Promise<{ rows: any[]; limit: number }> => {
  const attempt = (limit: number) => rpc<any[]>('get_company_responses_page', {
    p_company_id: companyId,
    p_excluded_models: EXCLUDED_AI_MODELS,
    p_since: eagerCutoffIso(),
    p_before_tested_at: cursor?.tested_at ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: limit,
  }, signal);
  const plan = [
    { backoff: 0, limit: PAGE_SIZE },
    { backoff: 2500, limit: RETRY_PAGE_SIZE },
    { backoff: 6000, limit: RETRY_PAGE_SIZE },
  ];
  for (let i = 0; ; i += 1) {
    try {
      const rows = await attempt(plan[i].limit);
      return { rows, limit: plan[i].limit };
    } catch (err) {
      if (signal?.aborted || i + 1 >= plan.length) throw err;
      await new Promise(r => setTimeout(r, plan[i + 1].backoff + Math.random() * 1000));
      if (signal?.aborted) throw err;
    }
  }
};

// Run tasks with bounded concurrency — replaces the module-global 6-slot gate
// for the stream (the only remaining multi-request family; everything else is
// a single RPC now).
const boundedMap = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
};

export interface FirstPages extends ResponseStream {
  cursorByCompany: Record<string, { tested_at: string; id: string } | null>; // null = company already complete
}

// Newest page of every scope profile, in parallel. Small enough to commit
// eagerly so tables hydrate while the rest of the stream arrives. Concurrency
// 4: an 18-wide burst of cold-cache pages tipped Postgres into transient
// 500s under contention (observed on the Ford scope).
export const fetchResponsesFirstPages = async (scopeIds: string[], signal?: AbortSignal): Promise<FirstPages> => {
  const pages = await boundedMap(scopeIds, 4, id => fetchResponsePage(id, null, signal));
  const cursorByCompany: FirstPages['cursorByCompany'] = {};
  let complete = true;
  pages.forEach(({ rows, limit }, i) => {
    const last = rows[rows.length - 1];
    // A short page relative to the limit actually requested means the walk
    // reached the end — the retry path may have fetched fewer than PAGE_SIZE.
    const companyComplete = rows.length < limit;
    cursorByCompany[scopeIds[i]] = companyComplete || !last ? null : { tested_at: last.tested_at, id: last.id };
    if (!companyComplete) complete = false;
  });
  return { rows: dedupeById(pages.flatMap(p => p.rows)).sort(byTestedAtDesc), complete, cursorByCompany };
};

// The rest of the stream: keyset-walk each profile from the first page's
// cursor (or from the top when the first-page cache is missing). Keyset pages
// cost the same at any depth — no OFFSET re-scans, no exact counts.
export const fetchResponsesRemaining = async (
  scopeIds: string[],
  first: FirstPages | undefined,
  signal?: AbortSignal
): Promise<ResponseStream> => {
  // Concurrency 2 (first pages run at 4): this walk is background hydration
  // with no paint waiting on it, and on wide scopes (Netflix: 16 profiles,
  // ~86 pages) a 4-wide walk saturated Postgres into 8s statement timeouts
  // that 500'd the rollup calls sharing the database.
  const perCompany = await boundedMap(scopeIds, 2, async (id) => {
    const firstRows = first?.rows?.filter(r => r.company_id === id) ?? [];
    let cursor = first ? first.cursorByCompany[id] ?? null : null;
    const all: any[] = first ? [...firstRows] : [];
    if (first && cursor === null) return all; // this profile finished in page 1
    for (;;) {
      const { rows, limit } = await fetchResponsePage(id, cursor, signal);
      all.push(...rows);
      if (rows.length < limit) break;
      const last = rows[rows.length - 1];
      cursor = { tested_at: last.tested_at, id: last.id };
    }
    return all;
  });
  return { rows: dedupeById(perCompany.flat()).sort(byTestedAtDesc), complete: true };
};

// Per-response sentiment rides along on the response stream itself (the RPC
// LEFT JOINs the response-grain sentiment MV), so no separate fetch family
// exists anymore. This extracts the old responseSentimentRows shape from
// streamed rows for the consumers that pool sentiment by response id.
export const sentimentRowsFromStream = (rows: any[]): any[] => {
  const out: any[] = [];
  for (const r of rows) {
    if (r.sentiment_total_themes == null && r.sentiment_ratio == null &&
        r.sentiment_positive_themes == null && r.sentiment_negative_themes == null) continue;
    out.push({
      response_id: r.id,
      total_themes: r.sentiment_total_themes ?? 0,
      positive_themes: r.sentiment_positive_themes ?? 0,
      negative_themes: r.sentiment_negative_themes ?? 0,
      sentiment_ratio: r.sentiment_ratio ?? null,
    });
  }
  return out;
};
