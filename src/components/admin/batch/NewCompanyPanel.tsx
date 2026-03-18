import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, X, Building2 } from "lucide-react";
import { BatchQueuePanel, type QueueItem } from "./BatchQueuePanel";

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

type Props = {
  orgMode: "existing_org" | "new_org";
  organizationId: string;
  newOrgName: string;
  onBack: () => void;
};

export const NewCompanyPanel = ({ orgMode, organizationId, newOrgName, onBack }: Props) => {
  // Form state
  const [companyName, setCompanyName] = useState("");
  const [targetLocations, setTargetLocations] = useState<string[]>([]);
  const [targetIndustries, setTargetIndustries] = useState<string[]>([]);
  const [targetJobFunctions, setTargetJobFunctions] = useState<string[]>([]);
  const [configId, setConfigId] = useState<string | null>(null);

  // Input state
  const [locationInput, setLocationInput] = useState("");
  const [industryInput, setIndustryInput] = useState("");
  const [jobFunctionInput, setJobFunctionInput] = useState("");
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  const [showJobFunctionSuggestions, setShowJobFunctionSuggestions] = useState(false);

  // Queue state
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  // DB suggestions
  const [availableIndustries, setAvailableIndustries] = useState<string[]>([]);

  // Saving
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadIndustries();
    loadConfiguration();
  }, []);

  useEffect(() => {
    if (!processing) return;
    const interval = setInterval(() => loadQueue(), 10000);
    return () => clearInterval(interval);
  }, [processing]);

  useEffect(() => {
    if (configId) debouncedSave();
  }, [companyName, targetLocations, targetIndustries, targetJobFunctions]);

  const debouncedSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveConfiguration(), 2000);
  }, [companyName, targetLocations, targetIndustries, targetJobFunctions]);

  // Data loaders
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

  const loadConfiguration = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("company_batch_configs")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      setConfigId(data.id);
      setCompanyName(data.company_name || "");
      setTargetLocations(data.target_locations || []);
      setTargetIndustries(data.target_industries || []);
      setTargetJobFunctions(data.target_job_functions || []);
      loadQueueForConfig(data.id);
    }
  };

  const loadQueue = async () => {
    if (!configId) return;
    loadQueueForConfig(configId);
  };

  const loadQueueForConfig = async (cId: string) => {
    const { data } = await supabase
      .from("company_batch_queue")
      .select("*")
      .eq("config_id", cId)
      .order("created_at", { ascending: true });

    if (data) {
      setQueue(data as QueueItem[]);
      setProcessing(data.some((q: any) => q.status === "processing"));
    }
  };

  const saveConfiguration = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const payload = {
        user_id: user.id,
        company_name: companyName,
        org_mode: orgMode,
        organization_id: orgMode === "existing_org" ? organizationId || null : null,
        new_org_name: orgMode === "new_org" ? newOrgName : null,
        target_locations: targetLocations,
        target_industries: targetIndustries,
        target_job_functions: targetJobFunctions,
      };

      if (configId) {
        await supabase.from("company_batch_configs").update(payload).eq("id", configId);
      } else {
        const { data } = await supabase.from("company_batch_configs").insert(payload).select("id").single();
        if (data) setConfigId(data.id);
      }
    } catch (err: any) {
      console.error("Save config error:", err);
    } finally {
      setSaving(false);
    }
  };

  // Queue operations
  const generateQueue = async () => {
    if (!companyName.trim()) { toast.error("Company name is required"); return; }
    if (targetLocations.length === 0) { toast.error("At least one location is required"); return; }
    if (targetIndustries.length === 0) { toast.error("At least one industry is required"); return; }

    await saveConfiguration();
    if (!configId) { toast.error("Failed to save configuration"); return; }

    addLog(`Generating queue for ${companyName}...`);

    const jobs: any[] = [];
    for (const loc of targetLocations) {
      for (const ind of targetIndustries) {
        if (targetJobFunctions.length === 0) {
          jobs.push({ config_id: configId, company_name: companyName, location: loc, industry: ind, job_function: null, status: "pending", phase: "setup" });
        } else {
          for (const jf of targetJobFunctions) {
            jobs.push({ config_id: configId, company_name: companyName, location: loc, industry: ind, job_function: jf, status: "pending", phase: "setup" });
          }
        }
      }
    }

    // Deduplicate
    const { data: existing } = await supabase
      .from("company_batch_queue")
      .select("location, industry, job_function, status")
      .eq("config_id", configId)
      .neq("status", "failed");

    const existingKeys = new Set(
      (existing || []).map((e: any) => `${e.location}|${e.industry}|${e.job_function || ""}`)
    );

    const newJobs = jobs.filter(
      (j) => !existingKeys.has(`${j.location}|${j.industry}|${j.job_function || ""}`)
    );

    if (newJobs.length === 0) {
      toast.info("All combinations are already in the queue");
      addLog("No new queue items to create.");
      return;
    }

    const { error } = await supabase.from("company_batch_queue").insert(newJobs);
    if (error) {
      toast.error("Failed to generate queue");
      addLog(`Error: ${error.message}`);
      return;
    }

    addLog(`Created ${newJobs.length} queue items (${jobs.length - newJobs.length} duplicates skipped).`);
    toast.success(`${newJobs.length} queue items created`);
    await loadQueue();
  };

  const startCollection = async () => {
    if (!configId) return;
    setProcessing(true);
    addLog("Starting collection...");

    const { error } = await supabase.functions.invoke("process-company-batch-queue", {
      body: { configId },
    });

    if (error) {
      toast.error("Failed to start collection");
      addLog(`Error: ${error.message}`);
      setProcessing(false);
      return;
    }

    toast.success("Collection started! Queue is self-chaining.");
    addLog("Queue processor invoked — self-chaining from here.");
  };

  const retryFailed = async () => {
    const { error } = await supabase
      .from("company_batch_queue")
      .update({ status: "pending", retry_count: 0, error_log: null })
      .eq("config_id", configId)
      .eq("status", "failed");

    if (error) { toast.error("Failed to retry items"); return; }
    toast.success("Failed items reset to pending");
    addLog("Reset failed items to pending.");
    await loadQueue();
  };

  const cancelQueue = async () => {
    const { error } = await supabase
      .from("company_batch_queue")
      .update({ is_cancelled: true })
      .eq("config_id", configId)
      .in("status", ["pending", "processing"]);

    if (error) { toast.error("Failed to cancel queue"); return; }
    toast.success("Queue cancelled.");
    addLog("Queue cancelled by admin.");
    setProcessing(false);
    await loadQueue();
  };

  const clearCompleted = () => {
    setQueue((prev) => prev.filter((q) => q.status !== "completed"));
  };

  const addLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${ts}] ${msg}`]);
  };

  // Chip helpers
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

  const totalCombinations =
    targetLocations.length * targetIndustries.length * Math.max(targetJobFunctions.length, 1);

  const filteredLocationSuggestions = COUNTRY_SUGGESTIONS.filter(
    (c) => c.toLowerCase().includes(locationInput.toLowerCase()) && !targetLocations.includes(c)
  );

  const filteredJobFunctionSuggestions = JOB_FUNCTION_SUGGESTIONS.filter(
    (j) => j.toLowerCase().includes(jobFunctionInput.toLowerCase()) && !targetJobFunctions.includes(j)
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={processing}>
          Back
        </Button>
        <h3 className="font-semibold">
          {orgMode === "new_org" ? `New Organization: ${newOrgName}` : "Add New Company"}
        </h3>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT: Config form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Company Setup
            </CardTitle>
            <CardDescription>
              Define company with locations, industries, and job functions.
              {saving && <span className="ml-2 text-xs text-muted-foreground">Saving...</span>}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Company Name */}
            <div className="space-y-2">
              <Label>Company Name</Label>
              <Input placeholder="e.g. Netflix" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </div>

            {/* Locations */}
            <div className="space-y-2">
              <Label>Locations</Label>
              <div className="flex flex-wrap gap-1 mb-2">
                {targetLocations.map((loc) => (
                  <Badge key={loc} variant="secondary" className="gap-1">
                    {loc}
                    <X className="h-3 w-3 cursor-pointer" onClick={() => removeChip(loc, targetLocations, setTargetLocations)} />
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
                      addChip(locationInput, targetLocations, setTargetLocations, setLocationInput);
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
                          addChip(s, targetLocations, setTargetLocations, setLocationInput);
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

            {/* Industries */}
            <div className="space-y-2">
              <Label>Industries</Label>
              <div className="flex flex-wrap gap-1 mb-2">
                {targetIndustries.map((ind) => (
                  <Badge key={ind} variant="secondary" className="gap-1">
                    {ind}
                    <X className="h-3 w-3 cursor-pointer" onClick={() => removeChip(ind, targetIndustries, setTargetIndustries)} />
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
                      addChip(industryInput, targetIndustries, setTargetIndustries, setIndustryInput);
                    }
                  }}
                  list="industry-suggestions-new"
                />
                <datalist id="industry-suggestions-new">
                  {availableIndustries.filter((i) => !targetIndustries.includes(i)).map((i) => (
                    <option key={i} value={i} />
                  ))}
                </datalist>
              </div>
            </div>

            {/* Job Functions */}
            <div className="space-y-2">
              <Label>Job Functions <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <div className="flex flex-wrap gap-1 mb-2">
                {targetJobFunctions.map((jf) => (
                  <Badge key={jf} variant="secondary" className="gap-1">
                    {jf}
                    <X className="h-3 w-3 cursor-pointer" onClick={() => removeChip(jf, targetJobFunctions, setTargetJobFunctions)} />
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
                      addChip(jobFunctionInput, targetJobFunctions, setTargetJobFunctions, setJobFunctionInput);
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
                          addChip(s, targetJobFunctions, setTargetJobFunctions, setJobFunctionInput);
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

            {/* Summary + Generate */}
            <div className="pt-2 border-t space-y-3">
              <p className="text-sm text-muted-foreground">
                {targetLocations.length} locations x {targetIndustries.length} industries x {Math.max(targetJobFunctions.length, 1)} job functions = <strong>{totalCombinations} queue items</strong>
              </p>
              <Button onClick={generateQueue} className="w-full" disabled={!companyName.trim()}>
                <Plus className="h-4 w-4 mr-2" />
                Generate Queue
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* RIGHT: Queue status */}
        <BatchQueuePanel
          queue={queue}
          processing={processing}
          logs={logs}
          onStart={startCollection}
          onCancel={cancelQueue}
          onRetryFailed={retryFailed}
          onClearCompleted={clearCompleted}
          onRefresh={loadQueue}
        />
      </div>
    </div>
  );
};
