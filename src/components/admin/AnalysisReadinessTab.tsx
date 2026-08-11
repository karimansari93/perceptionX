import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ClipboardCheck,
} from 'lucide-react';
import { toast } from 'sonner';

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

type Status = 'ok' | 'pending' | 'error';

const StatusLine = ({ status, children }: { status: Status; children: React.ReactNode }) => (
  <div
    className={
      status === 'ok'
        ? 'flex items-center gap-1.5 text-emerald-600 font-medium text-sm'
        : status === 'pending'
          ? 'flex items-center gap-1.5 text-amber-600 font-medium text-sm'
          : 'flex items-center gap-1.5 text-red-600 font-medium text-sm'
    }
  >
    {status === 'ok' ? (
      <CheckCircle2 className="h-4 w-4" />
    ) : status === 'pending' ? (
      <AlertTriangle className="h-4 w-4" />
    ) : (
      <XCircle className="h-4 w-4" />
    )}
    {children}
  </div>
);

export const AnalysisReadinessTab = () => {
  const [health, setHealth] = useState<AnalysisHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestingRefresh, setRequestingRefresh] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_analysis_health' as never);
      if (error) throw error;
      setHealth(data as unknown as AnalysisHealth);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to load analysis readiness: ${msg}`);
      setHealth(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const requestMetricsRefresh = async () => {
    setRequestingRefresh(true);
    try {
      const { error } = await supabase.rpc('request_company_metrics_refresh' as never);
      if (error) throw error;
      toast.success('Metrics refresh queued — the background tick drains it over the next hour.');
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to queue refresh: ${msg}`);
    } finally {
      setRequestingRefresh(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin text-slate-400 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Checking analysis readiness…</p>
        </div>
      </div>
    );
  }

  if (!health) {
    return (
      <div className="text-center py-16">
        <p className="text-slate-500 mb-4">Couldn't load the readiness check.</p>
        <Button variant="outline" onClick={load}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Try again
        </Button>
      </div>
    );
  }

  const themesOk = health.themes.latest_cycle_missing_for_mentioned === 0;
  const suggestionsOk = health.entity_suggestions.pending === 0;
  const rollupErrors = health.rollups.last_refresh_errors.length;
  const rollupsBusy =
    health.rollups.companies_awaiting_refresh > 0 || health.rollups.by_location_views_stale_6h > 0;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-headline font-bold text-slate-900 flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-slate-500" />
            Analysis Readiness
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            The post-collection checklist: when every card is green, the cycle is ready to present.
            Checked {fmtAgo(health.generated_at)}.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="border-slate-200">
          <RefreshCw className="h-4 w-4 mr-2" />
          Re-check
        </Button>
      </div>

      <Card className="border-slate-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-slate-800">
            Cycle {health.collection.latest_cycle ?? '—'}
            <span className="text-sm font-normal text-slate-500 ml-2">
              {health.collection.responses_in_latest_cycle.toLocaleString()} responses · last
              collected {fmtDate(health.collection.last_response_at)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-md border border-slate-200 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Collection</div>
              {health.collection.active ? (
                <div className="flex items-center gap-1.5 text-amber-600 font-medium text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Collecting…
                </div>
              ) : (
                <StatusLine status="ok">Complete</StatusLine>
              )}
              <p className="text-xs text-slate-500 mt-2">
                Response collection for the latest cycle.
              </p>
            </div>

            <div className="rounded-md border border-slate-200 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Themes</div>
              <StatusLine status={themesOk ? 'ok' : 'pending'}>
                {themesOk
                  ? 'Complete'
                  : `${health.themes.latest_cycle_missing_for_mentioned.toLocaleString()} responses pending`}
              </StatusLine>
              {health.themes.edge_invocation_failures_24h > 0 && (
                <StatusLine status="error">
                  {health.themes.edge_invocation_failures_24h} pipeline call failures (24h)
                </StatusLine>
              )}
              <p className="text-xs text-slate-500 mt-2">
                Theme extraction for this cycle's mentioned responses. Last theme produced{' '}
                {fmtDate(health.themes.last_theme_created_at)}.
              </p>
            </div>

            <div className="rounded-md border border-slate-200 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">
                Entity suggestions
              </div>
              <StatusLine status={suggestionsOk ? 'ok' : 'pending'}>
                {suggestionsOk
                  ? 'Reviewed'
                  : `${health.entity_suggestions.pending} awaiting review`}
              </StatusLine>
              <p className="text-xs text-slate-500 mt-2">
                Competitor name merges — review in the Data Cleanup tab, then refresh metrics.
              </p>
            </div>

            <div className="rounded-md border border-slate-200 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">
                Metric rollups
              </div>
              {rollupErrors > 0 ? (
                <StatusLine status="error">{rollupErrors} failing</StatusLine>
              ) : rollupsBusy ? (
                <div className="flex items-center gap-1.5 text-amber-600 font-medium text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {health.rollups.companies_awaiting_refresh > 0
                    ? `${health.rollups.companies_awaiting_refresh} companies refreshing`
                    : `${health.rollups.by_location_views_stale_6h} location views stale`}
                </div>
              ) : (
                <StatusLine status="ok">Fresh</StatusLine>
              )}
              <p className="text-xs text-slate-500 mt-2">
                Dashboard numbers derive from these. Locations refreshed{' '}
                {fmtAgo(health.rollups.by_location_oldest_refresh)}.
              </p>
            </div>
          </div>

          {rollupErrors > 0 && (
            <div className="mt-3 text-xs text-red-600">
              {health.rollups.last_refresh_errors.map((e) => (
                <div key={e.mv}>
                  <span className="font-mono">{e.mv}</span>: {e.error ?? 'unknown error'}
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center gap-3 flex-wrap">
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
            <span className="text-xs text-slate-500">
              Run this after finishing an analysis pass (themes + entity review) so the dashboard
              reflects it.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
