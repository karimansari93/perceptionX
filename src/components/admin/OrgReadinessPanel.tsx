import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2, RefreshCw } from 'lucide-react';

// Payload of get_company_readiness(): one company's latest month, checked
// against everything that has to finish before a report can be built. Every
// count is computed in the database, so it's right however large the client.
export interface CompanyReadiness {
  company_id: string;
  latest_month: string | null;
  markets: string[];
  active_prompts: number;
  prompts_complete: number;
  models: string[];
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

const MODEL_LABELS: Record<string, string> = {
  openai: 'ChatGPT',
  perplexity: 'Perplexity',
  'google-ai-overviews': 'AI Overviews',
  'google-ai-mode': 'AI Mode',
  claude: 'Claude',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  'bing-copilot': 'Copilot',
};

const pct = (n: number, d: number) => (d === 0 ? null : n / d);
const fmtPct = (v: number | null) => (v === null ? '—' : `${Math.floor(v * 100)}%`);
const fmtMonth = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';

const Check = ({ ok, children, title }: { ok: boolean; children: React.ReactNode; title?: string }) => (
  <span
    title={title}
    className={`inline-flex items-center gap-1 text-sm ${ok ? 'text-emerald-700' : 'text-amber-700'}`}
  >
    {ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
    {children}
  </span>
);

type Company = { id: string; name: string };

type Props = {
  companies: Company[];
  /** Per-row actions (Continue collection, Full refresh), rendered in the last column. */
  renderActions?: (company: Company, readiness: CompanyReadiness | null) => React.ReactNode;
  /** Bump to force a reload, e.g. after a collection run finishes. */
  reloadKey?: number;
};

type Status = { todos: string[]; ready: boolean };

const statusOf = (r: CompanyReadiness): Status => {
  const todos: string[] = [];
  const themes = pct(r.themed, r.theme_eligible);
  const recency = pct(r.urls_scored, r.urls);
  if (r.active_prompts === 0) todos.push('no active prompts');
  else if (r.responses === 0) todos.push('not collected yet');
  if (r.active_jobs > 0) todos.push('collection still running');
  else if (r.responses > 0 && r.prompts_complete < r.active_prompts) todos.push('continue collection to fill missing answers');
  if (themes !== null && themes < THEMES_READY) todos.push('fill theme gaps (Collection → Analyze themes)');
  if (recency !== null && recency < RECENCY_READY) todos.push('queue a recency rescore (Recency)');
  if (r.metrics_pending) todos.push('dashboard numbers still refreshing');
  return { todos, ready: todos.length === 0 };
};

export const OrgReadinessPanel = ({ companies, renderActions, reloadKey = 0 }: Props) => {
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
  }, [idsKey, reloadKey]);

  const label = (c: Company, r?: CompanyReadiness) =>
    r && r.markets.length > 0 ? `${c.name} · ${r.markets.join(', ')}` : c.name;

  // Companies needing attention first, then by name and market.
  const ordered = useMemo(() => {
    const rank = (c: Company) => {
      const r = rows[c.id];
      if (!r) return 1;
      if ('error' in r) return 0;
      return statusOf(r).ready ? 2 : 0;
    };
    return [...companies].sort((a, b) => {
      const d = rank(a) - rank(b);
      if (d !== 0) return d;
      const ra = rows[a.id], rb = rows[b.id];
      const la = label(a, ra && !('error' in ra) ? ra : undefined);
      const lb = label(b, rb && !('error' in rb) ? rb : undefined);
      return la.localeCompare(lb);
    });
  }, [companies, rows]);

  if (companies.length === 0) {
    return <p className="text-sm text-slate-500">No companies in this organization yet. Add one from Collection.</p>;
  }

  const allLoaded = companies.every((c) => rows[c.id]);
  const todos = companies.flatMap((c) => {
    const r = rows[c.id];
    if (!r || 'error' in r) return [];
    return statusOf(r).todos.map((t) => `${label(c, r)}: ${t}`);
  });

  return (
    <Card className="border-none shadow-md">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-nightsky flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            Companies ({companies.length})
          </CardTitle>
          <CardDescription>
            Each company and market in its latest collection month, checked against what must finish before a report is built.
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
              <p className="text-sm font-medium text-amber-800">To do before pre-flight ({todos.length})</p>
              <ul className="list-disc pl-5 text-sm text-amber-800 max-h-48 overflow-y-auto">
                {todos.map((t) => <li key={t}>{t}</li>)}
              </ul>
            </div>
          )
        )}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company · market</TableHead>
                <TableHead>Month</TableHead>
                <TableHead title="Active prompts with an answer from every model collected that month">Collection</TableHead>
                <TableHead title="Share of answers that mention the company and have been theme-analysed">Themes</TableHead>
                <TableHead title="Share of this month's cited URLs with a recency score">Recency</TableHead>
                <TableHead>Dashboard</TableHead>
                {renderActions && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordered.map((c) => {
                const r = rows[c.id];
                const cols = renderActions ? 6 : 5;
                if (!r) {
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell colSpan={cols}><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></TableCell>
                    </TableRow>
                  );
                }
                if ('error' in r) {
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell colSpan={cols} className="text-sm text-red-600">Could not check: {r.error}</TableCell>
                    </TableRow>
                  );
                }
                const themes = pct(r.themed, r.theme_eligible);
                const recency = pct(r.urls_scored, r.urls);
                const models = r.models.map((m) => MODEL_LABELS[m] ?? m).join(', ');
                const collectionOk = r.active_jobs === 0 && r.active_prompts > 0 && r.prompts_complete === r.active_prompts;
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="font-medium text-slate-800">{c.name}</div>
                      <div className="text-xs text-slate-500">{r.markets.join(', ') || 'No market'}</div>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600 whitespace-nowrap">{fmtMonth(r.latest_month)}</TableCell>
                    <TableCell>
                      {r.active_jobs > 0 ? (
                        <Check ok={false}>Running</Check>
                      ) : r.responses === 0 ? (
                        <Check ok={false}>Not collected</Check>
                      ) : (
                        <Check ok={collectionOk} title={models ? `Models collected: ${models}` : undefined}>
                          {r.prompts_complete}/{r.active_prompts} prompts
                          {r.models.length > 0 && <span className="text-slate-500">· {r.models.length} models</span>}
                        </Check>
                      )}
                    </TableCell>
                    <TableCell><Check ok={themes === null || themes >= THEMES_READY}>{fmtPct(themes)}</Check></TableCell>
                    <TableCell><Check ok={recency === null || recency >= RECENCY_READY}>{fmtPct(recency)}</Check></TableCell>
                    <TableCell>
                      <Check ok={!r.metrics_pending}>{r.metrics_pending ? 'Refreshing' : 'Up to date'}</Check>
                    </TableCell>
                    {renderActions && <TableCell className="text-right">{renderActions(c, r)}</TableCell>}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
