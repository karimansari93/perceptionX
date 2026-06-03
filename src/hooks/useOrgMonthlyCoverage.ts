import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Per-company prompt coverage for a single collection month.
 *
 * "Health" here = did we collect the full scope of prompts for the period?
 *   - Expected scope = every is_active confirmed_prompt for the company (now).
 *   - Covered        = that prompt has >=1 response in the month (any model).
 *   - Missing        = active prompts with zero responses in the month.
 *
 * Bucketing uses prompt_responses.response_month (first-of-month date), which
 * is the same field the dashboard buckets by — so these numbers line up with
 * what users see on the Sources/Visibility tabs.
 */
export type CompanyCoverage = {
  companyId: string;
  name: string;
  industry: string | null;
  country: string | null;
  activeCount: number;
  coveredCount: number;
  missingCount: number;
  // The active prompt ids with no response this month — handed straight to
  // the "Recollect missing" action.
  missingPromptIds: string[];
};

const PAGE_SIZE = 1000;

// [start, end) ISO dates (YYYY-MM-DD) for a "YYYY-MM" month, in UTC.
function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function useOrgMonthlyCoverage(organizationId: string, month: string) {
  const [coverage, setCoverage] = useState<CompanyCoverage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId || !month) return;
    setLoading(true);
    setError(null);
    try {
      // 1. Companies in this org.
      const { data: links, error: linksErr } = await supabase
        .from('organization_companies')
        .select('company_id')
        .eq('organization_id', organizationId);
      if (linksErr) throw linksErr;

      const companyIds = (links || []).map((l: any) => l.company_id);
      if (companyIds.length === 0) {
        setCoverage([]);
        return;
      }

      // 2. Company details.
      const { data: companyData, error: compErr } = await supabase
        .from('companies')
        .select('id, name, industry')
        .in('id', companyIds)
        .order('name');
      if (compErr) throw compErr;

      // 3. Active prompts per company (paginated — orgs like Netflix have 1000s).
      const activeByCompany = new Map<string, string[]>();
      const locationsByCompany = new Map<string, Set<string>>();
      {
        let page = 0;
        let chunk: any[] | null;
        do {
          const from = page * PAGE_SIZE;
          const to = from + PAGE_SIZE - 1;
          const { data, error: pErr } = await supabase
            .from('confirmed_prompts')
            .select('id, company_id, location_context')
            .eq('is_active', true)
            .in('company_id', companyIds)
            // Stable sort key is REQUIRED for correct .range() pagination —
            // without it Postgres returns scans in a non-deterministic order
            // across requests, so OFFSET paging silently drops/duplicates rows
            // (e.g. a whole location going missing from the coverage table).
            .order('id', { ascending: true })
            .range(from, to);
          if (pErr) throw pErr;
          chunk = data ?? [];
          for (const p of chunk) {
            if (!activeByCompany.has(p.company_id)) activeByCompany.set(p.company_id, []);
            activeByCompany.get(p.company_id)!.push(p.id);
            if (p.location_context) {
              if (!locationsByCompany.has(p.company_id)) locationsByCompany.set(p.company_id, new Set());
              locationsByCompany.get(p.company_id)!.add(p.location_context);
            }
          }
          page++;
        } while (chunk && chunk.length === PAGE_SIZE);
      }

      // 4. Prompt ids that already have a response in this month (paginated).
      const { start, end } = monthBounds(month);
      const collected = new Set<string>();
      {
        let page = 0;
        let chunk: any[] | null;
        do {
          const from = page * PAGE_SIZE;
          const to = from + PAGE_SIZE - 1;
          const { data, error: rErr } = await supabase
            .from('prompt_responses')
            .select('confirmed_prompt_id')
            .in('company_id', companyIds)
            .gte('response_month', start)
            .lt('response_month', end)
            // Stable sort key for correct .range() pagination (see note above).
            // Missing rows here would undercount coverage / overcount gaps.
            .order('id', { ascending: true })
            .range(from, to);
          if (rErr) throw rErr;
          chunk = data ?? [];
          for (const r of chunk) collected.add(r.confirmed_prompt_id);
          page++;
        } while (chunk && chunk.length === PAGE_SIZE);
      }

      // 5. Diff.
      const result: CompanyCoverage[] = (companyData || [])
        .map((c: any) => {
          const active = activeByCompany.get(c.id) || [];
          const missingPromptIds = active.filter((id) => !collected.has(id));
          const locs = locationsByCompany.get(c.id);
          let country: string | null = null;
          if (locs && locs.size > 0) {
            const nonGlobal = [...locs].filter(
              (l) => l !== 'GLOBAL' && l !== 'Global (All Countries)'
            );
            country = nonGlobal.length > 0 ? nonGlobal[0] : 'Global';
          }
          return {
            companyId: c.id,
            name: c.name,
            industry: c.industry,
            country,
            activeCount: active.length,
            coveredCount: active.length - missingPromptIds.length,
            missingCount: missingPromptIds.length,
            missingPromptIds,
          };
        })
        .filter((c) => c.activeCount > 0)
        .sort((a, b) => b.missingCount - a.missingCount);

      setCoverage(result);
    } catch (e: any) {
      setError(e?.message || 'Failed to load coverage');
      setCoverage([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, month]);

  useEffect(() => {
    load();
  }, [load]);

  return { coverage, loading, error, reload: load };
}
