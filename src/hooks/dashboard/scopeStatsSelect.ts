// Selectors over the phase-3 scope-stats cube (get_scope_stats). Each one
// mirrors, exactly, the raw-row filter rule it replaces:
//  - location: canonicalizeLocationContext(row.location_context) ?? the row's
//    company country key — the resolveResponseLocationKey attribution rule.
//  - period: the QUARTER of response_month (collection-cycle month), matching
//    responsePeriodKey / periodFilteredResponses.
// Measures here are ADDITIVE (counts and sums), so summing filtered rows is
// exact. Non-additive measures (distinct domains/models across keys) cannot
// be pooled from this cube — those stay on their existing sources until the
// domain/competitor cubes land.
import { canonicalizeLocationContext, GENERAL_KEY } from '@/utils/locationContext';
import type {
  CompetitorStatsRow,
  DomainStatsRow,
  ScopeStatsRow,
  ScopeDailyStatsRow,
  ScopePromptTypeStatsRow,
  ScopeLlmStatsRow,
} from './dashboardQueries';

import { quarterKeyOfMonthStr } from '@/utils/quarterKey';

export interface StatsSelection {
  // Active location filter: null = all locations; GENERAL_KEY = untagged
  // rows of countryless profiles; otherwise a canonical location key.
  locationKey: string | null;
  // company_id → the profile's own canonical country key (or null).
  countryKeyByCompanyId: Map<string, string | null>;
  // Active period: null = all periods; otherwise a "YYYY-Qn" quarter key.
  quarterKey: string | null;
}

type LocatedRow = { company_id: string; location_context: string };

const rowLocationKey = (row: LocatedRow, sel: StatsSelection): string | null =>
  canonicalizeLocationContext(row.location_context) ??
  (sel.countryKeyByCompanyId.get(row.company_id) ?? null);

const matchesLocation = (row: LocatedRow, sel: StatsSelection): boolean => {
  if (!sel.locationKey) return true;
  const key = rowLocationKey(row, sel);
  return sel.locationKey === GENERAL_KEY ? key === null : key === sel.locationKey;
};

const matchesQuarter = (month: string | null | undefined, sel: StatsSelection): boolean => {
  if (!sel.quarterKey) return true;
  if (!month) return false;
  return quarterKeyOfMonthStr(String(month)) === sel.quarterKey;
};

export const selectScopeRows = (rows: ScopeStatsRow[], sel: StatsSelection): ScopeStatsRow[] =>
  rows.filter(r => matchesLocation(r, sel) && matchesQuarter(r.response_month, sel));

export const selectPromptTypeRows = (rows: ScopePromptTypeStatsRow[], sel: StatsSelection): ScopePromptTypeStatsRow[] =>
  rows.filter(r => matchesLocation(r, sel) && matchesQuarter(r.response_month, sel));

export const selectLlmRows = (rows: ScopeLlmStatsRow[], sel: StatsSelection): ScopeLlmStatsRow[] =>
  rows.filter(r => matchesLocation(r, sel) && matchesQuarter(r.response_month, sel));

export interface ScopeTotals {
  totalResponses: number;
  mentionedResponses: number;
  totalCitations: number;
  positiveThemes: number;
  negativeThemes: number;
  neutralThemes: number;
}

export const sumScopeRows = (rows: ScopeStatsRow[]): ScopeTotals =>
  rows.reduce((acc, r) => {
    acc.totalResponses += r.total_responses || 0;
    acc.mentionedResponses += r.mentioned_responses || 0;
    acc.totalCitations += r.total_citations || 0;
    acc.positiveThemes += r.positive_themes || 0;
    acc.negativeThemes += r.negative_themes || 0;
    acc.neutralThemes += r.neutral_themes || 0;
    return acc;
  }, { totalResponses: 0, mentionedResponses: 0, totalCitations: 0, positiveThemes: 0, negativeThemes: 0, neutralThemes: 0 });

// NOTE: distinct_prompt_models is deliberately NOT exposed here. A tested day
// spanning two collection cycles yields two month rows whose distinct counts
// overlap for the same (prompt, model) pair, so summing them overcounts. When
// the perception-score trend switches to the cube it needs a dedicated
// selector that handles the month-split day.
export interface DailyBucket {
  day: string; // YYYY-MM-DD
  totalResponses: number;
  mentionedResponses: number;
  totalCitations: number;
  positiveThemes: number;
  negativeThemes: number;
}

// Day buckets for the active selection, ascending by day. Rows with NULL
// response_month (company not yet refreshed onto the month-carrying schema)
// make period filtering unsound for that company, so the caller should treat
// hasUnrefreshedRows as "fall back to the raw path" when a period is active.
export const selectDailyBuckets = (
  rows: ScopeDailyStatsRow[],
  sel: StatsSelection
): { buckets: DailyBucket[]; hasUnrefreshedRows: boolean } => {
  let hasUnrefreshedRows = false;
  const byDay = new Map<string, DailyBucket>();
  for (const r of rows) {
    if (r.response_month == null) hasUnrefreshedRows = true;
    if (!matchesLocation(r, sel)) continue;
    if (!matchesQuarter(r.response_month, sel)) continue;
    const day = String(r.tested_day).slice(0, 10);
    let b = byDay.get(day);
    if (!b) {
      b = { day, totalResponses: 0, mentionedResponses: 0, totalCitations: 0, positiveThemes: 0, negativeThemes: 0 };
      byDay.set(day, b);
    }
    b.totalResponses += r.total_responses || 0;
    b.mentionedResponses += r.mentioned_responses || 0;
    b.totalCitations += r.total_citations || 0;
    b.positiveThemes += r.positive_themes || 0;
    b.negativeThemes += r.negative_themes || 0;
  }
  return {
    buckets: Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)),
    hasUnrefreshedRows,
  };
};

// ---------------------------------------------------------------------------
// Interactive-cube pooling. The domain/competitor cubes arrive already
// location-collapsed (the fetch is keyed per location selection), so pooling
// filters only by quarter and job function — pure reduces over a few
// thousand rows, which is what makes filter toggles instant.
// ---------------------------------------------------------------------------

export interface CubePoolSelection {
  quarterKey: string | null;   // null = all periods
  jobFunction: string | null;  // null = all functions; matches job_function_context exactly
}

const rowInPool = (
  row: { response_month: string; job_function_context: string },
  sel: CubePoolSelection
): boolean => {
  if (sel.quarterKey && quarterKeyOfMonthStr(String(row.response_month)) !== sel.quarterKey) return false;
  if (sel.jobFunction != null && row.job_function_context !== sel.jobFunction) return false;
  return true;
};

export interface DomainPoolEntry {
  domain: string;
  responsesCiting: number;
  mentionedResponsesCiting: number;
  citationCount: number;
}

export const poolDomainRows = (
  rows: DomainStatsRow[],
  sel: CubePoolSelection
): Map<string, DomainPoolEntry> => {
  const out = new Map<string, DomainPoolEntry>();
  for (const r of rows) {
    if (!rowInPool(r, sel)) continue;
    let e = out.get(r.domain);
    if (!e) {
      e = { domain: r.domain, responsesCiting: 0, mentionedResponsesCiting: 0, citationCount: 0 };
      out.set(r.domain, e);
    }
    e.responsesCiting += r.responses_citing || 0;
    e.mentionedResponsesCiting += r.mentioned_responses_citing || 0;
    e.citationCount += r.citation_count || 0;
  }
  return out;
};

// Per-domain by month (ascending), for trend charts.
export const poolDomainMonthly = (
  rows: DomainStatsRow[],
  sel: CubePoolSelection
): Map<string, Map<string, number>> => {
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (sel.jobFunction != null && r.job_function_context !== sel.jobFunction) continue;
    if (sel.quarterKey && quarterKeyOfMonthStr(String(r.response_month)) !== sel.quarterKey) continue;
    const month = String(r.response_month).slice(0, 7);
    let m = out.get(r.domain);
    if (!m) { m = new Map(); out.set(r.domain, m); }
    m.set(month, (m.get(month) || 0) + (r.responses_citing || 0));
  }
  return out;
};

export interface CompetitorPoolEntry {
  name: string;
  mentions: number;      // deduped responses mentioning the competitor
  coMentions: number;    // of those, responses where the company was also mentioned
  discoveryMentions: number;
  competitiveMentions: number;
}

export const poolCompetitorRows = (
  rows: CompetitorStatsRow[],
  sel: CubePoolSelection & { promptType?: string | null }
): Map<string, CompetitorPoolEntry> => {
  const out = new Map<string, CompetitorPoolEntry>();
  for (const r of rows) {
    if (!rowInPool(r, sel)) continue;
    if (sel.promptType != null && r.prompt_type !== sel.promptType) continue;
    let e = out.get(r.competitor_name);
    if (!e) {
      e = { name: r.competitor_name, mentions: 0, coMentions: 0, discoveryMentions: 0, competitiveMentions: 0 };
      out.set(r.competitor_name, e);
    }
    e.mentions += r.responses_mentioning || 0;
    e.coMentions += r.co_mentions || 0;
    if (r.prompt_type === 'discovery') e.discoveryMentions += r.responses_mentioning || 0;
    if (r.prompt_type === 'competitive') e.competitiveMentions += r.responses_mentioning || 0;
  }
  return out;
};

// Per-competitor by month (share-of-voice trends).
export const poolCompetitorMonthly = (
  rows: CompetitorStatsRow[],
  sel: CubePoolSelection & { promptType?: string | null }
): Map<string, Map<string, number>> => {
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (sel.jobFunction != null && r.job_function_context !== sel.jobFunction) continue;
    if (sel.promptType != null && r.prompt_type !== sel.promptType) continue;
    if (sel.quarterKey && quarterKeyOfMonthStr(String(r.response_month)) !== sel.quarterKey) continue;
    const month = String(r.response_month).slice(0, 7);
    let m = out.get(r.competitor_name);
    if (!m) { m = new Map(); out.set(r.competitor_name, m); }
    m.set(month, (m.get(month) || 0) + (r.responses_mentioning || 0));
  }
  return out;
};

// Location-only filters (function + month kept) for handing cube rows to
// components that pool by job function themselves. Only the hook has the
// location attribution machinery (countryKeyByCompanyId), so it applies
// this once and passes the filtered rows down.
export const selectScopeRowsForLocation = (rows: ScopeStatsRow[], sel: StatsSelection): ScopeStatsRow[] =>
  rows.filter(r => matchesLocation(r, sel));

export const selectPromptTypeRowsForLocation = (rows: ScopePromptTypeStatsRow[], sel: StatsSelection): ScopePromptTypeStatsRow[] =>
  rows.filter(r => matchesLocation(r, sel));

export const selectDailyRowsForLocation = (
  rows: ScopeDailyStatsRow[],
  sel: StatsSelection
): { rows: ScopeDailyStatsRow[]; hasUnrefreshedRows: boolean } => {
  let hasUnrefreshedRows = false;
  const out: ScopeDailyStatsRow[] = [];
  for (const r of rows) {
    if (r.response_month == null) hasUnrefreshedRows = true;
    if (matchesLocation(r, sel)) out.push(r);
  }
  return { rows: out, hasUnrefreshedRows };
};
