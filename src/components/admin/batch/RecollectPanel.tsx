import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2, Play, CheckCircle2, AlertCircle, X, RefreshCw, Calendar, Server,
} from "lucide-react";
import { useOrgMonthlyCoverage } from "@/hooks/useOrgMonthlyCoverage";

type Props = {
  organizationId: string;
  onBack: () => void;
};

type QueueRow = {
  id: string;
  config_id: string;
  company_id: string | null;
  company_name: string;
  status: "pending" | "processing" | "completed" | "failed";
  phase: string;
  batch_index: number | null;
  total_prompts: number | null;
  error_log: string | null;
  is_cancelled: boolean | null;
};

const isTerminal = (r: QueueRow) =>
  r.is_cancelled === true || r.status === "completed" || r.status === "failed";

// Current month + previous 5, as "YYYY-MM".
function recentMonths(count = 6): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "short", year: "numeric", timeZone: "UTC",
  });
}

export const RecollectPanel = ({ organizationId, onBack }: Props) => {
  const months = useMemo(() => recentMonths(6), []);
  const currentMonth = months[0];
  const [month, setMonth] = useState<string>(currentMonth);
  const { coverage, loading, error, reload } = useOrgMonthlyCoverage(organizationId, month);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [enqueuing, setEnqueuing] = useState(false);

  // Server-side run we're currently watching (survives tab reloads).
  const [runConfigId, setRunConfigId] = useState<string | null>(null);
  const [queueRows, setQueueRows] = useState<QueueRow[]>([]);

  // Recollection writes responses dated to the current month, so it can only
  // fill the current month. Past months are view-only.
  const canRecollect = month === currentMonth;

  // When coverage (re)loads, default-select the companies that have gaps.
  useEffect(() => {
    if (loading) return;
    setSelectedIds(new Set(coverage.filter((c) => c.missingCount > 0).map((c) => c.companyId)));
  }, [coverage, loading]);

  // On mount / org change: adopt any in-flight server-side recollect run so the
  // progress shows up even if the user closed and reopened the tab.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: cfgs } = await supabase
        .from("company_batch_configs")
        .select("id")
        .eq("organization_id", organizationId)
        .not("skip_if_collected_in_month", "is", null)
        .order("created_at", { ascending: false })
        .limit(20);
      const ids = (cfgs || []).map((c: any) => c.id);
      if (ids.length === 0) return;
      const { data: active } = await supabase
        .from("company_batch_queue")
        .select("config_id")
        .in("config_id", ids)
        .in("status", ["pending", "processing"])
        .limit(1);
      if (!cancelled && active && active.length > 0) {
        setRunConfigId((active[0] as any).config_id);
      }
    })();
    return () => { cancelled = true; };
  }, [organizationId]);

  // Poll the watched run's queue rows.
  const pollRun = useCallback(async (configId: string) => {
    const { data } = await supabase
      .from("company_batch_queue")
      .select("id, config_id, company_id, company_name, status, phase, batch_index, total_prompts, error_log, is_cancelled")
      .eq("config_id", configId)
      .order("company_name", { ascending: true });
    setQueueRows((data as QueueRow[]) || []);
    return (data as QueueRow[]) || [];
  }, []);

  useEffect(() => {
    if (!runConfigId) return;
    let stop = false;
    pollRun(runConfigId);
    const interval = setInterval(async () => {
      if (stop) return;
      const rows = await pollRun(runConfigId);
      if (rows.length > 0 && rows.every(isTerminal)) {
        stop = true;
        clearInterval(interval);
        reload(); // refresh coverage now that the run finished
        const failed = rows.filter((r) => r.status === "failed").length;
        if (failed > 0) toast.warning(`Recollection finished with ${failed} failed job(s).`);
        else toast.success("Recollection finished.");
      }
    }, 5000);
    return () => { stop = true; clearInterval(interval); };
  }, [runConfigId, pollRun, reload]);

  const selectedList = useMemo(
    () => coverage.filter((c) => selectedIds.has(c.companyId)),
    [coverage, selectedIds]
  );
  const totalMissingSelected = useMemo(
    () => selectedList.reduce((s, c) => s + c.missingCount, 0),
    [selectedList]
  );

  const runActive = queueRows.length > 0 && !queueRows.every(isTerminal);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const selectWithGaps = () =>
    setSelectedIds(new Set(coverage.filter((c) => c.missingCount > 0).map((c) => c.companyId)));
  const selectAll = () => setSelectedIds(new Set(coverage.map((c) => c.companyId)));
  const selectNone = () => setSelectedIds(new Set());

  // Enqueue a server-side run: one config + one queue row per selected company.
  const handleRecollect = async () => {
    if (selectedList.length === 0) {
      toast.error("Select at least one company");
      return;
    }
    setEnqueuing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Not signed in"); return; }

      // Config carries the month so the queue's llm_collection phase forwards
      // skipIfCollectedInMonth → only prompts missing for this month are run.
      const { data: config, error: cfgErr } = await supabase
        .from("company_batch_configs")
        .insert({
          user_id: user.id,
          company_name: `Recollect ${monthLabel(month)}`,
          org_mode: "existing_org",
          organization_id: organizationId,
          target_locations: [],
          target_industries: [],
          target_job_functions: [],
          skip_if_collected_in_month: month,
        })
        .select("id")
        .single();
      if (cfgErr || !config) throw new Error(cfgErr?.message || "Failed to create batch config");

      // One job per company. Location "Global (All Countries)" + industry
      // "General" tell llm_collection NOT to filter, so it covers every active
      // prompt for the company_id (across its locations/functions).
      const jobs = selectedList.map((c) => ({
        config_id: config.id,
        company_name: c.name,
        company_id: c.companyId,
        location: "Global (All Countries)",
        industry: "General",
        job_function: null,
        status: "pending",
        phase: "llm_collection",
      }));
      const { error: qErr } = await supabase.from("company_batch_queue").insert(jobs);
      if (qErr) throw new Error(qErr.message);

      // Kick the processor once; it self-chains server-side from here.
      await supabase.functions.invoke("process-company-batch-queue", {
        body: { configId: config.id },
      });

      setRunConfigId(config.id);
      toast.success(
        `Queued ${jobs.length} compan${jobs.length === 1 ? "y" : "ies"} for ${monthLabel(month)}. ` +
        `Running in the background — you can close this tab.`
      );
    } catch (e: any) {
      toast.error(`Failed to start recollection: ${e.message}`);
    } finally {
      setEnqueuing(false);
    }
  };

  const handleStop = async () => {
    if (!runConfigId) return;
    // Cancel anything not yet finished; in-flight chunk will still complete.
    await supabase
      .from("company_batch_queue")
      .update({ is_cancelled: true, updated_at: new Date().toISOString() })
      .eq("config_id", runConfigId)
      .in("status", ["pending", "processing"]);
    toast.info("Stopping run — in-flight jobs will finish, the rest are cancelled.");
    pollRun(runConfigId);
  };

  const orgTotals = useMemo(() => {
    const active = coverage.reduce((s, c) => s + c.activeCount, 0);
    const missing = coverage.reduce((s, c) => s + c.missingCount, 0);
    return { active, missing, covered: active - missing, withGaps: coverage.filter((c) => c.missingCount > 0).length };
  }, [coverage]);

  const runStats = useMemo(() => ({
    total: queueRows.length,
    pending: queueRows.filter((r) => r.status === "pending" && !r.is_cancelled).length,
    processing: queueRows.filter((r) => r.status === "processing").length,
    completed: queueRows.filter((r) => r.status === "completed").length,
    failed: queueRows.filter((r) => r.status === "failed").length,
    cancelled: queueRows.filter((r) => r.is_cancelled).length,
  }), [queueRows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={enqueuing}>Back</Button>
        <h3 className="font-semibold">Re-collect Data</h3>
      </div>

      {/* Period + health header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4" /> Coverage health
              </CardTitle>
              <CardDescription>
                Pick the companies to recollect. The run happens server-side, so it keeps going even
                if you close the tab.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={month} onValueChange={setMonth} disabled={enqueuing}>
                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m} value={m}>
                      {monthLabel(m)}{m === currentMonth ? " (current)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={reload} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertCircle className="h-4 w-4" /> {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="outline">{orgTotals.covered.toLocaleString()} covered</Badge>
            {orgTotals.missing > 0 ? (
              <Badge variant="destructive">{orgTotals.missing.toLocaleString()} missing</Badge>
            ) : (
              <Badge variant="secondary" className="bg-green-100 text-green-800">fully covered</Badge>
            )}
            <Badge variant="outline">{orgTotals.withGaps} with gaps</Badge>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Select:</span>
            <button className="underline hover:no-underline" onClick={selectWithGaps}>with gaps</button>
            <button className="underline hover:no-underline" onClick={selectAll}>all</button>
            <button className="underline hover:no-underline" onClick={selectNone}>none</button>
          </div>

          <ScrollArea className="h-[300px] border rounded-md">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading coverage…
              </div>
            ) : coverage.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">
                No companies with active prompts in this organization.
              </p>
            ) : (
              <div className="divide-y">
                {coverage.map((c) => {
                  const health = c.activeCount > 0 ? Math.round((c.coveredCount / c.activeCount) * 100) : 0;
                  return (
                    <div
                      key={c.companyId}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-accent/40 cursor-pointer"
                      onClick={() => toggle(c.companyId)}
                    >
                      <Checkbox checked={selectedIds.has(c.companyId)} onCheckedChange={() => toggle(c.companyId)} />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium truncate">{c.name}</span>
                        {c.country && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-2">{c.country}</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 text-xs">
                        <span className="text-muted-foreground">{c.coveredCount}/{c.activeCount}</span>
                        {c.missingCount > 0 ? (
                          <Badge variant="destructive" className="text-xs">{c.missingCount} missing</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs bg-green-100 text-green-800">100%</Badge>
                        )}
                        <span className="w-9 text-right text-muted-foreground">{health}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Action */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={handleRecollect}
          disabled={enqueuing || loading || selectedList.length === 0 || runActive || !canRecollect}
        >
          {enqueuing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Server className="h-4 w-4 mr-2" />}
          Recollect {monthLabel(month)} ({selectedList.length} compan{selectedList.length === 1 ? "y" : "ies"})
        </Button>
        <span className="text-xs text-muted-foreground">
          {totalMissingSelected.toLocaleString()} missing prompts in selection
        </span>
      </div>

      {!canRecollect && (
        <p className="text-xs text-amber-600">
          Viewing a past month. Recollection always fills the current month ({monthLabel(currentMonth)}),
          so switch to it to run.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Runs on the server queue: it collects every prompt with no response for {monthLabel(currentMonth)},
        skipping what's already collected this month, and self-resumes if a chunk stalls. Safe to close the tab.
      </p>

      {/* Live run progress (server-side) */}
      {queueRows.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-sm flex items-center gap-2">
                <Server className="h-4 w-4" /> Server-side run
                {runActive && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </CardTitle>
              <div className="flex items-center gap-2">
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {runStats.processing > 0 && <Badge>{runStats.processing} running</Badge>}
                  {runStats.pending > 0 && <Badge variant="outline">{runStats.pending} pending</Badge>}
                  <Badge variant="secondary" className="bg-green-100 text-green-800">{runStats.completed} done</Badge>
                  {runStats.failed > 0 && <Badge variant="destructive">{runStats.failed} failed</Badge>}
                  {runStats.cancelled > 0 && <Badge variant="outline" className="text-orange-600">{runStats.cancelled} cancelled</Badge>}
                </div>
                {runActive && (
                  <Button variant="outline" size="sm" onClick={handleStop}>
                    <X className="h-4 w-4 mr-1" /> Stop
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[220px]">
              <div className="divide-y">
                {queueRows.map((r) => {
                  const total = r.total_prompts || 0;
                  const done = r.batch_index || 0;
                  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
                  return (
                    <div key={r.id} className="px-3 py-2 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{r.company_name}</span>
                        <Badge
                          variant={
                            r.is_cancelled ? "outline" :
                            r.status === "completed" ? "secondary" :
                            r.status === "failed" ? "destructive" :
                            r.status === "processing" ? "default" : "outline"
                          }
                          className={r.status === "completed" ? "bg-green-100 text-green-800" : ""}
                        >
                          {r.status === "completed" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                          {r.status === "failed" && <AlertCircle className="h-3 w-3 mr-1" />}
                          {r.is_cancelled ? "cancelled" : r.status}
                        </Badge>
                      </div>
                      {r.status !== "completed" && total > 0 && (
                        <div className="flex items-center gap-2">
                          <Progress value={pct} className="h-1.5 flex-1" />
                          <span className="text-[10px] text-muted-foreground w-16 text-right">{done}/{total}</span>
                        </div>
                      )}
                      {r.error_log && <p className="text-xs text-destructive">{r.error_log}</p>}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
