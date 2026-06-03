import { useState, useRef, useEffect, useMemo } from "react";
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
  Loader2, Play, CheckCircle2, AlertCircle, X, RefreshCw, Calendar,
} from "lucide-react";
import { useAdminCompanyCollection } from "@/hooks/useAdminCompanyCollection";
import { useOrgMonthlyCoverage, type CompanyCoverage } from "@/hooks/useOrgMonthlyCoverage";

type CompanyProgress = {
  status: "pending" | "processing" | "done" | "error";
  error?: string;
  progress?: { completed: number; total: number };
};

type Props = {
  organizationId: string;
  onBack: () => void;
};

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
  const [month, setMonth] = useState<string>(months[0]);
  const { coverage, loading, error, reload } = useOrgMonthlyCoverage(organizationId, month);
  const { runCollection } = useAdminCompanyCollection();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [companyProgress, setCompanyProgress] = useState<Map<string, CompanyProgress>>(new Map());
  const [processing, setProcessing] = useState(false);
  const [currentCompanyId, setCurrentCompanyId] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  // When coverage (re)loads, default-select the companies that have gaps.
  useEffect(() => {
    if (loading) return;
    setSelectedIds(new Set(coverage.filter((c) => c.missingCount > 0).map((c) => c.companyId)));
  }, [coverage, loading]);

  // Poll live progress for the company currently being collected.
  useEffect(() => {
    if (!currentCompanyId || !processing) return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("companies")
        .select("data_collection_progress")
        .eq("id", currentCompanyId)
        .single();
      if (data?.data_collection_progress) {
        const p = data.data_collection_progress as { completed: number; total: number };
        setCompanyProgress((prev) => {
          const next = new Map(prev);
          const existing = next.get(currentCompanyId) || { status: "processing" as const };
          next.set(currentCompanyId, { ...existing, progress: p });
          return next;
        });
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [currentCompanyId, processing]);

  const selectedList = useMemo(
    () => coverage.filter((c) => selectedIds.has(c.companyId)),
    [coverage, selectedIds]
  );

  const totalMissingSelected = useMemo(
    () => selectedList.reduce((sum, c) => sum + c.missingCount, 0),
    [selectedList]
  );

  const totalActiveSelected = useMemo(
    () => selectedList.reduce((sum, c) => sum + c.activeCount, 0),
    [selectedList]
  );

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

  // Run collection for a list of companies sequentially, with progress.
  // mode "missing" → only the company's missing prompts for the month.
  // mode "full"    → re-collect every active prompt (ignores existing).
  const runFor = async (companies: CompanyCoverage[], mode: "missing" | "full") => {
    if (companies.length === 0) {
      toast.error("Select at least one company");
      return;
    }
    if (mode === "missing" && companies.every((c) => c.missingCount === 0)) {
      toast.info(`Nothing missing for ${monthLabel(month)} — all selected companies are complete.`);
      return;
    }

    setProcessing(true);
    cancelledRef.current = false;

    const initial = new Map<string, CompanyProgress>();
    companies.forEach((c) => initial.set(c.companyId, { status: "pending" }));
    setCompanyProgress(initial);

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (const c of companies) {
      if (cancelledRef.current) break;

      // In "missing" mode, skip companies that are already complete.
      if (mode === "missing" && c.missingCount === 0) {
        skipped++;
        setCompanyProgress((prev) => {
          const next = new Map(prev);
          next.set(c.companyId, { status: "done" });
          return next;
        });
        continue;
      }

      setCurrentCompanyId(c.companyId);
      setCompanyProgress((prev) => {
        const next = new Map(prev);
        next.set(c.companyId, { status: "processing" });
        return next;
      });

      const ok = await runCollection(c.companyId, organizationId, c.name, {
        skipExisting: false,
        ...(mode === "missing"
          ? { promptIds: c.missingPromptIds, skipIfCollectedInMonth: month }
          : {}),
      });

      setCompanyProgress((prev) => {
        const next = new Map(prev);
        next.set(c.companyId, ok ? { status: "done" } : { status: "error", error: "Collection failed" });
        return next;
      });
      ok ? succeeded++ : failed++;
    }

    setCurrentCompanyId(null);
    setProcessing(false);

    if (cancelledRef.current) {
      toast.info("Re-collection cancelled.");
    } else if (failed === 0) {
      toast.success(`Done: ${succeeded} processed${skipped ? `, ${skipped} already complete` : ""}.`);
    } else {
      toast.warning(`Done: ${succeeded} succeeded, ${failed} failed.`);
    }

    // Refresh coverage so the table reflects the newly collected prompts.
    reload();
  };

  const handleCancel = () => {
    cancelledRef.current = true;
    toast.info("Cancelling after current company finishes...");
  };

  const completedCount = [...companyProgress.values()].filter((p) => p.status === "done").length;
  const totalCount = companyProgress.size;

  // Org-level rollup for the header.
  const orgTotals = useMemo(() => {
    const active = coverage.reduce((s, c) => s + c.activeCount, 0);
    const missing = coverage.reduce((s, c) => s + c.missingCount, 0);
    const companiesWithGaps = coverage.filter((c) => c.missingCount > 0).length;
    return { active, missing, covered: active - missing, companiesWithGaps };
  }, [coverage]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={processing}>
          Back
        </Button>
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
                See coverage for a month, then recollect everything (e.g. a fresh month) or just the
                gaps for the companies you pick.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={month} onValueChange={setMonth} disabled={processing}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={reload} disabled={loading || processing}>
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

          {/* Org rollup */}
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="outline">{orgTotals.covered.toLocaleString()} covered</Badge>
            {orgTotals.missing > 0 ? (
              <Badge variant="destructive">{orgTotals.missing.toLocaleString()} missing</Badge>
            ) : (
              <Badge variant="secondary" className="bg-green-100 text-green-800">fully covered</Badge>
            )}
            <Badge variant="outline">{orgTotals.companiesWithGaps} compan{orgTotals.companiesWithGaps === 1 ? "y" : "ies"} with gaps</Badge>
          </div>

          {/* Selection helpers */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Select:</span>
            <button className="underline hover:no-underline" onClick={selectWithGaps} disabled={processing}>with gaps</button>
            <button className="underline hover:no-underline" onClick={selectAll} disabled={processing}>all</button>
            <button className="underline hover:no-underline" onClick={selectNone} disabled={processing}>none</button>
          </div>

          {/* Coverage table */}
          <ScrollArea className="h-[340px] border rounded-md">
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
                  const prog = companyProgress.get(c.companyId);
                  const health = c.activeCount > 0 ? Math.round((c.coveredCount / c.activeCount) * 100) : 0;
                  return (
                    <div
                      key={c.companyId}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-accent/40 cursor-pointer"
                      onClick={() => !processing && toggle(c.companyId)}
                    >
                      <Checkbox
                        checked={selectedIds.has(c.companyId)}
                        onCheckedChange={() => toggle(c.companyId)}
                        disabled={processing}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{c.name}</span>
                          {c.country && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{c.country}</Badge>
                          )}
                          {prog?.status === "processing" && (
                            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                          )}
                          {prog?.status === "done" && (
                            <CheckCircle2 className="h-3 w-3 text-green-600" />
                          )}
                          {prog?.status === "error" && (
                            <AlertCircle className="h-3 w-3 text-destructive" />
                          )}
                        </div>
                        {prog?.status === "processing" && prog.progress && prog.progress.total > 0 && (
                          <Progress
                            value={(prog.progress.completed / prog.progress.total) * 100}
                            className="h-1 mt-1"
                          />
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

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Original behaviour: recollect every active prompt for the selected
            companies. This is how you stand up a fresh month for a company. */}
        <Button
          onClick={() => runFor(selectedList, "full")}
          disabled={processing || loading || selectedList.length === 0}
        >
          {processing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          {processing
            ? `Processing ${completedCount}/${totalCount}…`
            : `Recollect all (${totalActiveSelected.toLocaleString()} prompts)`}
        </Button>

        {/* New: only the prompts with no response for the selected month. */}
        <Button
          variant="outline"
          onClick={() => runFor(selectedList, "missing")}
          disabled={processing || loading || selectedList.length === 0 || totalMissingSelected === 0}
        >
          Recollect missing only ({totalMissingSelected.toLocaleString()} for {monthLabel(month)})
        </Button>

        {processing && (
          <Button variant="ghost" onClick={handleCancel}>
            <X className="h-4 w-4 mr-2" /> Cancel
          </Button>
        )}

        <span className="text-xs text-muted-foreground">
          {selectedList.length} selected
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        <strong>Recollect all</strong> re-runs every active prompt for the selected companies — use it to
        collect a fresh month. <strong>Recollect missing only</strong> runs just the prompts with no
        response for {monthLabel(month)}, skipping what's already collected. Either way, new responses are
        dated to the current month.
      </p>
    </div>
  );
};
