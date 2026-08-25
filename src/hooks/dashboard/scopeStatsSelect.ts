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
import type { ScopeStatsRow, ScopeDailyStatsRow, ScopePromptTypeStatsRow, ScopeLlmStatsRow } from './dashboardQueries';

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
