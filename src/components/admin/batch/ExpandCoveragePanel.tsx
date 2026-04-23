import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Loader2, Play, Plus, X, CheckCircle2, AlertCircle } from "lucide-react";
import { CompanyMultiSelect } from "./CompanyMultiSelect";

const COUNTRY_SUGGESTIONS = [
  "United States", "United Kingdom", "Canada", "Australia", "Germany",
  "France", "Italy", "Spain", "Netherlands", "Sweden", "Norway", "Denmark",
  "Finland", "Switzerland", "Austria", "Belgium", "Ireland", "New Zealand",
  "Singapore", "Japan", "South Korea", "China", "India", "Brazil", "Mexico",
  "Argentina", "South Africa", "United Arab Emirates", "Saudi Arabia",
  "Global (All Countries)",
];

const JOB_FUNCTION_SUGGESTIONS = [
  "Engineering", "Product", "Marketing", "Finance", "HR",
  "Sales", "Operations", "Legal", "Design", "Data",
];

type CompanyProgress = {
  status: "pending" | "processing" | "done" | "error";
  error?: string;
  progress?: { completed: number; total: number };
};

type Props = {
  organizationId: string;
  onBack: () => void;
};

export const ExpandCoveragePanel = ({ organizationId, onBack }: Props) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [companyNames, setCompanyNames] = useState<Map<string, string>>(new Map());

  // New combo inputs
  const [newLocations, setNewLocations] = useState<string[]>([]);
  const [newIndustries, setNewIndustries] = useState<string[]>([]);
  const [newJobFunctions, setNewJobFunctions] = useState<string[]>([]);
  const [locationInput, setLocationInput] = useState("");
  const [industryInput, setIndustryInput] = useState("");
  const [jobFunctionInput, setJobFunctionInput] = useState("");
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  const [showJobFunctionSuggestions, setShowJobFunctionSuggestions] = useState(false);
  const [availableIndustries, setAvailableIndustries] = useState<string[]>([]);

  // Processing state
  const [processing, setProcessing] = useState(false);
  const [companyProgress, setCompanyProgress] = useState<Map<string, CompanyProgress>>(new Map());
  const [currentCompanyId, setCurrentCompanyId] = useState<string | null>(null);
  const [queueGenerated, setQueueGenerated] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    loadIndustries();
  }, []);

  // Poll progress
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

  const loadIndustries = async () => {
    const { data } = await supabase
      .from("confirmed_prompts")
      .select("industry_context")
      .eq("prompt_type", "discovery")
      .is("company_id", null)
      .not("industry_context", "is", null);

    if (data) {
      const unique = [...new Set(data.map((r: any) => r.industry_context).filter(Boolean))];
      setAvailableIndustries(unique.sort());
    }
  };

  const addChip = (
    value: string, list: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    inputSetter: React.Dispatch<React.SetStateAction<string>>,
  ) => {
    const trimmed = value.trim();
    if (!trimmed || list.includes(trimmed)) return;
    setter([...list, trimmed]);
    inputSetter("");
  };

  const removeChip = (
    value: string, list: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>,
  ) => {
    setter(list.filter((v) => v !== value));
  };

  const handleExpand = async () => {
    if (selectedIds.length === 0) {
      toast.error("Select at least one company");
      return;
    }

    const hasNewCombos = newLocations.length > 0 || newIndustries.length > 0 || newJobFunctions.length > 0;

    if (!hasNewCombos) {
      toast.error("Add at least one new location, industry, or job function");
      return;
    }

    // Business rule: a company may have AT MOST ONE country at a time.
    //   - Company with NO country → admin may add exactly one country (+ functions).
    //   - Company that already has a country → admin may only add functions to
    //     that existing country. Adding a different country is disallowed.
    if (newLocations.length > 1) {
      toast.error("A company can only have one country. Add only one new location.");
      return;
    }

    setProcessing(true);
    cancelledRef.current = false;

    // Fetch company names
    const { data: companyRows } = await supabase
      .from("companies")
      .select("id, name")
      .in("id", selectedIds);

    const nameMap = new Map((companyRows || []).map((c: any) => [c.id, c.name]));
    setCompanyNames(nameMap);

    // For each selected company, generate new queue items for the new combos
    // We need a batch config for the queue items
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setProcessing(false); return; }

    // Initialize progress
    const initial = new Map<string, CompanyProgress>();
    selectedIds.forEach((id) => initial.set(id, { status: "pending" }));
    setCompanyProgress(initial);

    let succeeded = 0;
    let failed = 0;

    for (const companyId of selectedIds) {
      if (cancelledRef.current) break;

      const name = nameMap.get(companyId) || companyId;
      setCurrentCompanyId(companyId);
      setCompanyProgress((prev) => {
        const next = new Map(prev);
        next.set(companyId, { status: "processing" });
        return next;
      });

      try {
        // Load existing prompts so we can detect the company's current country
        // and the combos already covered.
        const { data: existingPrompts } = await supabase
          .from("confirmed_prompts")
          .select("location_context, industry_context, job_function_context")
          .eq("company_id", companyId)
          .eq("is_active", true);

        const existingCombos = new Set(
          (existingPrompts || []).map((p: any) =>
            `${p.location_context || ""}|${p.industry_context || ""}|${p.job_function_context || ""}`
          )
        );

        const existingCountries = [
          ...new Set(
            (existingPrompts || [])
              .map((p: any) => p.location_context)
              .filter(Boolean) as string[]
          ),
        ];
        const currentCountry = existingCountries[0] || null;

        // --- Business rule enforcement (per company) ----------------------
        // 1. If the company already has a country, admin cannot assign a
        //    different country via expand coverage.
        if (currentCountry && newLocations.length > 0 && !newLocations.includes(currentCountry)) {
          throw new Error(
            `${name} already has country "${currentCountry}". Only new job functions can be added — a different country cannot be attached via expand coverage.`,
          );
        }

        // 2. If the company has NO country and no new job functions, we need
        //    at least a new country to make a valid combo.
        if (!currentCountry && newLocations.length === 0) {
          throw new Error(
            `${name} has no country yet. Add a location before expanding functions.`,
          );
        }

        // Effective country for this expansion:
        //   - existing country if the company has one (we append to it), OR
        //   - the single new country the admin is adding for a country-less company.
        const effectiveCountry = currentCountry || newLocations[0];

        // Resolve industry — prefer the company's dominant industry_context on
        // existing prompts, fall back to companies.industry, then "General".
        const { data: companyRow } = await supabase
          .from("companies")
          .select("industry")
          .eq("id", companyId)
          .single();

        const industryCounts = new Map<string, number>();
        for (const p of existingPrompts || []) {
          const ind = (p as any).industry_context;
          if (ind) industryCounts.set(ind, (industryCounts.get(ind) || 0) + 1);
        }
        const defaultIndustry =
          [...industryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
          || (companyRow as any)?.industry
          || "General";

        // Create a batch config for this expansion
        const { data: config } = await supabase
          .from("company_batch_configs")
          .insert({
            user_id: user.id,
            company_name: name,
            org_mode: "existing_org",
            organization_id: organizationId,
            target_locations: [effectiveCountry],
            target_industries: newIndustries,
            target_job_functions: newJobFunctions,
          })
          .select("id")
          .single();

        if (!config) throw new Error("Failed to create batch config");

        // Generate queue items for truly new combos. `expand_setup` attaches
        // prompts to the EXISTING company_id (no onboarding insert, no
        // trigger-created duplicate company).
        const industriesToUse = newIndustries.length > 0 ? newIndustries : [defaultIndustry];
        const funcsToUse = newJobFunctions.length > 0 ? newJobFunctions : [null];

        const jobs: any[] = [];
        for (const ind of industriesToUse) {
          for (const jf of funcsToUse) {
            const key = `${effectiveCountry}|${ind}|${jf || ""}`;
            if (!existingCombos.has(key)) {
              jobs.push({
                config_id: config.id,
                company_name: name,
                company_id: companyId,
                location: effectiveCountry,
                industry: ind,
                job_function: jf,
                status: "pending",
                phase: "expand_setup",
              });
            }
          }
        }

        // Also resume any previously-queued rows for this company that got
        // stuck (pending / processing / failed) AND that match what the admin
        // actually selected in this run. We don't silently resume work the
        // admin didn't ask for (e.g. a completed-but-stuck Product & Technology
        // job shouldn't come back to life when the admin only selected
        // Marketing + Content & Production).
        const { data: existingQueueRows } = await supabase
          .from("company_batch_queue")
          .select("id, status, config_id, job_function, location, industry")
          .eq("company_id", companyId)
          .in("status", ["pending", "processing", "failed"]);

        const selectedJobFunctions = new Set(newJobFunctions);

        const staleRows = (existingQueueRows || []).filter((r: any) => {
          // Don't touch rows from the config we just created.
          if (r.config_id === config.id) return false;

          // Only resume rows whose job function is among what the admin selected
          // this time. If the admin selected no new job functions, don't resume
          // anything.
          if (selectedJobFunctions.size === 0) return false;
          if (!r.job_function || !selectedJobFunctions.has(r.job_function)) return false;

          // Must match the effective country we resolved above — otherwise we'd
          // resume a queue row for a completely different country.
          if (r.location !== effectiveCountry) return false;

          return true;
        });
        if (staleRows.length > 0) {
          await supabase
            .from("company_batch_queue")
            .update({
              status: "pending",
              is_cancelled: false,
              retry_count: 0,
              batch_index: 0,
              error_log: null,
              updated_at: new Date().toISOString(),
            })
            .in("id", staleRows.map((r: any) => r.id));
        }

        if (jobs.length === 0 && staleRows.length === 0) {
          // Nothing new to add, nothing stale to resume.
          setCompanyProgress((prev) => {
            const next = new Map(prev);
            next.set(companyId, { status: "done" });
            return next;
          });
          succeeded++;
          continue;
        }

        if (jobs.length > 0) {
          await supabase.from("company_batch_queue").insert(jobs);
        }

        // Collect all config IDs we need to drive: the one we just created
        // (if any new jobs) plus any configs tied to stale rows we resumed.
        const configIdsToDrive = new Set<string>();
        if (jobs.length > 0) configIdsToDrive.add(config.id);
        for (const r of staleRows) configIdsToDrive.add(r.config_id);

        // Kick off the queue processor for each affected config. `invoke`
        // returns as soon as the FIRST queue tick's HTTP response lands — the
        // processor then self-chains background fetches to finish the rest.
        for (const cid of configIdsToDrive) {
          await supabase.functions.invoke("process-company-batch-queue", {
            body: { configId: cid },
          });
        }

        // Poll company_batch_queue until every job for these configs reaches
        // a terminal state. `data_collection_progress` on companies (updated
        // by collect-company-responses) continues driving the per-prompt bar
        // via the existing poller above.
        const totalJobs = jobs.length + staleRows.length;
        const pollStart = Date.now();
        const POLL_INTERVAL_MS = 3000;
        // No hard timeout — Netflix-scale expansions can legitimately exceed
        // 30 min. Admin can hit Cancel to bail out.
        const configIdArr = Array.from(configIdsToDrive);

        while (!cancelledRef.current) {

          const { data: queueRows, error: queueError } = await supabase
            .from("company_batch_queue")
            .select("status, phase, error_log, config_id")
            .in("config_id", configIdArr)
            .eq("company_id", companyId);

          if (queueError) {
            throw new Error(`Queue poll failed: ${queueError.message}`);
          }

          const rows = queueRows || [];
          const terminal = rows.filter(
            (r: any) => r.status === "completed" || r.status === "failed",
          );
          const jobsDone = terminal.length;

          // Surface coarse job-level progress (e.g. 0/3, 1/3) alongside the
          // per-prompt bar driven by data_collection_progress.
          setCompanyProgress((prev) => {
            const next = new Map(prev);
            const existing = next.get(companyId) || { status: "processing" as const };
            next.set(companyId, {
              ...existing,
              status: "processing",
              progress: existing.progress
                ? existing.progress
                : { completed: jobsDone, total: totalJobs },
            });
            return next;
          });

          if (jobsDone === rows.length && rows.length > 0) {
            const anyFailed = rows.find((r: any) => r.status === "failed");
            if (anyFailed) {
              throw new Error(
                anyFailed.error_log || "One or more queue jobs failed. See company_batch_queue.error_log.",
              );
            }
            break;
          }

          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }

        if (cancelledRef.current) break;

        succeeded++;
        setCompanyProgress((prev) => {
          const next = new Map(prev);
          next.set(companyId, { status: "done" });
          return next;
        });
      } catch (err: any) {
        failed++;
        setCompanyProgress((prev) => {
          const next = new Map(prev);
          next.set(companyId, { status: "error", error: err.message });
          return next;
        });
      }
    }

    setCurrentCompanyId(null);
    setProcessing(false);
    setQueueGenerated(true);

    if (cancelledRef.current) {
      toast.info("Expansion cancelled.");
    } else if (failed === 0) {
      toast.success(`Expansion complete: ${succeeded} companies processed.`);
    } else {
      toast.warning(`Expansion: ${succeeded} succeeded, ${failed} failed.`);
    }
  };

  const handleCancel = () => {
    cancelledRef.current = true;
    toast.info("Cancelling after current company finishes...");
  };

  const filteredLocationSuggestions = COUNTRY_SUGGESTIONS.filter(
    (c) => c.toLowerCase().includes(locationInput.toLowerCase()) && !newLocations.includes(c)
  );

  const filteredJobFunctionSuggestions = JOB_FUNCTION_SUGGESTIONS.filter(
    (j) => j.toLowerCase().includes(jobFunctionInput.toLowerCase()) && !newJobFunctions.includes(j)
  );

  const completedCount = [...companyProgress.values()].filter((p) => p.status === "done").length;
  const totalCount = companyProgress.size;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={processing}>
          Back
        </Button>
        <h3 className="font-semibold">Expand Coverage</h3>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT: Company selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Select Companies</CardTitle>
            <CardDescription>Choose which companies to expand coverage for.</CardDescription>
          </CardHeader>
          <CardContent>
            <CompanyMultiSelect
              organizationId={organizationId}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
            />
          </CardContent>
        </Card>

        {/* RIGHT: New combos */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">New Coverage</CardTitle>
            <CardDescription>
              A company can have only one country. Use this to (a) set a country
              on a company that has none, or (b) add job functions to a company's
              existing country.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* New Locations */}
            <div className="space-y-2">
              <Label>New Country <span className="text-muted-foreground text-xs">(only if the company has no country yet)</span></Label>
              <div className="flex flex-wrap gap-1 mb-2">
                {newLocations.map((loc) => (
                  <Badge key={loc} variant="secondary" className="gap-1">
                    {loc}
                    <X className="h-3 w-3 cursor-pointer" onClick={() => removeChip(loc, newLocations, setNewLocations)} />
                  </Badge>
                ))}
              </div>
              <div className="relative">
                <Input
                  placeholder="Type a location and press Enter..."
                  value={locationInput}
                  onChange={(e) => { setLocationInput(e.target.value); setShowLocationSuggestions(true); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addChip(locationInput, newLocations, setNewLocations, setLocationInput);
                      setShowLocationSuggestions(false);
                    }
                  }}
                  onBlur={() => setTimeout(() => setShowLocationSuggestions(false), 200)}
                  onFocus={() => setShowLocationSuggestions(true)}
                />
                {showLocationSuggestions && locationInput && filteredLocationSuggestions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto">
                    {filteredLocationSuggestions.slice(0, 8).map((s) => (
                      <div
                        key={s}
                        className="px-3 py-2 text-sm cursor-pointer hover:bg-accent"
                        onMouseDown={() => {
                          addChip(s, newLocations, setNewLocations, setLocationInput);
                          setShowLocationSuggestions(false);
                        }}
                      >
                        {s}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* New Industries */}
            <div className="space-y-2">
              <Label>New Industries</Label>
              <div className="flex flex-wrap gap-1 mb-2">
                {newIndustries.map((ind) => (
                  <Badge key={ind} variant="secondary" className="gap-1">
                    {ind}
                    <X className="h-3 w-3 cursor-pointer" onClick={() => removeChip(ind, newIndustries, setNewIndustries)} />
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Type industry and press Enter..."
                  value={industryInput}
                  onChange={(e) => setIndustryInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addChip(industryInput, newIndustries, setNewIndustries, setIndustryInput);
                    }
                  }}
                  list="industry-suggestions-expand"
                />
                <datalist id="industry-suggestions-expand">
                  {availableIndustries.filter((i) => !newIndustries.includes(i)).map((i) => (
                    <option key={i} value={i} />
                  ))}
                </datalist>
              </div>
            </div>

            {/* New Job Functions */}
            <div className="space-y-2">
              <Label>New Job Functions <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <div className="flex flex-wrap gap-1 mb-2">
                {newJobFunctions.map((jf) => (
                  <Badge key={jf} variant="secondary" className="gap-1">
                    {jf}
                    <X className="h-3 w-3 cursor-pointer" onClick={() => removeChip(jf, newJobFunctions, setNewJobFunctions)} />
                  </Badge>
                ))}
              </div>
              <div className="relative">
                <Input
                  placeholder="Type job function and press Enter..."
                  value={jobFunctionInput}
                  onChange={(e) => { setJobFunctionInput(e.target.value); setShowJobFunctionSuggestions(true); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addChip(jobFunctionInput, newJobFunctions, setNewJobFunctions, setJobFunctionInput);
                      setShowJobFunctionSuggestions(false);
                    }
                  }}
                  onBlur={() => setTimeout(() => setShowJobFunctionSuggestions(false), 200)}
                  onFocus={() => setShowJobFunctionSuggestions(true)}
                />
                {showJobFunctionSuggestions && jobFunctionInput && filteredJobFunctionSuggestions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto">
                    {filteredJobFunctionSuggestions.map((s) => (
                      <div
                        key={s}
                        className="px-3 py-2 text-sm cursor-pointer hover:bg-accent"
                        onMouseDown={() => {
                          addChip(s, newJobFunctions, setNewJobFunctions, setJobFunctionInput);
                          setShowJobFunctionSuggestions(false);
                        }}
                      >
                        {s}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          onClick={handleExpand}
          disabled={processing || selectedIds.length === 0 || (newLocations.length === 0 && newIndustries.length === 0 && newJobFunctions.length === 0)}
        >
          {processing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Plus className="h-4 w-4 mr-2" />
          )}
          {processing ? `Processing ${completedCount}/${totalCount}...` : "Expand & Re-collect"}
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
            <ScrollArea className="max-h-[300px]">
              <div className="divide-y">
                {selectedIds.map((id) => {
                  const p = companyProgress.get(id);
                  if (!p) return null;
                  return (
                    <div key={id} className="px-4 py-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {companyNames.get(id) || id.slice(0, 8) + "..."}
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
                      {p.status === "processing" && p.progress && p.progress.total > 0 && (
                        <Progress value={(p.progress.completed / p.progress.total) * 100} className="h-1.5" />
                      )}
                      {p.error && (
                        <p className="text-xs text-destructive">{p.error}</p>
                      )}
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
