import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, Loader2, RefreshCw } from 'lucide-react';

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

type Rows = Record<string, CompanyReadiness | { error: string }>;

// Older clients (Ford, Netflix) have one company record per country; newer
// ones (CSL) one record whose prompts span every market. Records sharing a
// name are shown as one company, rolled up, and expand into their markets.
const rollUp = (rs: CompanyReadiness[]): CompanyReadiness => {
  const sum = (f: (r: CompanyReadiness) => number) => rs.reduce((a, r) => a + f(r), 0);
  const months = rs.map((r) => r.latest_month).filter((m): m is string => !!m).sort();
  return {
    company_id: rs[0].company_id,
    latest_month: months[months.length - 1] ?? null,
    markets: [...new Set(rs.flatMap((r) => r.markets))].sort(),
    active_prompts: sum((r) => r.active_prompts),
    prompts_complete: sum((r) => r.prompts_complete),
    models: [...new Set(rs.flatMap((r) => r.models))],
    responses: sum((r) => r.responses),
    theme_eligible: sum((r) => r.theme_eligible),
    themed: sum((r) => r.themed),
    urls: sum((r) => r.urls),
    urls_scored: sum((r) => r.urls_scored),
    active_jobs: sum((r) => r.active_jobs),
    metrics_pending: rs.some((r) => r.metrics_pending),
  };
};

type Group = { key: string; name: string; members: Company[] };

const collectionDone = (r: CompanyReadiness) =>
  r.active_jobs === 0 && r.active_prompts > 0 && r.responses > 0 && r.prompts_complete === r.active_prompts;

const StatusCard = ({ title, ok, value, hint }: { title: string; ok: boolean; value: string; hint: string }) => (
  <div className={`rounded-lg border p-3 ${ok ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50'}`}>
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
    </div>
    <p className={`mt-1 text-lg font-semibold ${ok ? 'text-emerald-800' : 'text-amber-800'}`}>{value}</p>
    <p className="text-xs text-slate-600 mt-0.5">{hint}</p>
  </div>
);

// The org's pre-flight checklist at a glance: one card per step, rolled up
// across every company. The table below says which company needs what.
const StatusCards = ({ loaded, failed }: { loaded: CompanyReadiness[]; failed: number }) => {
  const n = loaded.length;

  const running = loaded.filter((r) => r.active_jobs > 0).length;
  const notCollected = loaded.filter((r) => r.active_jobs === 0 && r.responses === 0).length;
  const gaps = loaded.filter((r) => r.active_jobs === 0 && r.responses > 0 && !collectionDone(r)).length;
  const collectionOk = running === 0 && notCollected === 0 && gaps === 0;
  const collectionHint = running > 0
    ? `${running} still running`
    : [notCollected && `${notCollected} not collected yet`, gaps && `${gaps} missing answers, use Continue`]
        .filter(Boolean).join(' · ') || 'Every active prompt answered on every model';

  const sum = (f: (r: CompanyReadiness) => number) => loaded.reduce((a, r) => a + f(r), 0);
  const themes = pct(sum((r) => r.themed), sum((r) => r.theme_eligible));
  const recency = pct(sum((r) => r.urls_scored), sum((r) => r.urls));
  const themeGaps = loaded.filter((r) => { const t = pct(r.themed, r.theme_eligible); return t !== null && t < THEMES_READY; }).length;
  const recencyGaps = loaded.filter((r) => { const t = pct(r.urls_scored, r.urls); return t !== null && t < RECENCY_READY; }).length;
  const refreshing = loaded.filter((r) => r.metrics_pending).length;
  const allReady = failed === 0 && loaded.every((r) => statusOf(r).ready);

  return (
    <div className="space-y-2">
      {allReady ? (
        <Check ok>Ready for pre-flight: every check is complete.</Check>
      ) : (
        <p className="text-sm text-slate-600">
          Not ready for pre-flight yet. Companies needing attention are listed first below.
          {failed > 0 && <span className="text-red-600"> {failed} could not be checked.</span>}
        </p>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatusCard
          title="Collection"
          ok={collectionOk}
          value={collectionOk ? 'Complete' : running > 0 ? 'Running' : `${n - notCollected - gaps} of ${n} done`}
          hint={collectionHint}
        />
        <StatusCard
          title="Themes"
          ok={themeGaps === 0}
          value={fmtPct(themes)}
          hint={themeGaps === 0 ? 'Mentioned answers theme-analysed' : `${themeGaps} with gaps, run Analyze themes in Collection`}
        />
        <StatusCard
          title="Recency"
          ok={recencyGaps === 0}
          value={fmtPct(recency)}
          hint={recencyGaps === 0 ? 'Cited URLs scored' : `${recencyGaps} below ${RECENCY_READY * 100}%, queue a rescore in Recency`}
        />
        <StatusCard
          title="Dashboard"
          ok={refreshing === 0}
          value={refreshing === 0 ? 'Up to date' : 'Refreshing'}
          hint={refreshing === 0 ? 'Numbers reflect the latest data' : `${refreshing} companies refreshing, usually within minutes`}
        />
      </div>
    </div>
  );
};

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
  const [rows, setRows] = useState<Rows>({});
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

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const readiness = (c: Company) => {
    const r = rows[c.id];
    return r && !('error' in r) ? r : undefined;
  };

  const groups = useMemo(() => {
    const byName = new Map<string, Group>();
    for (const c of companies) {
      const key = c.name.trim().toLowerCase();
      const g = byName.get(key) ?? { key, name: c.name.trim(), members: [] };
      g.members.push(c);
      byName.set(key, g);
    }
    return [...byName.values()];
  }, [companies]);

  // A group's state: 0 needs attention (or failed), 1 still loading, 2 ready.
  const rankOf = (g: Group) => {
    if (g.members.some((c) => rows[c.id] && 'error' in rows[c.id])) return 0;
    const rs = g.members.map(readiness);
    if (rs.some((r) => !r)) return 1;
    return statusOf(rollUp(rs as CompanyReadiness[])).ready ? 2 : 0;
  };

  const marketLabel = (c: Company) => readiness(c)?.markets.join(', ') || 'No market';

  // Companies needing attention first, then by name; markets inside a group
  // the same way.
  const ordered = useMemo(
    () =>
      [...groups]
        .map((g) => ({
          ...g,
          members: [...g.members].sort((a, b) => {
            const ra = readiness(a), rb = readiness(b);
            const d = (ra ? (statusOf(ra).ready ? 1 : 0) : 0) - (rb ? (statusOf(rb).ready ? 1 : 0) : 0);
            return d !== 0 ? d : marketLabel(a).localeCompare(marketLabel(b));
          }),
        }))
        .sort((a, b) => rankOf(a) - rankOf(b) || a.name.localeCompare(b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, rows],
  );

  if (companies.length === 0) {
    return <p className="text-sm text-slate-500">No companies in this organization yet. Add one from Collection.</p>;
  }

  const allLoaded = companies.every((c) => rows[c.id]);
  const loadedGroups = groups.filter((g) => g.members.every((c) => readiness(c)));
  const failed = groups.length - loadedGroups.length;
  const cols = renderActions ? 6 : 5;

  const cells = (r: CompanyReadiness) => {
    const themes = pct(r.themed, r.theme_eligible);
    const recency = pct(r.urls_scored, r.urls);
    const models = r.models.map((m) => MODEL_LABELS[m] ?? m).join(', ');
    return (
      <>
        <TableCell className="text-sm text-slate-600 whitespace-nowrap">{fmtMonth(r.latest_month)}</TableCell>
        <TableCell>
          {r.active_jobs > 0 ? (
            <Check ok={false}>Running</Check>
          ) : r.responses === 0 ? (
            <Check ok={false}>Not collected</Check>
          ) : (
            <Check ok={collectionDone(r)} title={models ? `Models collected: ${models}` : undefined}>
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
      </>
    );
  };

  const recordRow = (c: Company, title: string, subtitle: string | null, indent: boolean) => {
    const r = rows[c.id];
    const nameCell = (
      <TableCell className={indent ? 'pl-10' : undefined}>
        <div className={indent ? 'text-sm text-slate-700' : 'font-medium text-slate-800'}>{title}</div>
        {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
      </TableCell>
    );
    if (!r) {
      return (
        <TableRow key={c.id}>
          {nameCell}
          <TableCell colSpan={cols}><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></TableCell>
        </TableRow>
      );
    }
    if ('error' in r) {
      return (
        <TableRow key={c.id}>
          {nameCell}
          <TableCell colSpan={cols} className="text-sm text-red-600">Could not check: {r.error}</TableCell>
        </TableRow>
      );
    }
    return (
      <TableRow key={c.id} className={indent ? 'bg-slate-50/60' : undefined}>
        {nameCell}
        {cells(r)}
        {renderActions && <TableCell className="text-right">{renderActions(c, r)}</TableCell>}
      </TableRow>
    );
  };

  return (
    <Card className="border-none shadow-md">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-nightsky flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            Companies ({groups.length})
          </CardTitle>
          <CardDescription>
            Each company in its latest collection month, checked against what must finish before a report is built.
            Companies collected as one record per country expand into their markets.
          </CardDescription>
        </div>
        <Button onClick={load} disabled={loading} variant="outline" size="sm">
          {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
          Recheck
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {allLoaded && (
          <StatusCards
            loaded={loadedGroups.map((g) => rollUp(g.members.map(readiness) as CompanyReadiness[]))}
            failed={failed}
          />
        )}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company · markets</TableHead>
                <TableHead>Month</TableHead>
                <TableHead title="Active prompts with an answer from every model collected that month">Collection</TableHead>
                <TableHead title="Share of answers that mention the company and have been theme-analysed">Themes</TableHead>
                <TableHead title="Share of this month's cited URLs with a recency score">Recency</TableHead>
                <TableHead>Dashboard</TableHead>
                {renderActions && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordered.flatMap((g) => {
                if (g.members.length === 1) {
                  const c = g.members[0];
                  return [recordRow(c, c.name, marketLabel(c), false)];
                }
                const rs = g.members.map(readiness);
                const ready = rs.every(Boolean) ? rollUp(rs as CompanyReadiness[]) : null;
                const open = expanded.has(g.key);
                const needing = rs.filter((r) => r && !statusOf(r).ready).length;
                const header = (
                  <TableRow key={g.key} className="cursor-pointer hover:bg-slate-50" onClick={() => toggle(g.key)}>
                    <TableCell>
                      <div className="flex items-center gap-1.5 font-medium text-slate-800">
                        {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                        {g.name}
                      </div>
                      <div className="text-xs text-slate-500 pl-5">
                        {g.members.length} markets{needing > 0 && ` · ${needing} need attention`}
                      </div>
                    </TableCell>
                    {ready ? (
                      <>
                        {cells(ready)}
                        {renderActions && (
                          <TableCell className="text-right text-xs text-slate-500">
                            {open ? 'Hide markets' : 'Show markets'}
                          </TableCell>
                        )}
                      </>
                    ) : (
                      <TableCell colSpan={cols}><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></TableCell>
                    )}
                  </TableRow>
                );
                return [
                  header,
                  ...(open ? g.members.map((c) => recordRow(c, marketLabel(c), null, true)) : []),
                ];
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
