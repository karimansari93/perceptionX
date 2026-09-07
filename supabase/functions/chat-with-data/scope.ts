// ─── chat-with-data: question scope ─────────────────────────────────────────
// The dashboard's filters (company, market, job function) travel with a
// question so the analyst answers for that slice — and so the answer says
// so. Two halves:
//   * getScopeOptions — the organization's brands, tracked markets and job
//     functions (the same spellings the tools match against), for the chat's
//     scope bar;
//   * scopeNote — the text block appended to the user turn that tells the
//     analyst which location / job_function filters the user has applied.
// Nothing here touches the system prompt (the cached prefix) or the tools.

import { executeTool } from '../_shared/px-tools/mod.ts';
import type { ToolContext } from '../_shared/px-tools/mod.ts';

export interface ChatScope {
  company?: string | null;
  location?: string | null;
  jobFunction?: string | null;
}

export interface ScopeOptions {
  brands: string[];
  brand: string | null;
  markets: string[];
  job_functions: string[];
}

function distinct(values: unknown): string[] {
  return Array.from(new Set(((values as unknown[]) || []).map(v => String(v ?? '').trim()).filter(Boolean))).sort();
}

export function normalizeScope(raw: unknown): ChatScope {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);
  return { company: clean(o.company), location: clean(o.location), jobFunction: clean(o.jobFunction) };
}

// Brands (distinct company names) plus the tracked markets and job functions
// of one brand's scope (the busiest brand when none is named).
export async function getScopeOptions(ctx: ToolContext, company?: string | null): Promise<ScopeOptions> {
  const list = JSON.parse(await executeTool(ctx, 'list_companies', {}));
  const companies: any[] = (list?.companies as any[]) || [];
  const byBrand = new Map<string, { name: string; ids: string[]; answers: number }>();
  for (const c of companies) {
    const key = String(c.name || '').trim().toLowerCase();
    if (!key) continue;
    const e = byBrand.get(key) || { name: String(c.name).trim(), ids: [], answers: 0 };
    e.ids.push(c.id); e.answers += Number(c.total_responses) || 0;
    byBrand.set(key, e);
  }
  const brands = Array.from(byBrand.values()).sort((a, b) => b.answers - a.answers || a.name.localeCompare(b.name));
  const wanted = company ? byBrand.get(company.trim().toLowerCase()) : undefined;
  const brand = wanted ?? brands[0];
  if (!brand) return { brands: [], brand: null, markets: [], job_functions: [] };

  const [marketsRes, functionsRes] = await Promise.all([
    ctx.admin.rpc('mcp_list_location_buckets', { p_company_ids: brand.ids }),
    ctx.admin.rpc('mcp_list_job_function_buckets', { p_company_ids: brand.ids }),
  ]);
  return {
    brands: brands.map(b => b.name),
    brand: brand.name,
    markets: distinct(marketsRes.data),
    job_functions: distinct(functionsRes.data),
  };
}

// The scope block appended to the user turn. Empty when nothing is filtered
// (brand-wide is the rulebook's default and needs no note).
export function scopeNote(scope: ChatScope): string | null {
  const parts: string[] = [];
  if (scope.company) parts.push(`company: ${scope.company}`);
  if (scope.location) parts.push(`market: ${scope.location}`);
  if (scope.jobFunction) parts.push(`job function: ${scope.jobFunction}`);
  if (!scope.location && !scope.jobFunction) return null;
  return `[Question scope set by the user's dashboard filters — ${parts.join('; ')}. Answer for this scope: pass ${
    [scope.location ? `location "${scope.location}"` : null, scope.jobFunction ? `job_function "${scope.jobFunction}"` : null].filter(Boolean).join(' and ')
  } to the market-aware tools, say the scope in the answer, and if a filter is not tracked say so and give the brand-wide figure instead.]`;
}
