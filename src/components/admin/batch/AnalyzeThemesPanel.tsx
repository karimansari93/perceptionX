import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Play, CheckCircle2, AlertCircle, X } from "lucide-react";
import { CompanyMultiSelect } from "./CompanyMultiSelect";

// ai-thematic-analysis-bulk processes responses at ~3/sec (batchSize=3 + 1s
// delay between batches) and has the 150s edge timeout. Keep each chunk small
// enough that even a slow OpenAI day stays under the timeout. 40 responses
// ≈ 14 internal batches ≈ ~45-70s wall clock.
const CHUNK_SIZE = 40;

type CompanyProgress = {
  status: "pending" | "fetching" | "processing" | "done" | "error";
  error?: string;
  totalMissing?: number;
  processed?: number;
  themesCreated?: number;
  chunksDone?: number;
  chunksTotal?: number;
};

type Props = {
  organizationId: string;
  onBack: () => void;
};

export const AnalyzeThemesPanel = ({ organizationId, onBack }: Props) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [companyNames, setCompanyNames] = useState<Map<string, string>>(new Map());
  const [companyProgress, setCompanyProgress] = useState<Map<string, CompanyProgress>>(new Map());

  // Scope knobs
  const [onlyMonth, setOnlyMonth] = useState<string>(""); // "YYYY-MM" or ""
  const [clearExisting, setClearExisting] = useState(false);

  const [processing, setProcessing] = useState(false);
  const cancelledRef = useRef(false);

  const handleAnalyze = async () => {
    if (selectedIds.length === 0) {
      toast.error("Select at least one company");
      return;
    }

    setProcessing(true);
    cancelledRef.current = false;

    // Fetch names for display
    const { data: companyRows } = await supabase
      .from("companies")
      .select("id, name")
      .in("id", selectedIds);
    const nameMap = new Map((companyRows || []).map((c: any) => [c.id, c.name]));
    setCompanyNames(nameMap);

    // Init progress
    const initial = new Map<string, CompanyProgress>();
    selectedIds.forEach((id) => initial.set(id, { status: "pending" }));
    setCompanyProgress(initial);

    // Compute month window if user picked one
    let monthStart: string | null = null;
    let monthEnd: string | null = null;
    if (onlyMonth && /^\d{4}-\d{2}$/.test(onlyMonth)) {
      const [y, m] = onlyMonth.split("-").map(Number);
      monthStart = new Date(Date.UTC(y, m - 1, 1)).toISOString();
      monthEnd = new Date(Date.UTC(y, m, 1)).toISOString();
    }

    let succeeded = 0;
    let failed = 0;

    for (const companyId of selectedIds) {
      if (cancelledRef.current) break;

      const name = nameMap.get(companyId) || companyId;
      setCompanyProgress((prev) => {
        const next = new Map(prev);
        next.set(companyId, { status: "fetching" });
        return next;
      });

      try {
        // Two-pass fetch so we only send genuinely un-themed responses to the
        // edge function. An earlier attempt used PostgREST's embedded-resource
        // filter `ai_themes!left(id)` + `.is("ai_themes.id", null)` — that
        // filters the EMBEDDED rows, not the PARENT responses, so it silently
        // returned every response and we wasted hours skip-checking inside
        // the edge function.
        //
        // Pass 1: collect the set of response_ids that already have at least
        //         one ai_themes row for this company.
        // Pass 2: fetch prompt_responses for this company, client-side exclude
        //         any id present in that set.
        //
        // When clearExisting is on, skip pass 1 entirely — the edge function
        // will wipe existing themes and re-analyze every response.
        const PAGE = 1000;
        const themedIds = new Set<string>();

        if (!clearExisting) {
          // Need the response_ids that already have themes FOR THIS COMPANY.
          // Join through prompt_responses so the filter stays scoped.
          let page2Offset = 0;
          for (;;) {
            if (cancelledRef.current) break;
            const { data: themedPage, error: themedErr } = await supabase
              .from("ai_themes")
              .select("response_id, prompt_responses!inner(company_id)")
              .eq("prompt_responses.company_id", companyId)
              .range(page2Offset, page2Offset + PAGE - 1);
            if (themedErr) throw new Error(`themed lookup failed: ${themedErr.message}`);
            for (const row of themedPage || []) {
              themedIds.add((row as any).response_id);
            }
            if (!themedPage || themedPage.length < PAGE) break;
            page2Offset += PAGE;
          }
        }

        if (cancelledRef.current) break;

        // Now fetch prompt_responses and exclude already-themed ids client-side.
        let q = supabase
          .from("prompt_responses")
          .select("id, response_text", { count: "exact" })
          .eq("company_id", companyId)
          .not("for_index", "is", true)
          .not("response_text", "is", null);

        if (monthStart && monthEnd) {
          q = q.gte("tested_at", monthStart).lt("tested_at", monthEnd);
        }

        let from = 0;
        let all: { id: string; response_text: string }[] = [];
        for (;;) {
          if (cancelledRef.current) break;
          const { data: page, error } = await q.range(from, from + PAGE - 1);
          if (error) throw new Error(error.message);
          const rows = (page || [])
            .filter((r: any) =>
              r.response_text &&
              r.response_text.length > 100 &&
              !themedIds.has(r.id),
            )
            .map((r: any) => ({ id: r.id, response_text: r.response_text }));
          all = all.concat(rows);
          if (!page || page.length < PAGE) break;
          from += PAGE;
        }

        if (cancelledRef.current) break;

        if (all.length === 0) {
          setCompanyProgress((prev) => {
            const next = new Map(prev);
            next.set(companyId, { status: "done", totalMissing: 0, themesCreated: 0 });
            return next;
          });
          succeeded++;
          continue;
        }

        const totalMissing = all.length;
        const chunksTotal = Math.ceil(totalMissing / CHUNK_SIZE);
        setCompanyProgress((prev) => {
          const next = new Map(prev);
          next.set(companyId, {
            status: "processing",
            totalMissing,
            processed: 0,
            themesCreated: 0,
            chunksDone: 0,
            chunksTotal,
          });
          return next;
        });

        let themesCreated = 0;
        let processed = 0;
        const errors: string[] = [];

        for (let i = 0; i < all.length; i += CHUNK_SIZE) {
          if (cancelledRef.current) break;
          const chunk = all.slice(i, i + CHUNK_SIZE);

          const { data, error } = await supabase.functions.invoke("ai-thematic-analysis-bulk", {
            body: {
              responses: chunk.map((r) => ({
                response_id: r.id,
                response_text: r.response_text,
              })),
              company_name: name,
              clear_existing: clearExisting,
            },
          });

          if (error) {
            errors.push(error.message);
          } else if (data?.success === false || data?.error) {
            errors.push(data?.error || "Unknown error");
          } else {
            // Edge function returns summary totals — shapes vary slightly, be liberal.
            const s = data?.summary || data?.results?.summary || {};
            themesCreated += Number(s.total_themes_created ?? s.totalThemesCreated ?? 0);
            processed += chunk.length;
          }

          const chunksDone = Math.floor(i / CHUNK_SIZE) + 1;
          setCompanyProgress((prev) => {
            const next = new Map(prev);
            next.set(companyId, {
              status: "processing",
              totalMissing,
              processed,
              themesCreated,
              chunksDone,
              chunksTotal,
            });
            return next;
          });
        }

        if (cancelledRef.current) break;

        setCompanyProgress((prev) => {
          const next = new Map(prev);
          next.set(companyId, {
            status: errors.length > 0 ? "done" : "done",
            totalMissing,
            processed,
            themesCreated,
            chunksDone: chunksTotal,
            chunksTotal,
            error: errors.length > 0 ? `${errors.length} chunk error(s).` : undefined,
          });
          return next;
        });
        succeeded++;
      } catch (err: any) {
        failed++;
        setCompanyProgress((prev) => {
          const next = new Map(prev);
          next.set(companyId, { status: "error", error: err.message });
          return next;
        });
      }
    }

    setProcessing(false);

    if (cancelledRef.current) {
      toast.info("Cancelled.");
    } else if (failed === 0) {
      toast.success(`Theme analysis complete: ${succeeded} compan${succeeded === 1 ? "y" : "ies"} processed.`);
    } else {
      toast.warning(`Theme analysis: ${succeeded} succeeded, ${failed} failed.`);
    }
  };

  const handleCancel = () => {
    cancelledRef.current = true;
    toast.info("Cancelling after current chunk finishes...");
  };

  const completedCount = [...companyProgress.values()].filter((p) => p.status === "done").length;
  const totalCount = companyProgress.size;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={processing}>
          Back
        </Button>
        <h3 className="font-semibold">Analyze Themes</h3>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT: Company selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Select Companies</CardTitle>
            <CardDescription>
              Run AI theme extraction on responses that don't have themes yet.
              Useful when a prior collection run skipped or failed on theme
              analysis and metrics are being computed on half the data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CompanyMultiSelect
              organizationId={organizationId}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
            />
          </CardContent>
        </Card>

        {/* RIGHT: Scope + options */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Scope</CardTitle>
            <CardDescription>
              By default, only responses that currently have zero themes are
              processed. Flip the second toggle to force a re-analysis.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm">Only responses from this month (optional)</Label>
              <Input
                type="month"
                value={onlyMonth}
                onChange={(e) => setOnlyMonth(e.target.value)}
                className="max-w-xs"
                disabled={processing}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to process every response missing themes across all months. Pick a month (e.g. <span className="font-mono">April 2026</span>) to scope to that month only.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label className="text-sm">Clear existing themes and re-analyze</Label>
                <p className="text-xs text-muted-foreground">
                  Off = fill gaps only (recommended). On = wipe and re-extract every response — expensive + overwrites existing data.
                </p>
              </div>
              <Switch checked={clearExisting} onCheckedChange={setClearExisting} disabled={processing} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button onClick={handleAnalyze} disabled={processing || selectedIds.length === 0}>
          {processing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          {processing
            ? `Processing ${completedCount}/${totalCount}...`
            : `Analyze themes for ${selectedIds.length} compan${selectedIds.length === 1 ? "y" : "ies"}`}
        </Button>
        {processing && (
          <Button variant="outline" onClick={handleCancel}>
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
        )}
      </div>

      {/* Progress display */}
      {companyProgress.size > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Progress</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[400px] overflow-y-auto">
              <div className="divide-y">
                {selectedIds.map((id) => {
                  const p = companyProgress.get(id);
                  if (!p) return null;

                  const pct =
                    p.chunksTotal && p.chunksTotal > 0
                      ? ((p.chunksDone || 0) / p.chunksTotal) * 100
                      : undefined;

                  return (
                    <div key={id} className="px-4 py-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {companyNames.get(id) || id.slice(0, 8) + "..."}
                        </span>
                        <div className="flex items-center gap-2">
                          {typeof p.totalMissing === "number" && (
                            <span className="text-xs text-muted-foreground">
                              {p.processed ?? 0}/{p.totalMissing} responses
                              {typeof p.themesCreated === "number" && p.themesCreated > 0 && (
                                <> · {p.themesCreated} themes</>
                              )}
                            </span>
                          )}
                          <Badge
                            variant={
                              p.status === "done" ? "secondary" :
                              p.status === "error" ? "destructive" :
                              p.status === "processing" || p.status === "fetching" ? "default" : "outline"
                            }
                            className={p.status === "done" ? "bg-green-100 text-green-800" : ""}
                          >
                            {p.status === "done" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                            {p.status === "error" && <AlertCircle className="h-3 w-3 mr-1" />}
                            {p.status}
                          </Badge>
                        </div>
                      </div>
                      {p.status === "processing" && pct !== undefined && (
                        <Progress value={pct} className="h-1.5" />
                      )}
                      {p.error && <p className="text-xs text-destructive">{p.error}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
