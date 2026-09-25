import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2, RefreshCw } from 'lucide-react';

// Payload of get_company_readiness(): one company's latest month, checked
// against everything that has to finish before a report can be built.
interface CompanyReadiness {
  company_id: string;
  latest_month: string | null;
  responses: number;
  theme_eligible: number;
  themed: number;
  urls: number;
  urls_scored: number;
  active_jobs: number;
  metrics_pending: boolean;
}

// Below these shares a check shows as a to-do. Themes should reach every
// eligible response; recency tolerates dead links and paywalled pages that
// can never be scored.
const THEMES_READY = 0.99;
const RECENCY_READY = 0.8;

// One RPC per company keeps each call far below the 8s statement timeout,
// even for orgs with dozens of large companies.
const CONCURRENCY = 4;

const pct = (n: number, d: number) => (d === 0 ? null : n / d);
const fmtPct = (v: number | null) => (v === null ? '—' : `${Math.floor(v * 100)}%`);
const fmtMonth = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';

const Check = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
  <span className={`inline-flex items-center gap-1 text-sm ${ok ? 'text-emerald-700' : 'text-amber-700'}`}>
    {ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
    {children}
  </span>
);

type Props = {
  companies: { id: string; name: string }[];
};

export const OrgReadinessPanel = ({ companies }: Props) => {
  const [rows, setRows] = useState<Record<string, CompanyReadiness | { error: string }>>({});
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setRows({});
    const queue = [...companies];
    const worker = async () => {
      while (queue.length > 0) {
        const c = queue.shift()!;
        const { data, error } = await supabase.rpc('get_company_readiness' as never, { p_company: c.id } as never);
        setRows((prev) => ({
          ...prev,
          [c.id]: error ? { error: error.message } : (data as unknown as CompanyReadiness),
        }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, companies.length) }, worker));
    setLoading(false);
  };

  // Keyed on the id list: the parent rebuilds the companies array on every
  // render, so depending on the array itself would reload in a loop.
  const idsKey = companies.map((c) => c.id).join(',');
  useEffect(() => {
    if (companies.length > 0) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  if (companies.length === 0) return null;

  const todos: string[] = [];
  for (const c of companies) {
    const r = rows[c.id];
    if (!r || 'error' in r) continue;
    const themes = pct(r.themed, r.theme_eligible);
    const recency = pct(r.urls_scored, r.urls);
    if (r.active_jobs > 0) todos.push(`${c.name}: collection still running`);
    if (themes !== null && themes < THEMES_READY) todos.push(`${c.name}: fill theme gaps (Collection → Analyze themes)`);
    if (recency !== null && recency < RECENCY_READY) todos.push(`${c.name}: queue a recency rescore (Recency Coverage)`);
    if (r.metrics_pending) todos.push(`${c.name}: dashboard numbers still refreshing`);
  }
  const allLoaded = companies.every((c) => rows[c.id]);

  return (
    <Card className="border-none shadow-md">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-nightsky flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            Report readiness
          </CardTitle>
          <CardDescription>
            Each company's latest collection month, checked against what must finish before a report is built.
          </CardDescription>
        </div>
        <Button onClick={load} disabled={loading} variant="outline" size="sm">
          {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
          Recheck
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {allLoaded && (
          todos.length === 0 ? (
            <Check ok>Ready for pre-flight: every check below is complete.</Check>
          ) : (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1">
              <p className="text-sm font-medium text-amber-800">To do before pre-flight</p>
              <ul className="list-disc pl-5 text-sm text-amber-800">
                {todos.map((t) => <li key={t}>{t}</li>)}
              </ul>
            </div>
          )
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Month</TableHead>
              <TableHead>Collection</TableHead>
              <TableHead title="Share of responses that mention the company and have been theme-analysed">Themes</TableHead>
              <TableHead title="Share of this month's cited URLs with a recency score">Recency</TableHead>
              <TableHead>Dashboard</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {companies.map((c) => {
              const r = rows[c.id];
              if (!r) {
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell colSpan={5}><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></TableCell>
                  </TableRow>
                );
              }
              if ('error' in r) {
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell colSpan={5} className="text-sm text-red-600">Could not check: {r.error}</TableCell>
                  </TableRow>
                );
              }
              const themes = pct(r.themed, r.theme_eligible);
              const recency = pct(r.urls_scored, r.urls);
              return (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-sm text-slate-600">{fmtMonth(r.latest_month)}</TableCell>
                  <TableCell>
                    {r.responses === 0
                      ? <Check ok={false}>Not collected</Check>
                      : <Check ok={r.active_jobs === 0}>{r.active_jobs === 0 ? 'Done' : 'Running'}</Check>}
                  </TableCell>
                  <TableCell><Check ok={themes === null || themes >= THEMES_READY}>{fmtPct(themes)}</Check></TableCell>
                  <TableCell><Check ok={recency === null || recency >= RECENCY_READY}>{fmtPct(recency)}</Check></TableCell>
                  <TableCell>
                    <Check ok={!r.metrics_pending}>{r.metrics_pending ? 'Refreshing' : 'Up to date'}</Check>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};
