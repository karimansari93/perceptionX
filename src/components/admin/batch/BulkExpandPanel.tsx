import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Play, Plus, X, CheckCircle2, AlertCircle, Trash2 } from "lucide-react";

const JOB_FUNCTION_SUGGESTIONS = [
  "Engineering", "Product", "Marketing", "Finance", "HR",
  "Sales", "Operations", "Legal", "Design", "Data",
  "Content & Production", "Product & Technology", "Finance & Operations",
  "Talent", "Legal", "Customer Service",
];

type CompanyOption = {
  id: string;
  name: string;
  industry: string | null;
  country: string | null; // resolved primary location_context, if any
};

type BulkRow = {
  rowId: string;           // local key
  companyId: string;
  jobFunctions: string[];
};

type RunProgress = {
  status: "pending" | "processing" | "done" | "error";
  jobsDone: number;
  jobsTotal: number;
  error?: string;
  progress?: { completed: number; total: number };
};

type Props = {
  organizationId: string;
  onBack: () => void;
};

export const BulkExpandPanel = ({ organizationId, onBack }: Props) => {
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [rows, setRows] = useState<BulkRow[]>([
    { rowId: crypto.randomUUID(), companyId: "", jobFunctions: [] },
  ]);
  const [jobFunctionInputs, setJobFunctionInputs] = useState<Map<string, string>>(new Map());

  const [processing, setProcessing] = useState(false);
  const [rowProgress, setRowProgress] = useState<Map<string, RunProgress>>(new Map());
  const cancelledRef = useRef(false);

  useEffect(() => {
    loadCompanies();
  }, [organizationId]);

  const loadCompanies = async () => {
    setLoadingCompanies(true);
    try {
      const { data: links } = await supabase
        .from("organization_companies")
        .select("company_id")
        .eq("organization_id", organizationId);

      const ids = (links || []).map((l: any) => l.company_id);
      if (ids.length === 0) {
        setCompanies([]);
        return;
      }

      const { data: rows } = await supabase
        .from("companies")
        .select("id, name, industry")
        .in("id", ids)
        .order("name");

      // Fetch the primary country for each company (most common location_context).
      // Paginate — PostgREST caps at 1000 rows per request and we commonly have
      // many more confirmed_prompts across an org's companies, so a single
      // unpaginated query would drop later companies' countries entirely.
      const PAGE_SIZE = 1000;
      let allPromptRows: any[] = [];
      let page = 0;
      let chunk: any[] | null;
      do {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const { data } = await supabase
          .from("confirmed_prompts")
          .select("company_id, location_context")
          .in("company_id", ids)
          .eq("is_active", true)
          .not("location_context", "is", null)
          .range(from, to);
        chunk = data ?? [];
        allPromptRows = allPromptRows.concat(chunk);
        page++;
      } while (chunk && chunk.length === PAGE_SIZE);

      const countryByCompany = new Map<string, string>();
      const countBy = new Map<string, Map<string, number>>();
      for (const p of allPromptRows) {
        const cid = (p as any).company_id as string;
        const loc = (p as any).location_context as string;
        if (!countBy.has(cid)) countBy.set(cid, new Map());
        const inner = countBy.get(cid)!;
        inner.set(loc, (inner.get(loc) || 0) + 1);
      }
      for (const [cid, inner] of countBy) {
        const top = [...inner.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (top) countryByCompany.set(cid, top);
      }

      setCompanies(
        (rows || []).map((r: any) => ({
          id: r.id,
          name: r.name,
          industry: r.industry,
          country: countryByCompany.get(r.id) || null,
        })),
      );
    } finally {
      setLoadingCompanies(false);
    }
  };

  const addRow = () =>
    setRows((prev) => [...prev, { rowId: crypto.randomUUID(), companyId: "", jobFunctions: [] }]);

  const removeRow = (rowId: string) =>
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.rowId !== rowId) : prev));

  const updateRow = (rowId: string, patch: Partial<BulkRow>) =>
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));

  const addFunction = (rowId: string, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setRows((prev) =>
      prev.map((r) =>
        r.rowId === rowId && !r.jobFunctions.includes(trimmed)
          ? { ...r, jobFunctions: [...r.jobFunctions, trimmed] }
          : r,
      ),
    );
    setJobFunctionInputs((prev) => {
      const next = new Map(prev);
      next.set(rowId, "");
      return next;
    });
  };

  const removeFunction = (rowId: string, fn: string) =>
    setRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, jobFunctions: r.jobFunctions.filter((f) => f !== fn) } : r)),
    );

  const handleRunAll = async () => {
    // Validate
    const validRows = rows.filter((r) => r.companyId && r.jobFunctions.length > 0);
    if (validRows.length === 0) {
      toast.error("Add at least one company with at least one job function");
      return;
    }

    // Check each company has a country (bulk panel appends only — no new countries).
    const missing = validRows.filter((r) => {
      const c = companies.find((x) => x.id === r.companyId);
      return !c?.country;
    });
    if (missing.length > 0) {
      const names = missing.map((r) => companies.find((c) => c.id === r.companyId)?.name).filter(Boolean);
      toast.error(
        `${names.join(", ")} ${names.length === 1 ? "has" : "have"} no country set. Use "Expand coverage" for those first.`,
      );
      return;
    }

    setProcessing(true);
    cancelledRef.current = false;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setProcessing(false); return; }

    // Initialize progress
    const initial = new Map<string, RunProgress>();
    validRows.forEach((r) => initial.set(r.rowId, { status: "pending", jobsDone: 0, jobsTotal: r.jobFunctions.length }));
    setRowProgress(initial);

    // -------- Phase 1: create configs + insert queue rows for every row --------
    const configIdsByRow = new Map<string, string>();
    const totalJobsByRow = new Map<string, number>();

    for (const row of validRows) {
      if (cancelledRef.current) break;
      const company = companies.find((c) => c.id === row.companyId)!;

      try {
        // Existing combos for dedup
        const { data: existingPrompts } = await supabase
          .from("confirmed_prompts")
          .select("location_context, industry_context, job_function_context")
          .eq("company_id", company.id)
          .eq("is_active", true);

        const existingCombos = new Set(
          (existingPrompts || []).map((p: any) =>
            `${p.location_context || ""}|${p.industry_context || ""}|${p.job_function_context || ""}`,
          ),
        );

        // Resolve industry preference from prompts > companies.industry > "General"
        const industryCounts = new Map<string, number>();
        for (const p of existingPrompts || []) {
          const ind = (p as any).industry_context;
          if (ind) industryCounts.set(ind, (industryCounts.get(ind) || 0) + 1);
        }
        const effectiveIndustry =
          [...industryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || company.industry || "General";
        const effectiveCountry = company.country!; // validated above

        // Create config
        const { data: config } = await supabase
          .from("company_batch_configs")
          .insert({
            user_id: user.id,
            company_name: company.name,
            org_mode: "existing_org",
            organization_id: organizationId,
            target_locations: [effectiveCountry],
            target_industries: [],
            target_job_functions: row.jobFunctions,
          })
          .select("id")
          .single();

        if (!config) throw new Error("Failed to create batch config");

        // Build queue jobs: one per new function (skipping combos that already exist).
        const jobs: any[] = [];
        for (const jf of row.jobFunctions) {
          const key = `${effectiveCountry}|${effectiveIndustry}|${jf}`;
          if (!existingCombos.has(key)) {
            jobs.push({
              config_id: config.id,
              company_name: company.name,
              company_id: company.id,
              location: effectiveCountry,
              industry: effectiveIndustry,
              job_function: jf,
              status: "pending",
              phase: "expand_setup",
            });
          }
        }

        if (jobs.length > 0) {
          await supabase.from("company_batch_queue").insert(jobs);
        }

        configIdsByRow.set(row.rowId, config.id);
        totalJobsByRow.set(row.rowId, jobs.length);

        setRowProgress((prev) => {
          const next = new Map(prev);
          next.set(row.rowId, {
            status: jobs.length === 0 ? "done" : "pending",
            jobsDone: 0,
            jobsTotal: jobs.length,
          });
          return next;
        });
      } catch (err: any) {
        setRowProgress((prev) => {
          const next = new Map(prev);
          next.set(row.rowId, { status: "error", jobsDone: 0, jobsTotal: row.jobFunctions.length, error: err.message });
          return next;
        });
      }
    }

    // -------- Phase 2: kick the processor once per config --------
    const allConfigIds = Array.from(configIdsByRow.values());
    for (const cid of allConfigIds) {
      if (cancelledRef.current) break;
      if ((totalJobsByRow.get(
        [...configIdsByRow.entries()].find(([, v]) => v === cid)![0],
      ) || 0) === 0) continue;

      await supabase.functions.invoke("process-company-batch-queue", {
        body: { configId: cid },
      });
    }

    // -------- Phase 3: poll until every row's queue rows are terminal --------
    const POLL_MS = 4000;
    while (!cancelledRef.current) {
      // Any rows still needing work?
      const waiting = Array.from(configIdsByRow.entries()).filter(([rowId]) => {
        const p = rowProgress.get(rowId);
        return !p || (p.status !== "done" && p.status !== "error");
      });
      if (waiting.length === 0) break;

      // Fetch statuses for all configs in play
      const { data: queueRows } = await supabase
        .from("company_batch_queue")
        .select("config_id, status, error_log")
        .in("config_id", allConfigIds);

      // Group by config
      const byConfig = new Map<string, { total: number; done: number; failed: number; firstError?: string }>();
      for (const r of queueRows || []) {
        const k = (r as any).config_id as string;
        if (!byConfig.has(k)) byConfig.set(k, { total: 0, done: 0, failed: 0 });
        const s = byConfig.get(k)!;
        s.total++;
        if ((r as any).status === "completed") s.done++;
        else if ((r as any).status === "failed") {
          s.failed++;
          if (!s.firstError) s.firstError = (r as any).error_log || "Job failed";
        }
      }

      let allTerminal = true;
      for (const [rowId, cid] of configIdsByRow) {
        const s = byConfig.get(cid);
        const totalJobs = totalJobsByRow.get(rowId) || 0;
        if (totalJobs === 0) continue;

        const terminalCount = (s?.done || 0) + (s?.failed || 0);
        const isTerminal = s && terminalCount >= s.total && s.total > 0;
        if (!isTerminal) allTerminal = false;

        setRowProgress((prev) => {
          const next = new Map(prev);
          const existing = next.get(rowId) || { status: "processing" as const, jobsDone: 0, jobsTotal: totalJobs };
          if (isTerminal) {
            if (s!.failed > 0) {
              next.set(rowId, {
                ...existing,
                status: "error",
                jobsDone: s!.done,
                jobsTotal: s!.total,
                error: s!.firstError,
              });
            } else {
              next.set(rowId, { ...existing, status: "done", jobsDone: s!.done, jobsTotal: s!.total });
            }
          } else {
            next.set(rowId, {
              ...existing,
              status: "processing",
              jobsDone: s?.done || 0,
              jobsTotal: s?.total || totalJobs,
            });
          }
          return next;
        });
      }

      if (allTerminal) break;

      await new Promise((r) => setTimeout(r, POLL_MS));
    }

    setProcessing(false);

    const finalStates = [...rowProgress.values()];
    const ok = finalStates.filter((s) => s.status === "done").length;
    const bad = finalStates.filter((s) => s.status === "error").length;
    if (cancelledRef.current) {
      toast.info("Cancelled. Background queue may still finish any in-flight jobs.");
    } else if (bad === 0) {
      toast.success(`Bulk expand complete: ${ok} row${ok === 1 ? "" : "s"} processed.`);
    } else {
      toast.warning(`Bulk expand: ${ok} succeeded, ${bad} with errors.`);
    }
  };

  const handleCancel = () => {
    cancelledRef.current = true;
    toast.info("Cancelling polling. Backend will still finish in-flight jobs.");
  };

  const usedCompanyIds = new Set(rows.map((r) => r.companyId).filter(Boolean));
  const totalCombos = rows.reduce((sum, r) => sum + (r.companyId && r.jobFunctions.length > 0 ? r.jobFunctions.length : 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={processing}>
          Back
        </Button>
        <h3 className="font-semibold">Bulk Expand Coverage</h3>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Per-company job function additions</CardTitle>
          <CardDescription>
            Add a row for each country's Netflix (or any company) and list the job functions you want to collect.
            Each company must already have a country set — use "Expand coverage" to set a country on a country-less company first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingCompanies ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading companies...
            </div>
          ) : (
            <>
              {rows.map((row) => {
                const company = companies.find((c) => c.id === row.companyId);
                const p = rowProgress.get(row.rowId);
                const pct = p && p.jobsTotal > 0 ? (p.jobsDone / p.jobsTotal) * 100 : 0;

                return (
                  <div key={row.rowId} className="rounded-md border p-3 space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-2 items-start">
                      {/* Company picker */}
                      <div className="space-y-1">
                        <Label className="text-xs">Company</Label>
                        <Select
                          value={row.companyId}
                          onValueChange={(v) => updateRow(row.rowId, { companyId: v })}
                          disabled={processing}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Pick company..." />
                          </SelectTrigger>
                          <SelectContent>
                            {companies.map((c) => (
                              <SelectItem
                                key={c.id}
                                value={c.id}
                                disabled={usedCompanyIds.has(c.id) && c.id !== row.companyId}
                              >
                                {c.name}
                                {c.country ? ` — ${c.country}` : " — (no country)"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {company && !company.country && (
                          <p className="text-xs text-destructive">This company has no country yet.</p>
                        )}
                      </div>

                      {/* Job functions */}
                      <div className="space-y-1">
                        <Label className="text-xs">Job functions to add</Label>
                        <div className="flex flex-wrap gap-1 mb-1">
                          {row.jobFunctions.map((fn) => (
                            <Badge key={fn} variant="secondary" className="gap-1">
                              {fn}
                              <X className="h-3 w-3 cursor-pointer" onClick={() => removeFunction(row.rowId, fn)} />
                            </Badge>
                          ))}
                        </div>
                        <Input
                          placeholder="Type a function and press Enter..."
                          list={`bulk-fn-sugg-${row.rowId}`}
                          value={jobFunctionInputs.get(row.rowId) || ""}
                          onChange={(e) =>
                            setJobFunctionInputs((prev) => {
                              const next = new Map(prev);
                              next.set(row.rowId, e.target.value);
                              return next;
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addFunction(row.rowId, (jobFunctionInputs.get(row.rowId) || ""));
                            }
                          }}
                          disabled={processing}
                        />
                        <datalist id={`bulk-fn-sugg-${row.rowId}`}>
                          {JOB_FUNCTION_SUGGESTIONS.filter((s) => !row.jobFunctions.includes(s)).map((s) => (
                            <option key={s} value={s} />
                          ))}
                        </datalist>
                      </div>

                      <div className="flex items-start gap-1 pt-5">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeRow(row.rowId)}
                          disabled={processing || rows.length === 1}
                          title="Remove row"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Per-row progress line */}
                    {p && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">
                            {p.jobsDone}/{p.jobsTotal} jobs
                          </span>
                          <Badge
                            variant={
                              p.status === "done" ? "secondary" :
                              p.status === "error" ? "destructive" :
                              p.status === "processing" ? "default" : "outline"
                            }
                            className={p.status === "done" ? "bg-green-100 text-green-800" : ""}
                          >
                            {p.status === "done" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                            {p.status === "error" && <AlertCircle className="h-3 w-3 mr-1" />}
                            {p.status}
                          </Badge>
                        </div>
                        {p.status === "processing" && p.jobsTotal > 0 && (
                          <Progress value={pct} className="h-1.5" />
                        )}
                        {p.error && <p className="text-xs text-destructive">{p.error}</p>}
                      </div>
                    )}
                  </div>
                );
              })}

              <Button variant="outline" size="sm" onClick={addRow} disabled={processing}>
                <Plus className="h-4 w-4 mr-2" />
                Add another company
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={handleRunAll} disabled={processing || totalCombos === 0}>
          {processing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          {processing ? "Running..." : `Run All (${totalCombos} combo${totalCombos === 1 ? "" : "s"})`}
        </Button>
        {processing && (
          <Button variant="outline" onClick={handleCancel}>
            <X className="h-4 w-4 mr-2" />
            Cancel polling
          </Button>
        )}
      </div>
    </div>
  );
};
