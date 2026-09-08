// ─── chat-with-data: question scope ─────────────────────────────────────────
// The dashboard's filters (company, markets, job functions) travel with a
// question so the analyst answers for that slice — and so the answer says
// so. Two halves:
//   * getScopeOptions — the organization's brands, tracked markets and job
//     functions (the same spellings the tools match against), for the scope
//     pickers in the chat and the overview box;
//   * scopeNote — the text block appended to the user turn that tells the
//     analyst which location / job_function filters the user has chosen.
//     Several markets or functions mean one filtered call each, compared
//     side by side (the tools take one filter value per call).
// Nothing here touches the system prompt (the cached prefix) or the tools.

import { executeTool } from '../_shared/px-tools/mod.ts';
import type { ToolContext } from '../_shared/px-tools/mod.ts';

export interface ChatScope {
  company?: string | null;
  locations: string[];
  jobFunctions: string[];
}

export interface ScopeOptions {
  brands: string[];
  brand: string | null;
  markets: string[];
  job_functions: string[];
  /** The brand's latest measured period ("Q3 2026"), for the read-only period chip. */
  period: string | null;
}

const MAX_PICKS = 6;

function distinct(values: unknown): string[] {
  return Array.from(new Set(((values as unknown[]) || []).map(v => String(v ?? '').trim()).filter(Boolean))).sort();
}

function cleanList(v: unknown, single: unknown): string[] {
  const raw = Array.isArray(v) ? v : (typeof single === 'string' ? [single] : []);
  return Array.from(new Set(raw
    .map(x => (typeof x === 'string' ? x.trim().slice(0, 120) : ''))
    .filter(Boolean))).slice(0, MAX_PICKS);
}

// Accepts the current shape ({locations, jobFunctions}) and the earlier
// single-value one ({location, jobFunction}).
export function normalizeScope(raw: unknown): ChatScope {
  if (!raw || typeof raw !== 'object') return { locations: [], jobFunctions: [] };
  const o = raw as Record<string, unknown>;
  const company = typeof o.company === 'string' && o.company.trim() ? o.company.trim().slice(0, 120) : null;
  return {
    company,
    locations: cleanList(o.locations, o.location),
    jobFunctions: cleanList(o.jobFunctions, o.jobFunction),
  };
}

// Brands (distinct company names) plus the tracked markets and job functions
// of one brand's scope (the busiest brand when none is named).
export async function getScopeOptions(ctx: ToolContext, company?: string | null): Promise<ScopeOptions> {
  const list = JSON.parse(await executeTool(ctx, 'list_companies', {}));
  const companies: any[] = (list?.companies as any[]) || [];
  const byBrand = new Map<string, { name: string; ids: string[]; answers: number; periods: string[] }>();
  for (const c of companies) {
    const key = String(c.name || '').trim().toLowerCase();
    if (!key) continue;
    const e = byBrand.get(key) || { name: String(c.name).trim(), ids: [], answers: 0, periods: [] };
    e.ids.push(c.id); e.answers += Number(c.total_responses) || 0;
    const p = typeof c.latest_period === 'string' ? c.latest_period.replace(/ \(in progress\)$/, '') : '';
    if (/^Q[1-4] \d{4}$/.test(p)) e.periods.push(p);
    byBrand.set(key, e);
  }
  const quarterKey = (q: string) => { const m = q.match(/^Q(\d) (\d{4})/); return m ? `${m[2]}-${m[1]}` : q; };
  const brands = Array.from(byBrand.values()).sort((a, b) => b.answers - a.answers || a.name.localeCompare(b.name));
  const wanted = company ? byBrand.get(company.trim().toLowerCase()) : undefined;
  const brand = wanted ?? brands[0];
  if (!brand) return { brands: [], brand: null, markets: [], job_functions: [], period: null };
  const period = brand.periods.sort((a, b) => quarterKey(a).localeCompare(quarterKey(b))).pop() ?? null;

  const [marketsRes, functionsRes] = await Promise.all([
    ctx.admin.rpc('mcp_list_location_buckets', { p_company_ids: brand.ids }),
    ctx.admin.rpc('mcp_list_job_function_buckets', { p_company_ids: brand.ids }),
  ]);
  return {
    brands: brands.map(b => b.name),
    brand: brand.name,
    markets: distinct(marketsRes.data),
    job_functions: distinct(functionsRes.data),
    period,
  };
}

const quoteList = (items: string[]) => items.map(i => `"${i}"`).join(', ');

// The scope block appended to the user turn. Empty when nothing is filtered
// (brand-wide is the rulebook's default and needs no note).
export function scopeNote(scope: ChatScope): string | null {
  if (!scope.locations.length && !scope.jobFunctions.length) return null;
  const parts: string[] = [];
  if (scope.company) parts.push(`company: ${scope.company}`);
  if (scope.locations.length) parts.push(`market${scope.locations.length > 1 ? 's' : ''}: ${scope.locations.join(', ')}`);
  if (scope.jobFunctions.length) parts.push(`job function${scope.jobFunctions.length > 1 ? 's' : ''}: ${scope.jobFunctions.join(', ')}`);

  const how: string[] = [];
  if (scope.locations.length === 1) how.push(`pass location ${quoteList(scope.locations)}`);
  if (scope.locations.length > 1) how.push(`call the market-aware tools once per market (location ${quoteList(scope.locations)}, in parallel) and compare the markets side by side`);
  if (scope.jobFunctions.length === 1) how.push(`pass job_function ${quoteList(scope.jobFunctions)}`);
  if (scope.jobFunctions.length > 1) how.push(`call the tools once per job function (job_function ${quoteList(scope.jobFunctions)}, in parallel) and compare the functions side by side`);

  return `[Question scope chosen by the user — ${parts.join('; ')}. Answer for this scope: ${how.join('; ')} on the market-aware tools, state the scope in the answer, and if a market or function is not tracked say so and give the brand-wide figure instead.]`;
}
