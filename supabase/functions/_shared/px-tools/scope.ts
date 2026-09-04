// ─── px-tools: brand scope, location + measurement-period resolution ────────
// The org data model is brand × market: "Ford" in the Ford org is 18 company
// rows (US, IN, DE, …) plus distinct brands like "Ford Credit". Dashboard
// numbers aggregate the brand scope (the selected company plus its same-name
// sibling profiles in the same org), so the tools do the same — otherwise
// chat/MCP answers would not match the app.
//
// Periods are MEASURED periods. Collection runs in waves (Ford: one wave in
// Apr/May 2026, one in July), so the window a tool reports on is "the last N
// quarters that actually have data", never "the last N calendar quarters" —
// a calendar quarter without a wave is not a gap and must never be listed as
// one. Whether the latest quarter is still filling in is read from the
// collection pipeline, not from today's date.

import {
  buildMeta, labelQuarter, METHODOLOGY_NOTES, monthToQuarter, quartersOfMonths,
  selectRecentQuarters,
} from './helpers.ts';

export interface ToolContext {
  admin: any;                 // service-role supabase client
  organizationId: string;     // verified org of the caller (never model-chosen)
  requestId: string;
}

export interface BrandScope {
  companyIds: string[];       // entry company + same-name org siblings
  brandName: string;
  entryCompanyId: string;
}

// Validate that every required company_id belongs to the caller's org.
// Defense-in-depth: even if the model fabricates a company_id it saw
// elsewhere, we reject it here before any data is read. RLS is disabled on
// some hot tables, so this check is the primary tenant boundary.
export async function validateCompanyOwnership(
  admin: any,
  organizationId: string,
  companyIds: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!companyIds.length) return { ok: true };
  const { data, error } = await admin
    .from('organization_companies')
    .select('company_id')
    .eq('organization_id', organizationId)
    .in('company_id', companyIds);
  if (error) return { ok: false, error: `Ownership check failed: ${error.message}` };
  const owned = new Set((data || []).map((r: any) => r.company_id));
  const unowned = companyIds.filter(id => !owned.has(id));
  if (unowned.length) {
    return { ok: false, error: `Company IDs not in your organization: ${unowned.join(', ')}. Call list_companies to see valid IDs.` };
  }
  return { ok: true };
}

// Resolve the brand scope for a company. Sibling ids come FROM the org's own
// organization_companies rows, so they are owned by construction.
export async function resolveBrandScope(
  ctx: ToolContext,
  companyId: string,
  includeSiblings: boolean
): Promise<BrandScope | { error: string }> {
  const { data: company, error } = await ctx.admin
    .from('companies').select('id, name').eq('id', companyId).maybeSingle();
  if (error || !company) return { error: `Company not found.` };
  if (!includeSiblings) {
    return { companyIds: [companyId], brandName: company.name, entryCompanyId: companyId };
  }
  const { data: siblings, error: sibErr } = await ctx.admin
    .from('organization_companies')
    .select('company_id, companies!inner(id, name)')
    .eq('organization_id', ctx.organizationId);
  if (sibErr) return { companyIds: [companyId], brandName: company.name, entryCompanyId: companyId };
  const ids = (siblings || [])
    .filter((r: any) => (r.companies?.name || '').trim().toLowerCase() === company.name.trim().toLowerCase())
    .map((r: any) => r.company_id);
  if (!ids.includes(companyId)) ids.push(companyId);
  return { companyIds: ids, brandName: company.name, entryCompanyId: companyId };
}

// ─── Location bucket matching ───────────────────────────────────────────────
// location_context is free-text on prompts ("India", "Berlin, Germany", "" =
// untagged/global). A user asking about "japan" must match the org's actual
// spellings. We fetch the scope's distinct buckets (cheap: from the scope
// stats cube) and fuzzy-match: exact (case-insensitive) first, then
// containment either way. Returns the matched raw spellings to query with —
// and, on no match, the list of available buckets so the model can tell the
// user what IS tracked instead of guessing.
export async function resolveLocationBuckets(
  ctx: ToolContext,
  companyIds: string[],
  requestedLocation: string
): Promise<{ buckets: string[]; available: string[] }> {
  // Via a service-role RPC (distinct server-side) rather than a table read,
  // so the bucket list is never truncated by PostgREST row caps.
  const { data } = await ctx.admin.rpc('mcp_list_location_buckets', { p_company_ids: companyIds });
  const available = Array.from(
    new Set(((data as string[] | null) || []).map((l) => (l ?? '').trim()).filter((l) => l !== ''))
  ).sort() as string[];
  return { buckets: matchBuckets(available, requestedLocation), available };
}

// Shared fuzzy matcher for free-text buckets: exact (case-insensitive)
// first, then containment either way, with optional aliases for the ways
// people name things ("HR" → Human Resources, "engineers" → Engineering).
export function matchBuckets(available: string[], requested: string, aliases: Record<string, string> = {}): string[] {
  const q = requested.trim().toLowerCase();
  if (!q) return [];
  const exact = available.filter(l => l.toLowerCase() === q);
  if (exact.length) return exact;
  const terms = Array.from(new Set([q, aliases[q]].filter(Boolean))) as string[];
  return available.filter(l => terms.some(t => l.toLowerCase().includes(t) || t.includes(l.toLowerCase())));
}

// ─── Job-function bucket matching ───────────────────────────────────────────
// job_function_context is free-text on prompts too ("Finance", "Marketing &
// Sales", "Manufacturing Engineering", "" = untagged). Same approach as
// markets: the scope's distinct functions from the cube, fuzzy-matched, and
// the available list returned on a miss so the model can say what IS
// tracked instead of presenting brand-wide figures as function-specific.
const JOB_FUNCTION_ALIASES: Record<string, string> = {
  hr: 'human resources', people: 'human resources', 'people team': 'human resources',
  it: 'technology', tech: 'technology', software: 'technology',
  engineer: 'engineering', engineers: 'engineering',
  sales: 'sales', marketing: 'marketing', ops: 'operations',
  legal: 'counsel', lawyers: 'counsel', accounting: 'finance',
};

export async function resolveJobFunctionBuckets(
  ctx: ToolContext,
  companyIds: string[],
  requested: string
): Promise<{ buckets: string[]; available: string[] }> {
  const { data } = await ctx.admin.rpc('mcp_list_job_function_buckets', { p_company_ids: companyIds });
  const available = Array.from(
    new Set(((data as string[] | null) || []).map((l) => (l ?? '').trim()).filter((l) => l !== ''))
  ).sort() as string[];
  return { buckets: matchBuckets(available, requested, JOB_FUNCTION_ALIASES), available };
}

// ─── Measurement periods ────────────────────────────────────────────────────
// A wave that is still writing: the batch pipeline has pending/processing
// work for the scope, or the cubes saw new answers within the last two days
// (a fallback for collections that bypass the batch queue).
const IN_FLIGHT_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

export interface MeasurementPeriods {
  months: string[];                   // ISO first-of-month, ascending, measured only
  quarters: string[];                 // "Qn YYYY", ascending
  inProgressQuarter: string | null;   // the latest quarter, only while a wave is writing
  byCompany: Map<string, { months: string[]; answers: number }>; // company_id → its measured months + lifetime answers
}

export async function resolveMeasurementPeriods(
  ctx: ToolContext,
  companyIds: string[],
  buckets: string[] | null,
  jobFunctions: string[] | null = null
): Promise<MeasurementPeriods> {
  const { data, error } = await ctx.admin.rpc('mcp_get_measurement_periods', {
    p_company_ids: companyIds,
    p_buckets: buckets,
    p_job_functions: jobFunctions,
  });
  if (error) throw new Error(`Measurement periods read failed: ${error.message}`);
  const months = Array.from(new Set(((data?.months as unknown[]) || []).map(m => String(m).slice(0, 10)))).sort();
  const quarters = quartersOfMonths(months);
  const latest = quarters[quarters.length - 1] ?? null;

  const lastDay = data?.last_collected_day ? Date.parse(String(data.last_collected_day).slice(0, 10)) : NaN;
  const recentlyWriting = Number.isFinite(lastDay) && (Date.now() - lastDay) < IN_FLIGHT_WINDOW_MS;
  const inProgressQuarter = latest && (data?.active_collection === true || recentlyWriting) ? latest : null;

  const byCompany = new Map<string, { months: string[]; answers: number }>();
  for (const row of ((data?.by_company as any[]) || [])) {
    const ms = Array.from(new Set(((row?.months as unknown[]) || []).map(m => String(m).slice(0, 10)))).sort();
    if (row?.company_id) byCompany.set(String(row.company_id), { months: ms, answers: Number(row?.answers) || 0 });
  }
  return { months, quarters, inProgressQuarter, byCompany };
}

// ─── Resolved scope: the preamble every windowed tool shares ────────────────
export interface ResolvedScope {
  scope: BrandScope;
  buckets: string[] | null;      // null = no location filter
  available: string[];           // the scope's tracked market spellings
  jobFunctions: string[] | null; // null = no job-function filter
  availableJobFunctions: string[];
  periods: MeasurementPeriods;   // every measured period for the scope/location
  months: string[];              // the reported window's months (internal cube filter, never emitted)
  quarters: string[];            // the reported window's quarters, ascending, bare labels
  inProgressQuarter: string | null;
  quartersBack: number;
}

export interface ScopeOptions {
  location?: string;
  jobFunction?: string;
  quartersBack: number;
  includeSiblings: boolean;
}

// Brand scope + optional location match + the last N measured quarters.
// Returns an already-serialized payload (string) on any condition the host
// model should relay verbatim: unknown market, or no data at all.
export async function resolveScope(
  ctx: ToolContext,
  companyId: string,
  opts: ScopeOptions
): Promise<ResolvedScope | string> {
  const scope = await resolveBrandScope(ctx, companyId, opts.includeSiblings);
  if ('error' in scope) return JSON.stringify({ error: scope.error });

  let buckets: string[] | null = null;
  let available: string[] = [];
  if (opts.location && opts.location.trim()) {
    const match = await resolveLocationBuckets(ctx, scope.companyIds, opts.location);
    available = match.available;
    if (!match.buckets.length) {
      return JSON.stringify({
        _coverage: {
          status: 'no_data',
          reason: `No tracked market matches "${opts.location}" for ${scope.brandName}. Answer from the available markets or tell the user this market isn't covered yet.`,
          available_markets: available,
        },
      });
    }
    buckets = match.buckets;
  }

  let jobFunctions: string[] | null = null;
  let availableJobFunctions: string[] = [];
  if (opts.jobFunction && opts.jobFunction.trim()) {
    const match = await resolveJobFunctionBuckets(ctx, scope.companyIds, opts.jobFunction);
    availableJobFunctions = match.available;
    if (!match.buckets.length) {
      return JSON.stringify({
        _coverage: {
          status: 'no_data',
          reason: `No tracked job function matches "${opts.jobFunction}" for ${scope.brandName}. Answer from the available job functions, or give the brand-wide figures and say they are not function-specific.`,
          available_job_functions: availableJobFunctions,
        },
      });
    }
    jobFunctions = match.buckets;
  }

  const periods = await resolveMeasurementPeriods(ctx, scope.companyIds, buckets, jobFunctions);
  if (!periods.months.length) {
    return JSON.stringify({
      _coverage: {
        status: 'no_data',
        reason: `No AI answers have been collected yet for ${scope.brandName}${buckets ? ` in ${buckets.join('/')}` : ''}${jobFunctions ? ` for ${jobFunctions.join('/')} roles` : ''}.`,
        ...(available.length ? { available_markets: available } : {}),
        ...(availableJobFunctions.length ? { available_job_functions: availableJobFunctions } : {}),
      },
      _meta: buildMeta({ scope_companies: scope.companyIds.length, scope_brand: scope.brandName }),
    });
  }

  const window = selectRecentQuarters(periods.months, opts.quartersBack);
  return {
    scope, buckets, available, jobFunctions, availableJobFunctions, periods,
    months: window.months,
    quarters: window.quarters,
    inProgressQuarter: periods.inProgressQuarter,
    quartersBack: opts.quartersBack,
  };
}

// The envelope every windowed result carries. `periods` is the complete list
// of measured quarters in the window; `period_range` is bounded by DATA, so
// "from" is the first measured quarter, never the first calendar quarter the
// caller asked about.
export function metaFor(r: ResolvedScope, extraNotes: string[] = []) {
  const labeled = r.quarters.map(q => labelQuarter(q, r.inProgressQuarter));
  return buildMeta({
    latest_period: labeled[labeled.length - 1] ?? null,
    period_range: labeled.length ? { from: labeled[0], to: labeled[labeled.length - 1] } : null,
    periods: labeled,
    ...(r.inProgressQuarter ? { collection_in_progress: true } : {}),
    scope_companies: r.scope.companyIds.length,
    scope_brand: r.scope.brandName,
    ...(r.buckets ? { locations_matched: r.buckets } : {}),
    ...(r.jobFunctions ? { job_functions_matched: r.jobFunctions } : {}),
    methodology: [METHODOLOGY_NOTES.platform_coverage, METHODOLOGY_NOTES.periods, METHODOLOGY_NOTES.shares, METHODOLOGY_NOTES.filters, ...extraNotes],
  });
}

// " for India, Finance roles" — the scope's active filters, for no-data
// reasons and notes, so a filtered answer never reads as brand-wide.
export function scopeSuffix(r: ResolvedScope): string {
  const parts: string[] = [];
  if (r.buckets) parts.push(r.buckets.join('/'));
  if (r.jobFunctions) parts.push(`${r.jobFunctions.join('/')} roles`);
  return parts.length ? ` for ${parts.join(', ')}` : '';
}

// The same scope narrowed to one of its quarters (for "latest period only"
// payloads such as the overview and metrics — the dashboard's default view).
export function narrowToQuarter(r: ResolvedScope, quarter: string): ResolvedScope {
  return {
    ...r,
    quarters: [quarter],
    months: r.months.filter(m => monthToQuarter(m) === quarter),
  };
}

// Per-quarter answer totals for the window — the denominator behind every
// "% of answers" figure — from the scope stats cube rows.
export function answersByQuarter(scopeStats: any[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of scopeStats) {
    const q = monthToQuarter(String(row.response_month));
    out.set(q, (out.get(q) || 0) + (row.total_responses || 0));
  }
  return out;
}
