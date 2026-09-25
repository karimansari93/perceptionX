import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

type ScopeRow = {
  company_id: string;
  name: string;
  country: string | null;
  locations: string[];
  functions: string[];
  active_prompts: number;
};

type Group = { key: string; name: string; records: ScopeRow[]; locations: string[]; functions: string[]; prompts: number };

const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));

// A record's countries: the markets its prompts cover, or the record's own
// country for older per-country records whose prompts carry no location.
const countriesOf = (r: ScopeRow) => (r.locations.length > 0 ? r.locations : r.country ? [r.country] : []);

const Chips = ({ items, empty }: { items: string[]; empty: string }) =>
  items.length === 0 ? (
    <span className="text-xs text-slate-400">{empty}</span>
  ) : (
    <div className="flex flex-wrap gap-1">
      {items.map((i) => (
        <Badge key={i} variant="outline" className="border-slate-200 bg-slate-50 text-slate-600 text-xs font-normal">
          {i}
        </Badge>
      ))}
    </div>
  );

// What this client is tracked on: each company with the countries and job
// functions its active prompts cover. Companies stored as one record per
// country (older clients) are shown once and expand into those records.
export const OrgCompaniesPanel = ({ organizationId }: { organizationId: string }) => {
  const [rows, setRows] = useState<ScopeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    supabase.rpc('get_org_company_scope' as never, { p_org: organizationId } as never).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setError(error.message);
      else setRows((data ?? []) as unknown as ScopeRow[]);
    });
    return () => { cancelled = true; };
  }, [organizationId]);

  const groups = useMemo<Group[]>(() => {
    const byName = new Map<string, ScopeRow[]>();
    for (const r of rows ?? []) {
      const key = r.name.trim().toLowerCase();
      byName.set(key, [...(byName.get(key) ?? []), r]);
    }
    return [...byName.entries()]
      .map(([key, records]) => ({
        key,
        name: records[0].name.trim(),
        records: [...records].sort((a, b) => countriesOf(a).join().localeCompare(countriesOf(b).join())),
        locations: uniq(records.flatMap(countriesOf)),
        functions: uniq(records.flatMap((r) => r.functions)),
        prompts: records.reduce((n, r) => n + Number(r.active_prompts), 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  if (error) return <p className="text-sm text-red-600">Could not load companies: {error}</p>;
  if (!rows) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }
  if (groups.length === 0) {
    return <p className="text-sm text-slate-500">No companies in this organization yet. Add one from Collection.</p>;
  }

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  return (
    <Card className="border border-slate-200 shadow-sm">
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/80">
              <TableHead className="w-[22%]">Company</TableHead>
              <TableHead>Countries</TableHead>
              <TableHead>Functions</TableHead>
              <TableHead className="text-right whitespace-nowrap">Active prompts</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.flatMap((g) => {
              const multi = g.records.length > 1;
              const expanded = open.has(g.key);
              const head = (
                <TableRow
                  key={g.key}
                  className={multi ? 'cursor-pointer hover:bg-slate-50' : undefined}
                  onClick={multi ? () => toggle(g.key) : undefined}
                >
                  <TableCell className="align-top">
                    <div className="flex items-center gap-1.5 font-medium text-slate-800">
                      {multi && (expanded
                        ? <ChevronDown className="h-4 w-4 text-slate-400" />
                        : <ChevronRight className="h-4 w-4 text-slate-400" />)}
                      {g.name}
                    </div>
                    {multi && <div className="text-xs text-slate-500 pl-5">{g.records.length} country records</div>}
                  </TableCell>
                  <TableCell className="align-top"><Chips items={g.locations} empty="No country" /></TableCell>
                  <TableCell className="align-top"><Chips items={g.functions} empty="All functions" /></TableCell>
                  <TableCell className="align-top text-right text-sm text-slate-700">{g.prompts}</TableCell>
                </TableRow>
              );
              if (!multi || !expanded) return [head];
              return [
                head,
                ...g.records.map((r) => (
                  <TableRow key={r.company_id} className="bg-slate-50/60">
                    <TableCell className="pl-10 text-sm text-slate-600 align-top">{g.name} · {r.country || 'no country set'}</TableCell>
                    <TableCell className="align-top"><Chips items={countriesOf(r)} empty="No country" /></TableCell>
                    <TableCell className="align-top"><Chips items={r.functions} empty="All functions" /></TableCell>
                    <TableCell className="align-top text-right text-sm text-slate-600">{r.active_prompts}</TableCell>
                  </TableRow>
                )),
              ];
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};
