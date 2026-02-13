import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2,
  Play,
  CheckCircle2,
  Plus,
  X,
  Trash2,
  AlertCircle,
  RefreshCw,
  Database,
  RotateCcw,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ---------- Types ----------

type QueueItem = {
  id: string;
  companyId: string;
  companyName: string;
  organizationId: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  error?: string;
};

type CompanyOption = {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
};

type Organization = {
  id: string;
  name: string;
};

// ---------- Constants ----------

const FREE_MODELS = ["openai", "perplexity", "google-ai-overviews"];
const PRO_MODELS = [
  "openai",
  "perplexity",
  "gemini",
  "deepseek",
  "google-ai-overviews",
];

// ---------- Component ----------

export const BatchCompanyCollectionTab = () => {
  // Selection state
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [selectedIndustry, setSelectedIndustry] = useState<string>("");
  const [selectedJobFunction, setSelectedJobFunction] = useState<string>("");
  const [locationInput, setLocationInput] = useState<string>("");

  // Available options (loaded from DB)
  const [availableCompanies, setAvailableCompanies] = useState<CompanyOption[]>([]);
  const [availableIndustries, setAvailableIndustries] = useState<string[]>([]);
  const [availableJobFunctions, setAvailableJobFunctions] = useState<string[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);

  // Multi-select target lists
  const [targetCompanies, setTargetCompanies] = useState<CompanyOption[]>([]);
  const [targetIndustries, setTargetIndustries] = useState<string[]>([]);
  const [targetJobFunctions, setTargetJobFunctions] = useState<string[]>([]);
  const [targetLocations, setTargetLocations] = useState<string[]>([]);

  // Add-new dialogs
  const [showAddCompanyDialog, setShowAddCompanyDialog] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyIndustry, setNewCompanyIndustry] = useState("");
  const [newCompanyOrgId, setNewCompanyOrgId] = useState("");
  const [addingCompany, setAddingCompany] = useState(false);

  const [showAddIndustryDialog, setShowAddIndustryDialog] = useState(false);
  const [newIndustryName, setNewIndustryName] = useState("");

  const [showAddJobFunctionDialog, setShowAddJobFunctionDialog] = useState(false);
  const [newJobFunctionName, setNewJobFunctionName] = useState("");

  const [showAddLocationDialog, setShowAddLocationDialog] = useState(false);
  const [newLocationName, setNewLocationName] = useState("");

  // Queue & processing
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Recent results
  const [recentResults, setRecentResults] = useState<any[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);

  // ---------- Effects ----------

  useEffect(() => {
    loadCompanies();
    loadIndustries();
    loadJobFunctions();
    loadOrganizations();
    loadRecentResults();
  }, []);

  useEffect(() => {
    if (logsEndRef.current)
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // ---------- Data loading ----------

  const loadCompanies = async () => {
    try {
      const { data, error } = await supabase
        .from("companies")
        .select(`
          id, name,
          organization_companies!inner(
            organization_id,
            organizations!inner(name)
          )
        `)
        .order("name", { ascending: true });

      if (error) throw error;

      const companies: CompanyOption[] = (data || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        organizationId: c.organization_companies[0]?.organization_id || "",
        organizationName: c.organization_companies[0]?.organizations?.name || "Unknown",
      }));

      // Deduplicate by name (show one entry per unique company name)
      const seen = new Map<string, CompanyOption>();
      companies.forEach((c) => {
        const key = c.name.toLowerCase().trim();
        if (!seen.has(key)) seen.set(key, c);
      });
      setAvailableCompanies(Array.from(seen.values()));
    } catch (error) {
      console.error("Error loading companies:", error);
      toast.error("Failed to load companies");
    }
  };

  const loadIndustries = async () => {
    try {
      const { data, error } = await supabase
        .from("confirmed_prompts")
        .select("industry_context")
        .eq("prompt_type", "discovery")
        .is("company_id", null)
        .not("industry_context", "is", null);

      if (error) throw error;

      const industriesMap = new Map<string, string>();
      (data || []).forEach((c: any) => {
        if (c.industry_context) {
          const lower = c.industry_context.toLowerCase();
          if (!industriesMap.has(lower))
            industriesMap.set(lower, c.industry_context);
        }
      });

      setAvailableIndustries(Array.from(industriesMap.values()).sort());
    } catch (error) {
      console.error("Error loading industries:", error);
    }
  };

  const loadJobFunctions = async () => {
    try {
      const { data, error } = await supabase
        .from("confirmed_prompts")
        .select("job_function_context")
        .not("job_function_context", "is", null);

      if (error) throw error;

      const jfMap = new Map<string, string>();
      (data || []).forEach((c: any) => {
        if (c.job_function_context) {
          const lower = c.job_function_context.toLowerCase();
          if (!jfMap.has(lower)) jfMap.set(lower, c.job_function_context);
        }
      });

      setAvailableJobFunctions(Array.from(jfMap.values()).sort());
    } catch (error) {
      console.error("Error loading job functions:", error);
    }
  };

  const loadOrganizations = async () => {
    try {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name")
        .order("name", { ascending: true });

      if (error) throw error;
      setOrganizations(data || []);
    } catch (error) {
      console.error("Error loading organizations:", error);
    }
  };

  const loadRecentResults = async () => {
    setLoadingResults(true);
    try {
      const { data, error } = await supabase
        .from("prompt_responses")
        .select(`
          id,
          ai_model,
          response_text,
          company_id,
          created_at,
          confirmed_prompts!inner (
            prompt_theme,
            prompt_category,
            industry_context,
            job_function_context,
            location_context
          )
        `)
        .not("company_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;

      // Enrich with company names
      const companyIds = [...new Set((data || []).map((r: any) => r.company_id).filter(Boolean))];
      let companyNames: Record<string, string> = {};
      if (companyIds.length > 0) {
        const { data: companies } = await supabase
          .from("companies")
          .select("id, name")
          .in("id", companyIds);
        companyNames = Object.fromEntries((companies || []).map((c: any) => [c.id, c.name]));
      }

      setRecentResults(
        (data || []).map((r: any) => ({ ...r, companyName: companyNames[r.company_id] || "Unknown" }))
      );
    } catch (error) {
      console.error("Error loading recent results:", error);
    } finally {
      setLoadingResults(false);
    }
  };

  // ---------- Add-new handlers ----------

  const handleAddCompany = async () => {
    if (!newCompanyName.trim() || !newCompanyIndustry || !newCompanyOrgId) {
      toast.error("Please fill in all fields");
      return;
    }

    setAddingCompany(true);
    try {
      const { data: newCompany, error: companyError } = await supabase
        .from("companies")
        .insert({ name: newCompanyName.trim(), industry: newCompanyIndustry })
        .select()
        .single();

      if (companyError) throw companyError;

      const { error: linkError } = await supabase
        .from("organization_companies")
        .insert({ organization_id: newCompanyOrgId, company_id: newCompany.id });

      if (linkError) throw linkError;

      const orgName = organizations.find((o) => o.id === newCompanyOrgId)?.name || "Unknown";
      const newOption: CompanyOption = {
        id: newCompany.id,
        name: newCompany.name,
        organizationId: newCompanyOrgId,
        organizationName: orgName,
      };

      setAvailableCompanies((prev) => [...prev, newOption].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedCompanyId(newCompany.id);

      setShowAddCompanyDialog(false);
      setNewCompanyName("");
      setNewCompanyIndustry("");
      setNewCompanyOrgId("");
      toast.success(`Company "${newCompany.name}" created`);
    } catch (error: any) {
      console.error("Error adding company:", error);
      toast.error(`Failed to create company: ${error.message}`);
    } finally {
      setAddingCompany(false);
    }
  };

  const handleAddIndustry = () => {
    const trimmed = newIndustryName.trim();
    if (!trimmed) { toast.error("Please enter an industry name"); return; }
    if (availableIndustries.some((i) => i.toLowerCase() === trimmed.toLowerCase())) {
      toast.error("This industry already exists");
      setNewIndustryName("");
      setShowAddIndustryDialog(false);
      setSelectedIndustry(trimmed);
      return;
    }
    setAvailableIndustries((prev) => [...prev, trimmed].sort());
    setSelectedIndustry(trimmed);
    setShowAddIndustryDialog(false);
    setNewIndustryName("");
    toast.success(`Industry "${trimmed}" added`);
  };

  const handleAddJobFunction = () => {
    const trimmed = newJobFunctionName.trim();
    if (!trimmed) { toast.error("Please enter a job function"); return; }
    if (availableJobFunctions.some((j) => j.toLowerCase() === trimmed.toLowerCase())) {
      toast.error("This job function already exists");
      setNewJobFunctionName("");
      setShowAddJobFunctionDialog(false);
      setSelectedJobFunction(trimmed);
      return;
    }
    setAvailableJobFunctions((prev) => [...prev, trimmed].sort());
    setSelectedJobFunction(trimmed);
    setShowAddJobFunctionDialog(false);
    setNewJobFunctionName("");
    toast.success(`Job function "${trimmed}" added`);
  };

  const handleAddLocation = () => {
    const trimmed = newLocationName.trim();
    if (!trimmed) { toast.error("Please enter a location"); return; }
    if (targetLocations.some((l) => l.toLowerCase() === trimmed.toLowerCase())) {
      toast.error("This location is already added");
      setNewLocationName("");
      setShowAddLocationDialog(false);
      return;
    }
    setTargetLocations((prev) => [...prev, trimmed]);
    setShowAddLocationDialog(false);
    setNewLocationName("");
    toast.success(`Location "${trimmed}" added`);
  };

  // ---------- Target list management ----------

  const addTargetCompany = () => {
    if (!selectedCompanyId) return;
    if (targetCompanies.some((c) => c.id === selectedCompanyId)) return;
    const company = availableCompanies.find((c) => c.id === selectedCompanyId);
    if (company) setTargetCompanies((prev) => [...prev, company]);
  };

  const removeTargetCompany = (id: string) =>
    setTargetCompanies((prev) => prev.filter((c) => c.id !== id));

  const addTargetIndustry = () => {
    if (selectedIndustry && !targetIndustries.includes(selectedIndustry))
      setTargetIndustries((prev) => [...prev, selectedIndustry]);
  };

  const removeTargetIndustry = (industry: string) =>
    setTargetIndustries((prev) => prev.filter((i) => i !== industry));

  const addTargetJobFunction = () => {
    if (selectedJobFunction && !targetJobFunctions.includes(selectedJobFunction))
      setTargetJobFunctions((prev) => [...prev, selectedJobFunction]);
  };

  const removeTargetJobFunction = (jf: string) =>
    setTargetJobFunctions((prev) => prev.filter((j) => j !== jf));

  const addTargetLocation = () => {
    const trimmed = locationInput.trim();
    if (!trimmed) return;
    if (targetLocations.some((l) => l.toLowerCase() === trimmed.toLowerCase())) return;
    setTargetLocations((prev) => [...prev, trimmed]);
    setLocationInput("");
  };

  const removeTargetLocation = (loc: string) =>
    setTargetLocations((prev) => prev.filter((l) => l !== loc));

  // ---------- Logging ----------

  const addLog = (message: string) =>
    setLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] ${message}`,
    ]);

  // ---------- Queue management ----------

  const generateQueue = () => {
    if (targetCompanies.length === 0) {
      toast.error("Please select at least one company");
      return;
    }

    const newItems: QueueItem[] = [];
    targetCompanies.forEach((company) => {
      const exists = queue.some(
        (q) => q.companyId === company.id && q.status !== "failed"
      );
      if (!exists) {
        newItems.push({
          id: crypto.randomUUID(),
          companyId: company.id,
          companyName: company.name,
          organizationId: company.organizationId,
          status: "pending",
          progress: 0,
        });
      }
    });

    if (newItems.length === 0) {
      toast.info("All selected companies are already in the queue");
      return;
    }

    setQueue((prev) => [...prev, ...newItems]);
    toast.success(`Added ${newItems.length} companies to queue`);
  };

  const clearCompleted = () =>
    setQueue((prev) => prev.filter((item) => item.status !== "completed"));

  const clearAll = () => {
    if (processing) { toast.error("Cannot clear queue while processing"); return; }
    setQueue([]);
    setLogs([]);
  };

  const clearConfiguration = () => {
    setTargetCompanies([]);
    setTargetIndustries([]);
    setTargetJobFunctions([]);
    setTargetLocations([]);
    toast.success("Configuration cleared");
  };

  // ---------- Queue processing ----------

  const resolveModels = async (organizationId: string): Promise<string[]> => {
    try {
      const { data: orgMember } = await supabase
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", organizationId)
        .eq("role", "owner")
        .limit(1)
        .single();

      if (orgMember?.user_id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("subscription_type")
          .eq("id", orgMember.user_id)
          .single();

        if (profile?.subscription_type === "pro") return PRO_MODELS;
      }
    } catch {
      // Fall through to free models
    }
    return FREE_MODELS;
  };

  const processQueue = async () => {
    if (processing) return;

    const pendingItems = queue.filter((i) => i.status === "pending");
    if (pendingItems.length === 0) {
      toast.info("No pending items in queue");
      return;
    }

    setProcessing(true);
    addLog(`Starting batch collection for ${pendingItems.length} companies...`);

    for (const item of pendingItems) {
      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id ? { ...q, status: "processing", progress: 0 } : q
        )
      );

      addLog(`Processing: ${item.companyName}`);

      try {
        // 1. Resolve models
        const models = await resolveModels(item.organizationId);
        addLog(`  -> Models: ${models.join(", ")}`);

        // 2. Fetch prompts for this company with optional filters
        let promptsQuery = supabase
          .from("confirmed_prompts")
          .select("id, prompt_text, industry_context, job_function_context, location_context")
          .eq("is_active", true)
          .eq("company_id", item.companyId);

        // Apply industry filter if specified
        if (targetIndustries.length > 0) {
          promptsQuery = promptsQuery.in("industry_context", targetIndustries);
        }

        // Apply job function filter if specified
        if (targetJobFunctions.length > 0) {
          promptsQuery = promptsQuery.in("job_function_context", targetJobFunctions);
        }

        // Apply location filter if specified
        if (targetLocations.length > 0) {
          promptsQuery = promptsQuery.in("location_context", targetLocations);
        }

        const { data: prompts, error: promptsError } = await promptsQuery;

        if (promptsError) throw new Error(`Failed to fetch prompts: ${promptsError.message}`);

        if (!prompts || prompts.length === 0) {
          // If filters returned nothing, try without filters
          if (targetIndustries.length > 0 || targetJobFunctions.length > 0 || targetLocations.length > 0) {
            addLog(`  -> No prompts match filters, trying all active prompts...`);
            const { data: allPrompts, error: allError } = await supabase
              .from("confirmed_prompts")
              .select("id")
              .eq("is_active", true)
              .eq("company_id", item.companyId);

            if (allError || !allPrompts?.length) {
              addLog(`  -> No active prompts found for ${item.companyName}`);
              setQueue((prev) =>
                prev.map((q) =>
                  q.id === item.id
                    ? { ...q, status: "failed", error: "No active prompts found" }
                    : q
                )
              );
              continue;
            }

            // Use all prompts as fallback
            const promptIds = allPrompts.map((p: any) => p.id);
            addLog(`  -> Using all ${promptIds.length} active prompts (no filter match)`);
            await executeCollection(item, promptIds, models);
          } else {
            addLog(`  -> No active prompts found for ${item.companyName}`);
            setQueue((prev) =>
              prev.map((q) =>
                q.id === item.id
                  ? { ...q, status: "failed", error: "No active prompts found" }
                  : q
              )
            );
            continue;
          }
        } else {
          const promptIds = prompts.map((p: any) => p.id);
          addLog(`  -> Found ${promptIds.length} prompts to process`);
          await executeCollection(item, promptIds, models);
        }

        // Mark completed
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id ? { ...q, status: "completed", progress: 100 } : q
          )
        );
        addLog(`  -> COMPLETED: ${item.companyName}`);
        toast.success(`Completed ${item.companyName}`);
        loadRecentResults();
      } catch (err: any) {
        console.error(`Error processing ${item.companyName}:`, err);
        addLog(`  -> ERROR: ${err.message}`);
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? { ...q, status: "failed", error: err.message }
              : q
          )
        );
      }

      // Delay between companies
      await new Promise((r) => setTimeout(r, 2000));
    }

    setProcessing(false);
    addLog("Batch processing finished.");
    toast.success("Batch company collection finished");
    loadRecentResults();
  };

  const executeCollection = async (
    item: QueueItem,
    promptIds: string[],
    models: string[]
  ) => {
    const BATCH_SIZE = 5;
    const totalBatches = Math.ceil(promptIds.length / BATCH_SIZE);

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const batchStart = batchIdx * BATCH_SIZE;
      const batchEnd = Math.min(batchStart + BATCH_SIZE, promptIds.length);
      const batchPromptIds = promptIds.slice(batchStart, batchEnd);

      addLog(
        `  -> Batch ${batchIdx + 1}/${totalBatches} (prompts ${batchStart + 1}-${batchEnd})`
      );

      const { data, error } = await supabase.functions.invoke(
        "collect-company-responses",
        {
          body: {
            companyId: item.companyId,
            promptIds: batchPromptIds,
            models,
            batchSize: BATCH_SIZE,
            skipExisting: true,
          },
        }
      );

      if (error) throw new Error(`Batch failed: ${error.message}`);
      if (!data?.success)
        throw new Error(data?.error || "Unknown error in batch collection");

      // Update progress
      const progress = Math.min(
        100,
        Math.round(((batchIdx + 1) / totalBatches) * 100)
      );
      setQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, progress } : q))
      );

      if (data.results?.errors?.length > 0) {
        addLog(
          `  -> Batch ${batchIdx + 1} had ${data.results.errors.length} errors`
        );
      }

      // Refresh results occasionally
      if (batchIdx % 2 === 0) loadRecentResults();

      // Small delay between batches
      await new Promise((r) => setTimeout(r, 1000));
    }
  };

  // ---------- Render ----------

  return (
    <div className="space-y-6">
      {/* Add Company Dialog */}
      <Dialog open={showAddCompanyDialog} onOpenChange={setShowAddCompanyDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Company</DialogTitle>
            <DialogDescription>
              Create a new company and assign it to an organization.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="newCompanyName">Company Name</Label>
              <Input
                id="newCompanyName"
                value={newCompanyName}
                onChange={(e) => setNewCompanyName(e.target.value)}
                placeholder="e.g., Acme Corp"
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <Label>Industry</Label>
              <Select value={newCompanyIndustry} onValueChange={setNewCompanyIndustry}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select industry" />
                </SelectTrigger>
                <SelectContent>
                  {availableIndustries.map((industry) => (
                    <SelectItem key={industry} value={industry}>
                      {industry}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Organization</Label>
              <Select value={newCompanyOrgId} onValueChange={setNewCompanyOrgId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select organization" />
                </SelectTrigger>
                <SelectContent>
                  {organizations.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddCompanyDialog(false);
                  setNewCompanyName("");
                  setNewCompanyIndustry("");
                  setNewCompanyOrgId("");
                }}
                disabled={addingCompany}
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddCompany}
                disabled={
                  addingCompany ||
                  !newCompanyName.trim() ||
                  !newCompanyIndustry ||
                  !newCompanyOrgId
                }
                className="bg-teal hover:bg-teal/90"
              >
                {addingCompany ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Company"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Industry Dialog */}
      <Dialog open={showAddIndustryDialog} onOpenChange={setShowAddIndustryDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Industry</DialogTitle>
            <DialogDescription>
              Add a new industry to the list.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="newIndustry">Industry Name</Label>
              <Input
                id="newIndustry"
                value={newIndustryName}
                onChange={(e) => setNewIndustryName(e.target.value)}
                placeholder="e.g., Healthcare, Technology, Finance"
                className="mt-1"
                onKeyDown={(e) => { if (e.key === "Enter") handleAddIndustry(); }}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => { setShowAddIndustryDialog(false); setNewIndustryName(""); }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddIndustry}
                disabled={!newIndustryName.trim()}
                className="bg-teal hover:bg-teal/90"
              >
                Add Industry
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Job Function Dialog */}
      <Dialog open={showAddJobFunctionDialog} onOpenChange={setShowAddJobFunctionDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Job Function</DialogTitle>
            <DialogDescription>
              Add a new job function to the list.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="newJobFunction">Job Function</Label>
              <Input
                id="newJobFunction"
                value={newJobFunctionName}
                onChange={(e) => setNewJobFunctionName(e.target.value)}
                placeholder="e.g., Talent Acquisition, Marketing, Engineering"
                className="mt-1"
                onKeyDown={(e) => { if (e.key === "Enter") handleAddJobFunction(); }}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => { setShowAddJobFunctionDialog(false); setNewJobFunctionName(""); }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddJobFunction}
                disabled={!newJobFunctionName.trim()}
                className="bg-teal hover:bg-teal/90"
              >
                Add Job Function
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Location Dialog */}
      <Dialog open={showAddLocationDialog} onOpenChange={setShowAddLocationDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Location</DialogTitle>
            <DialogDescription>
              Add any location — city, state, region, or country.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="newLocation">Location</Label>
              <Input
                id="newLocation"
                value={newLocationName}
                onChange={(e) => setNewLocationName(e.target.value)}
                placeholder="e.g., California, London, Germany, Southeast Asia"
                className="mt-1"
                onKeyDown={(e) => { if (e.key === "Enter") handleAddLocation(); }}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => { setShowAddLocationDialog(false); setNewLocationName(""); }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddLocation}
                disabled={!newLocationName.trim()}
                className="bg-teal hover:bg-teal/90"
              >
                Add Location
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Main Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Configuration */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Batch Company Collection</CardTitle>
                <CardDescription>
                  Select companies and optional filters to build your collection queue.
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearConfiguration}
                disabled={
                  targetCompanies.length === 0 &&
                  targetIndustries.length === 0 &&
                  targetJobFunctions.length === 0 &&
                  targetLocations.length === 0
                }
                title="Clear configuration"
              >
                <RotateCcw className="h-4 w-4 text-muted-foreground" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Company Selection */}
              <div className="space-y-3">
                <Label>Companies</Label>
                <div className="flex gap-2">
                  <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select company" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableCompanies.map((company) => (
                        <SelectItem key={company.id} value={company.id}>
                          {company.name}
                          <span className="text-muted-foreground ml-1 text-xs">
                            ({company.organizationName})
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    onClick={() => setShowAddCompanyDialog(true)}
                    title="Add new company"
                    className="shrink-0"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={addTargetCompany}
                    disabled={!selectedCompanyId}
                    className="shrink-0 bg-teal hover:bg-teal/90"
                  >
                    Add
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 min-h-[40px] p-2 bg-slate-50 rounded-md border border-slate-100">
                  {targetCompanies.length === 0 && (
                    <span className="text-sm text-muted-foreground italic p-1">
                      No companies selected
                    </span>
                  )}
                  {targetCompanies.map((company) => (
                    <Badge
                      key={company.id}
                      variant="secondary"
                      className="flex items-center gap-1 pl-2 pr-1 py-1"
                    >
                      {company.name}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 ml-1 rounded-full hover:bg-slate-200"
                        onClick={() => removeTargetCompany(company.id)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Industry Filter */}
              <div className="space-y-3">
                <Label>
                  Industries{" "}
                  <span className="text-xs text-muted-foreground font-normal">(optional filter)</span>
                </Label>
                <div className="flex gap-2">
                  <Select value={selectedIndustry} onValueChange={setSelectedIndustry}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select industry" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableIndustries.map((industry) => (
                        <SelectItem key={industry} value={industry}>
                          {industry}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    onClick={() => setShowAddIndustryDialog(true)}
                    title="Add new industry"
                    className="shrink-0"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={addTargetIndustry}
                    disabled={!selectedIndustry}
                    className="shrink-0 bg-teal hover:bg-teal/90"
                  >
                    Add
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 min-h-[40px] p-2 bg-slate-50 rounded-md border border-slate-100">
                  {targetIndustries.length === 0 && (
                    <span className="text-sm text-muted-foreground italic p-1">
                      All industries (no filter)
                    </span>
                  )}
                  {targetIndustries.map((industry) => (
                    <Badge
                      key={industry}
                      variant="secondary"
                      className="flex items-center gap-1 pl-2 pr-1 py-1"
                    >
                      {industry}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 ml-1 rounded-full hover:bg-slate-200"
                        onClick={() => removeTargetIndustry(industry)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Job Function Filter */}
              <div className="space-y-3">
                <Label>
                  Job Functions{" "}
                  <span className="text-xs text-muted-foreground font-normal">(optional filter)</span>
                </Label>
                <div className="flex gap-2">
                  <Select value={selectedJobFunction} onValueChange={setSelectedJobFunction}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select job function" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableJobFunctions.map((jf) => (
                        <SelectItem key={jf} value={jf}>
                          {jf}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    onClick={() => setShowAddJobFunctionDialog(true)}
                    title="Add new job function"
                    className="shrink-0"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={addTargetJobFunction}
                    disabled={!selectedJobFunction}
                    className="shrink-0 bg-teal hover:bg-teal/90"
                  >
                    Add
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 min-h-[40px] p-2 bg-slate-50 rounded-md border border-slate-100">
                  {targetJobFunctions.length === 0 && (
                    <span className="text-sm text-muted-foreground italic p-1">
                      All job functions (no filter)
                    </span>
                  )}
                  {targetJobFunctions.map((jf) => (
                    <Badge
                      key={jf}
                      variant="secondary"
                      className="flex items-center gap-1 pl-2 pr-1 py-1"
                    >
                      {jf}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 ml-1 rounded-full hover:bg-slate-200"
                        onClick={() => removeTargetJobFunction(jf)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Location Filter */}
              <div className="space-y-3">
                <Label>
                  Locations{" "}
                  <span className="text-xs text-muted-foreground font-normal">(optional filter)</span>
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={locationInput}
                    onChange={(e) => setLocationInput(e.target.value)}
                    placeholder="Type a location (city, state, country...)"
                    className="flex-1"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); addTargetLocation(); }
                    }}
                  />
                  <Button
                    variant="outline"
                    onClick={() => setShowAddLocationDialog(true)}
                    title="Add location via dialog"
                    className="shrink-0"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={addTargetLocation}
                    disabled={!locationInput.trim()}
                    className="shrink-0 bg-teal hover:bg-teal/90"
                  >
                    Add
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 min-h-[40px] p-2 bg-slate-50 rounded-md border border-slate-100">
                  {targetLocations.length === 0 && (
                    <span className="text-sm text-muted-foreground italic p-1">
                      All locations (no filter)
                    </span>
                  )}
                  {targetLocations.map((loc) => (
                    <Badge
                      key={loc}
                      variant="secondary"
                      className="flex items-center gap-1 pl-2 pr-1 py-1"
                    >
                      {loc}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 ml-1 rounded-full hover:bg-slate-200"
                        onClick={() => removeTargetLocation(loc)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              </div>

              <Button
                onClick={generateQueue}
                disabled={targetCompanies.length === 0}
                className="w-full"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Companies to Queue
              </Button>
            </CardContent>
          </Card>

          {/* Logs */}
          <Card className="flex-1 flex flex-col min-h-[300px]">
            <CardHeader className="py-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                Processing Logs
                <Badge variant="outline" className="ml-auto font-normal text-xs">
                  {logs.length} entries
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 p-0">
              <ScrollArea className="h-[300px] w-full p-4 font-mono text-xs">
                {logs.length === 0 ? (
                  <div className="text-muted-foreground italic">
                    Logs will appear here...
                  </div>
                ) : (
                  <div className="space-y-1">
                    {logs.map((log, i) => (
                      <div
                        key={i}
                        className="whitespace-pre-wrap break-all border-b border-slate-100 pb-1 mb-1 last:border-0"
                      >
                        {log}
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Queue & Status */}
        <div className="space-y-6">
          <Card className="h-full flex flex-col">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Processing Queue</CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearCompleted}
                    disabled={processing || queue.length === 0}
                  >
                    Clear Completed
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={clearAll}
                    disabled={processing || queue.length === 0}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <CardDescription>
                {queue.length} items (
                {queue.filter((i) => i.status === "pending").length} pending,{" "}
                {queue.filter((i) => i.status === "completed").length} completed)
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden flex flex-col gap-4">
              <div className="bg-slate-50 border rounded-lg p-4 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Batch Action</span>
                  {processing && (
                    <span className="text-xs text-teal animate-pulse font-medium flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> Processing
                    </span>
                  )}
                </div>

                {/* Filter summary */}
                {(targetIndustries.length > 0 || targetJobFunctions.length > 0 || targetLocations.length > 0) && (
                  <div className="text-xs text-muted-foreground bg-white p-2 rounded border">
                    <span className="font-medium text-slate-700">Active filters:</span>
                    {targetIndustries.length > 0 && (
                      <span className="ml-2">Industries: {targetIndustries.join(", ")}</span>
                    )}
                    {targetJobFunctions.length > 0 && (
                      <span className="ml-2">Job Functions: {targetJobFunctions.join(", ")}</span>
                    )}
                    {targetLocations.length > 0 && (
                      <span className="ml-2">Locations: {targetLocations.join(", ")}</span>
                    )}
                  </div>
                )}

                <Button
                  onClick={processQueue}
                  disabled={
                    processing ||
                    queue.filter((i) => i.status === "pending").length === 0
                  }
                  className="w-full bg-teal hover:bg-teal/90"
                >
                  {processing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Play className="mr-2 h-4 w-4" />
                      Start Collection
                    </>
                  )}
                </Button>
              </div>

              <ScrollArea className="flex-1 h-[400px] pr-4">
                <div className="space-y-3">
                  {queue.length === 0 && (
                    <div className="text-center text-muted-foreground py-10 italic">
                      Queue is empty. Add companies from the configuration panel.
                    </div>
                  )}
                  {queue.map((item) => (
                    <div
                      key={item.id}
                      className={`p-3 rounded-lg border ${
                        item.status === "processing"
                          ? "border-teal bg-teal/5 shadow-sm"
                          : item.status === "completed"
                            ? "border-green-200 bg-green-50"
                            : item.status === "failed"
                              ? "border-red-200 bg-red-50"
                              : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-medium text-sm flex items-center gap-2">
                          {item.status === "completed" && (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          )}
                          {item.status === "failed" && (
                            <AlertCircle className="h-4 w-4 text-red-600" />
                          )}
                          {item.status === "processing" && (
                            <Loader2 className="h-4 w-4 animate-spin text-teal" />
                          )}
                          {item.companyName}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span className="capitalize">{item.status}</span>
                          <span>{item.progress}%</span>
                        </div>
                        <Progress
                          value={item.progress}
                          className={`h-1.5 ${
                            item.status === "failed" ? "bg-red-100" : ""
                          }`}
                          indicatorClassName={
                            item.status === "failed"
                              ? "bg-red-500"
                              : item.status === "completed"
                                ? "bg-green-500"
                                : "bg-teal"
                          }
                        />
                        {item.error && (
                          <div className="text-xs text-red-600 mt-1">
                            {item.error}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent Results Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-teal" />
              Recent Company Responses
            </CardTitle>
            <CardDescription>
              Live view of the last 10 company responses collected.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadRecentResults}
            disabled={loadingResults}
          >
            {loadingResults ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2">Refresh</span>
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Theme</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Industry</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentResults.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No recent results found. Start a collection batch to see
                      data here.
                    </TableCell>
                  </TableRow>
                ) : (
                  recentResults.map((result) => (
                    <TableRow key={result.id}>
                      <TableCell className="text-xs font-mono">
                        {new Date(result.created_at).toLocaleTimeString()}
                      </TableCell>
                      <TableCell className="font-medium">
                        {result.companyName}
                      </TableCell>
                      <TableCell
                        className="max-w-[200px] truncate"
                        title={result.confirmed_prompts?.prompt_theme}
                      >
                        {result.confirmed_prompts?.prompt_theme || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-normal text-xs">
                          {result.ai_model}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {result.confirmed_prompts?.industry_context || "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
