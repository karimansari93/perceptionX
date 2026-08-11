import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Loader2,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  HeartPulse,
  Database,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';

// Rows returned by admin_data_health_overview(): one per organization with
// aggregated issue counts across every (company, location, function) combo.
interface OrgHealthRow {
  organization_id: string;
  organization_name: string;
  company_count: number;
  completed_company_count: number;
  collecting_company_count: number;
  combo_count: number;
  no_response_combos: number;
  no_theme_combos: number;
  mv_missing_combos: number;
  stale_company_count: number;
  latest_collected: string | null;
}

// Rows returned by admin_data_health_org(): one per (company, location, function).
interface ComboHealthRow {
  company_id: string;
  company_name: string;
  country: string | null;
  location_context: string;
  job_function_context: string;
  prompts: number;
  active_prompts: number;
  responses: number;
  sentiment_responses: number;
  themes: number;
  mv_present: boolean;
  issues: string[];
}

// Payload of get_analysis_health(): the post-collection readiness check —
// "is this cycle's analysis done?" in one call.
interface AnalysisHealth {
  generated_at: string;
  collection: {
    active: boolean;
    latest_cycle: string | null;
    responses_in_latest_cycle: number;
    last_response_at: string | null;
  };
  themes: {
    latest_cycle_missing_for_mentioned: number;
    last_theme_created_at: string | null;
    edge_invocation_failures_24h: number;
  };
  entity_suggestions: { pending: number; approved: number };
  rollups: {
    companies_awaiting_refresh: number;
    company_rollups_refreshed_at: string | null;
    by_location_oldest_refresh: string | null;
    by_location_views_stale_6h: number;
    last_refresh_errors: { mv: string; error: string | null }[];
  };
}

// Rows returned by admin_mv_refresh_status(): one per rollup materialized view.
interface MvStatusRow {
  mv_name: string;
  last_refresh_finished: string | null;
  last_status: string | null;
  last_error: string | null;
  last_duration_ms: number | null;
  row_count: number | null;
  is_stale: boolean;
  force_refresh: boolean;
}

const ISSUE_LABELS: Record<string, { label: string; title: string }> = {
  no_responses: {
    label: 'No responses',
    title: 'Active prompts exist but nothing has been collected for this combo',
  },
  no_themes: {
    label: 'No themes',
    title: 'Sentiment/competitive responses exist but were never theme-analysed — sentiment will be null',
  },
  mv_missing: {
    label: 'MV missing',
    title:
      'This location has themes but is absent from the by-location rollup — the dashboard shows null when this location is filtered. A metrics refresh fixes it.',
  },
};

const issueTotal = (o: OrgHealthRow) =>
  o.no_response_combos + o.no_theme_combos + o.mv_missing_combos + o.stale_company_count;

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : 'Never');

const fmtAgo = (iso: string | null) => {
  if (!iso) return 'never';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const IssueBadge = ({ kind, count }: { kind: string; count?: number }) => {
  const meta = ISSUE_LABELS[kind] ?? { label: kind, title: kind };
  return (
    <Badge
      variant="outline"
      title={meta.title}
      className="border-red-200 bg-red-50 text-red-700 text-xs whitespace-nowrap"
    >
      {meta.label}
      {count !== undefined ? ` · ${count}` : ''}
    </Badge>
  );
};

export const DataHealthTab = () => {
  const [orgs, setOrgs] = useState<OrgHealthRow[]>([]);
  const [mvStatus, setMvStatus] = useState<MvStatusRow[]>([]);
  const [analysisHealth, setAnalysisHealth] = useState<AnalysisHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [mvExpanded, setMvExpanded] = useState(false);
  const [requestingRefresh, setRequestingRefresh] = useState(false);

  // Drilldown state
  const [selectedOrg, setSelectedOrg] = useState<OrgHealthRow | null>(null);
  const [combos, setCombos] = useState<ComboHealthRow[]>([]);
  const [combosLoading, setCombosLoading] = useState(false);
  const [issuesOnly, setIssuesOnly] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [overviewRes, mvRes, healthRes] = await Promise.all([
        supabase.rpc('admin_data_health_overview' as never),
        supabase.rpc('admin_mv_refresh_status' as never),
        supabase.rpc('get_analysis_health' as never),
      ]);
      if (overviewRes.error) throw overviewRes.error;
      if (mvRes.error) throw mvRes.error;
      setOrgs((overviewRes.data as unknown as OrgHealthRow[]) || []);
      setMvStatus((mvRes.data as unknown as MvStatusRow[]) || []);
      // Readiness check is additive — a failure here shouldn't blank the tab.
      if (healthRes.error) {
        console.warn('get_analysis_health failed:', healthRes.error);
        setAnalysisHealth(null);
      } else {
        setAnalysisHealth(healthRes.data as unknown as AnalysisHealth);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to load data health: ${msg}`);
      setOrgs([]);
      setMvStatus([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openOrg = async (org: OrgHealthRow) => {
    setSelectedOrg(org);
    setCombosLoading(true);
    // Default the drilldown filter to problem rows when the org has issues.
    setIssuesOnly(issueTotal(org) > 0);
    try {
      const { data, error } = await supabase.rpc('admin_data_health_org' as never, {
        p_org: org.organization_id,
      } as never);
      if (error) throw error;
      setCombos((data as unknown as ComboHealthRow[]) || []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to load organization detail: ${msg}`);
      setCombos([]);
    } finally {
      setCombosLoading(false);
    }
  };

  const requestMetricsRefresh = async () => {
    setRequestingRefresh(true);
    try {
      const { data, error } = await supabase.rpc('request_company_metrics_refresh' as never);
      if (error) throw error;
      const mvs = (data as unknown as { mvs?: number })?.mvs;
      toast.success(
        `Metrics refresh queued${mvs ? ` (${mvs} views)` : ''} — the background tick drains one view per minute.`
      );
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to queue refresh: ${msg}`);
    } finally {
      setRequestingRefresh(false);
    }
  };

  const mvSummary = useMemo(() => {
    const stale = mvStatus.filter((m) => m.is_stale).length;
    const errors = mvStatus.filter((m) => m.last_status === 'error').length;
    const running = mvStatus.filter((m) => m.last_status === 'running').length;
    const oldest = mvStatus.reduce<string | null>(
      (acc, m) =>
        !m.last_refresh_finished || (acc && m.last_refresh_finished < acc)
          ? m.last_refresh_finished
          : acc,
      mvStatus[0]?.last_refresh_finished ?? null
    );
    return { stale, errors, running, oldest, total: mvStatus.length };
  }, [mvStatus]);

  // Drilldown rows, grouped per company so a company's locations sit together.
  const visibleCombos = useMemo(
    () => (issuesOnly ? combos.filter((c) => c.issues.length > 0) : combos),
    [combos, issuesOnly]
  );

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin text-slate-400 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Checking data health…</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- drilldown
  if (selectedOrg) {
    const totalIssues = visibleCombos.reduce((n, c) => n + c.issues.length, 0);
    return (
      <div className="space-y-4">
        <Button
          onClick={() => {
            setSelectedOrg(null);
            setCombos([]);
          }}
          variant="ghost"
          className="text-slate-600 hover:text-slate-900 -ml-2"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to organizations
        </Button>

        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-headline font-bold text-slate-900">
              {selectedOrg.organization_name}
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              {selectedOrg.company_count} companies · {selectedOrg.combo_count} location/function
              combos · last collected {fmtDate(selectedOrg.latest_collected)}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <Switch checked={issuesOnly} onCheckedChange={setIssuesOnly} />
            Issues only
          </label>
        </div>

        <Card className="border-slate-200">
          <CardContent className="pt-4">
            {combosLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : visibleCombos.length === 0 ? (
              <div className="text-center py-10">
                <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                <p className="text-slate-600">
                  {issuesOnly
                    ? 'No issues found — every location and function combo is healthy.'
                    : 'No prompt combos found for this organization.'}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Function</TableHead>
                    <TableHead className="text-right">Prompts</TableHead>
                    <TableHead className="text-right">Responses</TableHead>
                    <TableHead className="text-right">Themes</TableHead>
                    <TableHead>Health</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleCombos.map((c, i) => {
                    const prevRow = visibleCombos[i - 1];
                    const firstOfCompany = !prevRow || prevRow.company_id !== c.company_id;
                    return (
                      <TableRow key={`${c.company_id}|${c.location_context}|${c.job_function_context}`}>
                        <TableCell className={firstOfCompany ? 'font-medium text-slate-900' : 'text-slate-300'}>
                          {firstOfCompany ? (
                            <div>
                              {c.company_name}
                              {c.country && (
                                <span className="text-xs text-slate-400 font-normal ml-1.5">
                                  {c.country}
                                </span>
                              )}
                            </div>
                          ) : (
                            '〃'
                          )}
                        </TableCell>
                        <TableCell className="text-slate-700">
                          {c.location_context || <span className="text-slate-400">General</span>}
                        </TableCell>
                        <TableCell className="text-slate-700">
                          {c.job_function_context || <span className="text-slate-400">All</span>}
                        </TableCell>
                        <TableCell className="text-right text-slate-700">
                          {c.active_prompts}
                          {c.prompts !== c.active_prompts && (
                            <span className="text-xs text-slate-400"> /{c.prompts}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-slate-700">{c.responses}</TableCell>
                        <TableCell className="text-right text-slate-700">{c.themes}</TableCell>
                        <TableCell>
                          {c.issues.length === 0 ? (
                            <Badge
                              variant="outline"
                              className="border-emerald-200 bg-emerald-50 text-emerald-700 text-xs"
                            >
                              Healthy
                            </Badge>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {c.issues.map((issue) => (
                                <IssueBadge key={issue} kind={issue} />
                              ))}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            {!combosLoading && visibleCombos.length > 0 && (
              <p className="text-xs text-slate-400 mt-3">
                {visibleCombos.length} combos shown · {totalIssues} issue
                {totalIssues === 1 ? '' : 's'}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ----------------------------------------------------------------- overview
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-headline font-bold text-slate-900 flex items-center gap-2">
            <HeartPulse className="h-6 w-6 text-slate-500" />
            Data Health
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Organization-level health: collection gaps, missing themes, and stale rollup views that
            cause null data on the dashboard.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="border-slate-200">
          <RefreshCw className="h-4 w-4 mr-2" />
          Reload
        </Button>
      </div>

      {/* Post-collection readiness: the "is this cycle's analysis done?" strip.
          Data changes quarterly — after a collection, every item here should
          go green before the quarter is presented to a client. */}
      {analysisHealth && (
        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-slate-800 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-slate-500" />
              Analysis readiness
              <span className="text-sm font-normal text-slate-500">
                cycle {analysisHealth.collection.latest_cycle ?? '—'} ·{' '}
                {analysisHealth.collection.responses_in_latest_cycle.toLocaleString()} responses ·
                last collected {fmtDate(analysisHealth.collection.last_response_at)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-md border border-slate-200 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Collection</div>
                {analysisHealth.collection.active ? (
                  <div className="flex items-center gap-1.5 text-amber-600 font-medium text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" /> Collecting…
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-emerald-600 font-medium text-sm">
                    <CheckCircle2 className="h-4 w-4" /> Complete
                  </div>
                )}
              </div>
              <div className="rounded-md border border-slate-200 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Themes (this cycle)</div>
                {analysisHealth.themes.latest_cycle_missing_for_mentioned === 0 ? (
                  <div className="flex items-center gap-1.5 text-emerald-600 font-medium text-sm">
                    <CheckCircle2 className="h-4 w-4" /> Complete
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-amber-600 font-medium text-sm">
                    <AlertTriangle className="h-4 w-4" />
                    {analysisHealth.themes.latest_cycle_missing_for_mentioned.toLocaleString()} responses pending
                  </div>
                )}
                {analysisHealth.themes.edge_invocation_failures_24h > 0 && (
                  <div className="flex items-center gap-1.5 text-red-600 text-xs mt-1">
                    <XCircle className="h-3.5 w-3.5" />
                    {analysisHealth.themes.edge_invocation_failures_24h} pipeline call failures (24h)
                  </div>
                )}
              </div>
              <div className="rounded-md border border-slate-200 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Entity suggestions</div>
                {analysisHealth.entity_suggestions.pending === 0 ? (
                  <div className="flex items-center gap-1.5 text-emerald-600 font-medium text-sm">
                    <CheckCircle2 className="h-4 w-4" /> Reviewed
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-amber-600 font-medium text-sm">
                    <AlertTriangle className="h-4 w-4" />
                    {analysisHealth.entity_suggestions.pending} awaiting review
                  </div>
                )}
                <div className="text-xs text-slate-500 mt-1">Entity Canonicalization tab</div>
              </div>
              <div className="rounded-md border border-slate-200 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Metric rollups</div>
                {analysisHealth.rollups.last_refresh_errors.length > 0 ? (
                  <div className="flex items-center gap-1.5 text-red-600 font-medium text-sm">
                    <XCircle className="h-4 w-4" />
                    {analysisHealth.rollups.last_refresh_errors.length} failing
                  </div>
                ) : analysisHealth.rollups.companies_awaiting_refresh > 0 ||
                  analysisHealth.rollups.by_location_views_stale_6h > 0 ? (
                  <div className="flex items-center gap-1.5 text-amber-600 font-medium text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {analysisHealth.rollups.companies_awaiting_refresh > 0
                      ? `${analysisHealth.rollups.companies_awaiting_refresh} companies refreshing`
                      : `${analysisHealth.rollups.by_location_views_stale_6h} location views stale`}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-emerald-600 font-medium text-sm">
                    <CheckCircle2 className="h-4 w-4" /> Fresh
                  </div>
                )}
                <div className="text-xs text-slate-500 mt-1">
                  locations {fmtAgo(analysisHealth.rollups.by_location_oldest_refresh)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rollup MV freshness — the machinery behind every dashboard metric */}
      <Card className="border-slate-200">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <button
              className="flex items-center gap-2 text-left"
              onClick={() => setMvExpanded((v) => !v)}
            >
              {mvExpanded ? (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronRight className="h-4 w-4 text-slate-400" />
              )}
              <CardTitle className="text-base text-slate-800 flex items-center gap-2">
                <Database className="h-4 w-4 text-slate-500" />
                Metric rollups
              </CardTitle>
              <span className="text-sm text-slate-500">
                {mvSummary.errors > 0 ? (
                  <span className="text-red-600 font-medium">
                    {mvSummary.errors} failing
                  </span>
                ) : mvSummary.stale > 0 ? (
                  <span className="text-amber-600 font-medium">
                    {mvSummary.stale}/{mvSummary.total} refreshing
                  </span>
                ) : (
                  <span className="text-emerald-600 font-medium">all fresh</span>
                )}
                {' · oldest '}
                {fmtAgo(mvSummary.oldest)}
              </span>
            </button>
            <Button
              size="sm"
              variant="outline"
              className="border-slate-200"
              disabled={requestingRefresh}
              onClick={requestMetricsRefresh}
            >
              {requestingRefresh ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Refresh all metrics
            </Button>
          </div>
        </CardHeader>
        {mvExpanded && (
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Materialized view</TableHead>
                  <TableHead>Last refreshed</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mvStatus.map((m) => (
                  <TableRow key={m.mv_name}>
                    <TableCell className="font-mono text-xs text-slate-700">{m.mv_name}</TableCell>
                    <TableCell className="text-slate-600 text-sm" title={m.last_refresh_finished ?? ''}>
                      {fmtAgo(m.last_refresh_finished)}
                    </TableCell>
                    <TableCell className="text-right text-slate-600 text-sm">
                      {m.last_duration_ms != null ? `${(m.last_duration_ms / 1000).toFixed(1)}s` : '—'}
                    </TableCell>
                    <TableCell className="text-right text-slate-600 text-sm">
                      {m.row_count != null ? m.row_count.toLocaleString() : '—'}
                    </TableCell>
                    <TableCell>
                      {m.last_status === 'error' ? (
                        <Badge
                          variant="outline"
                          className="border-red-200 bg-red-50 text-red-700 text-xs"
                          title={m.last_error ?? ''}
                        >
                          <XCircle className="h-3 w-3 mr-1" />
                          Error
                        </Badge>
                      ) : m.is_stale || m.force_refresh ? (
                        <Badge
                          variant="outline"
                          className="border-amber-200 bg-amber-50 text-amber-700 text-xs"
                          title="Base data changed since this view's last refresh — the background tick will pick it up"
                        >
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          {m.last_status === 'running' ? 'Refreshing' : 'Queued'}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-emerald-200 bg-emerald-50 text-emerald-700 text-xs"
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Fresh
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>

      {/* Organizations ranked by health */}
      <Card className="border-slate-200">
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead className="text-right">Companies</TableHead>
                <TableHead className="text-right">Combos</TableHead>
                <TableHead>Last collected</TableHead>
                <TableHead>Health</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...orgs]
                .sort((a, b) => issueTotal(b) - issueTotal(a))
                .map((o) => {
                  const issues = issueTotal(o);
                  return (
                    <TableRow
                      key={o.organization_id}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => openOrg(o)}
                    >
                      <TableCell className="font-medium text-slate-900">
                        {o.organization_name}
                      </TableCell>
                      <TableCell className="text-right text-slate-700">
                        {o.completed_company_count}/{o.company_count}
                        {o.collecting_company_count > 0 && (
                          <span
                            className="text-xs text-blue-500 ml-1.5"
                            title={`${o.collecting_company_count} collecting now`}
                          >
                            ({o.collecting_company_count} running)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-slate-700">{o.combo_count}</TableCell>
                      <TableCell className="text-slate-600 text-sm">
                        {fmtDate(o.latest_collected)}
                      </TableCell>
                      <TableCell>
                        {issues === 0 ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-200 bg-emerald-50 text-emerald-700 text-xs"
                          >
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Healthy
                          </Badge>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {o.no_response_combos > 0 && (
                              <IssueBadge kind="no_responses" count={o.no_response_combos} />
                            )}
                            {o.no_theme_combos > 0 && (
                              <IssueBadge kind="no_themes" count={o.no_theme_combos} />
                            )}
                            {o.mv_missing_combos > 0 && (
                              <IssueBadge kind="mv_missing" count={o.mv_missing_combos} />
                            )}
                            {o.stale_company_count > 0 && (
                              <Badge
                                variant="outline"
                                title="Collected after the oldest rollup refresh — may show stale numbers until the background tick catches up"
                                className="border-amber-200 bg-amber-50 text-amber-700 text-xs whitespace-nowrap"
                              >
                                Stale rollups · {o.stale_company_count}
                              </Badge>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <ArrowRight className="h-4 w-4 text-slate-300 inline" />
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
