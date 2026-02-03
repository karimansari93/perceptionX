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
  Calendar,
  Clock,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
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

// Queue State
type QueueItem = {
  id: string;
  industry: string;
  country: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  error?: string;
};

export const VisibilityRankingsTab = () => {
  // Selection State
  const [selectedIndustry, setSelectedIndustry] = useState<string>("");
  const [selectedCountry, setSelectedCountry] = useState<string>("US");
  const [availableIndustries, setAvailableIndustries] = useState<string[]>([]);

  // Multi-select lists (initialized from localStorage)
  const [targetIndustries, setTargetIndustries] = useState<string[]>([]);
  const [targetCountries, setTargetCountries] = useState<string[]>([]);
  const [configLoaded, setConfigLoaded] = useState(false);

  // Schedule State
  const [scheduleDay, setScheduleDay] = useState<number>(1);
  const [scheduleHour, setScheduleHour] = useState<number>(9);
  const [isScheduleActive, setIsScheduleActive] = useState<boolean>(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [testingSchedule, setTestingSchedule] = useState(false);

  // UI State
  const [showAddIndustryDialog, setShowAddIndustryDialog] = useState(false);
  const [newIndustryName, setNewIndustryName] = useState("");
  const [addingIndustry, setAddingIndustry] = useState(false);
  const [showAddCountryDialog, setShowAddCountryDialog] = useState(false);
  const [newCountryName, setNewCountryName] = useState("");
  const [addingCountry, setAddingCountry] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Recent Results State
  const [recentResults, setRecentResults] = useState<any[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);

  // Common countries for visibility rankings
  const [availableCountries, setAvailableCountries] = useState([
    { code: "US", name: "United States" },
    { code: "GB", name: "United Kingdom" },
    { code: "CA", name: "Canada" },
    { code: "AU", name: "Australia" },
    { code: "DE", name: "Germany" },
    { code: "FR", name: "France" },
    { code: "IT", name: "Italy" },
    { code: "ES", name: "Spain" },
    { code: "NL", name: "Netherlands" },
    { code: "SE", name: "Sweden" },
    { code: "NO", name: "Norway" },
    { code: "DK", name: "Denmark" },
    { code: "FI", name: "Finland" },
    { code: "CH", name: "Switzerland" },
    { code: "AT", name: "Austria" },
    { code: "BE", name: "Belgium" },
    { code: "IE", name: "Ireland" },
    { code: "NZ", name: "New Zealand" },
    { code: "SG", name: "Singapore" },
    { code: "JP", name: "Japan" },
    { code: "KR", name: "South Korea" },
    { code: "CN", name: "China" },
    { code: "IN", name: "India" },
    { code: "BR", name: "Brazil" },
    { code: "MX", name: "Mexico" },
    { code: "AR", name: "Argentina" },
    { code: "ZA", name: "South Africa" },
    { code: "AE", name: "United Arab Emirates" },
    { code: "SA", name: "Saudi Arabia" },
    { code: "GLOBAL", name: "Global (All Countries)" },
  ]);

  const testSchedule = async () => {
    setTestingSchedule(true);
    try {
      // Get the current user's config ID first
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("No user found");

      const { data: config } = await supabase
        .from("visibility_configurations")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (!config) {
        toast.error("Please save a configuration first");
        return;
      }

      toast.info("Triggering test run...");

      // Call the scheduler with forceConfigId
      const { error } = await supabase.functions.invoke(
        "process-visibility-queue",
        { body: { forceConfigId: config.id } },
      );

      if (error) throw error;

      toast.success("Test run initiated! Check the queue.");
      setShowScheduleDialog(false);

      // Give it a moment to populate DB then refresh
      setTimeout(
        () => loadRecentResults(), // This reloads results, but we really want to reload the queue status if we were showing it
        2000,
      );
    } catch (error) {
      console.error("Test run failed:", error);
      toast.error("Failed to trigger test run");
    } finally {
      setTestingSchedule(false);
    }
  };

  useEffect(() => {
    loadIndustries();
    loadRecentResults();
    loadConfiguration();
  }, []); // Only run once on mount

  // Auto-refresh results every 10 seconds if schedule is active
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (isScheduleActive)
      interval = setInterval(() => loadRecentResults(), 10000);

    return () => clearInterval(interval);
  }, [isScheduleActive]);

  // Save configuration whenever it changes (debounced)
  useEffect(() => {
    if (configLoaded) {
      const timer = setTimeout(() => saveConfiguration(), 2000);
      return () => clearTimeout(timer);
    }
  }, [
    targetIndustries,
    targetCountries,
    scheduleDay,
    scheduleHour,
    isScheduleActive,
    configLoaded,
  ]);

  // Auto-scroll logs
  useEffect(() => {
    if (logsEndRef.current)
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = (message: string) =>
    setLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] ${message}`,
    ]);

  const loadConfiguration = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const { data, error } = await supabase
        .from("visibility_configurations")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setTargetIndustries(data.target_industries || []);
        setTargetCountries(data.target_countries || []);
        setScheduleDay(data.schedule_day || 1);
        setScheduleHour(data.schedule_hour || 9);
        setIsScheduleActive(data.is_active || false);
      }

      setConfigLoaded(true);
    } catch (error) {
      console.error("Failed to load configuration:", error);
      // Fallback to local storage if DB fails or empty
      try {
        const savedIndustries = localStorage.getItem(
          "vis_rank_target_industries",
        );
        const savedCountries = localStorage.getItem(
          "vis_rank_target_countries",
        );

        if (savedIndustries) setTargetIndustries(JSON.parse(savedIndustries));
        if (savedCountries) setTargetCountries(JSON.parse(savedCountries));
      } catch (e) {
        console.error(e);
      }

      setConfigLoaded(true);
    }
  };

  const saveConfiguration = async (active = isScheduleActive) => {
    if (!configLoaded) return;
    setSavingConfig(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        // Fallback to local storage
        localStorage.setItem(
          "vis_rank_target_industries",
          JSON.stringify(targetIndustries),
        );
        localStorage.setItem(
          "vis_rank_target_countries",
          JSON.stringify(targetCountries),
        );
        return;
      }

      // Upsert configuration
      const { error } = await supabase.from("visibility_configurations").upsert(
        {
          user_id: user.id,
          target_industries: targetIndustries,
          target_countries: targetCountries,
          schedule_day: scheduleDay,
          schedule_hour: scheduleHour,
          is_active: active, // Use the passed value or current state
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

      if (error) throw error;

      // Also update local storage as backup
      localStorage.setItem(
        "vis_rank_target_industries",
        JSON.stringify(targetIndustries),
      );
      localStorage.setItem(
        "vis_rank_target_countries",
        JSON.stringify(targetCountries),
      );
    } catch (error) {
      console.error("Failed to save configuration:", error);
      // toast.error('Failed to save settings'); // Don't spam toast on auto-save
    } finally {
      setSavingConfig(false);
    }
  };

  const clearConfiguration = async () => {
    setTargetIndustries([]);
    setTargetCountries([]);
    setIsScheduleActive(false);

    // Trigger immediate save
    setTimeout(() => saveConfiguration(), 100);

    toast.success("Configuration cleared");
  };

  const loadIndustries = async () => {
    try {
      // Only show industries that have discovery prompts (industry-wide)
      const { data, error } = await supabase
        .from("confirmed_prompts")
        .select("industry_context")
        .eq("prompt_type", "discovery")
        .is("company_id", null)
        .not("industry_context", "is", null);

      if (error) throw error;

      // Use case-insensitive deduplication and sort
      const industriesMap = new Map<string, string>();
      (data || []).forEach((c) => {
        if (c.industry_context) {
          const lower = c.industry_context.toLowerCase();

          // Keep the first occurrence (preserves original casing)
          if (!industriesMap.has(lower))
            industriesMap.set(lower, c.industry_context);
        }
      });

      const uniqueIndustries = Array.from(industriesMap.values()).sort();
      setAvailableIndustries(uniqueIndustries);
    } catch (error) {
      console.error("Error loading industries:", error);
      toast.error("Failed to load industries");
    }
  };

  const loadRecentResults = async () => {
    setLoadingResults(true);

    try {
      // Fetch latest prompt responses joined with prompt details
      const { data, error } = await supabase
        .from("prompt_responses")
        .select(
          `
          id,
          ai_model,
          response_text,
          detected_competitors,
          created_at,
          confirmed_prompts!inner (
            industry_context,
            prompt_theme,
            prompt_category,
            location_context
          )
        `,
        )
        .eq("confirmed_prompts.prompt_type", "discovery")
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;
      setRecentResults(data || []);
    } catch (error) {
      console.error("Error loading recent results:", error);
      // Silent fail is ok for background refresh
    } finally {
      setLoadingResults(false);
    }
  };

  const handleAddIndustry = async () => {
    if (!newIndustryName.trim()) {
      toast.error("Please enter an industry name");
      return;
    }

    const trimmedName = newIndustryName.trim();

    // Check if industry already exists
    if (availableIndustries.includes(trimmedName)) {
      toast.error("This industry already exists");
      setNewIndustryName("");
      setShowAddIndustryDialog(false);
      setSelectedIndustry(trimmedName);
      return;
    }

    setAddingIndustry(true);
    try {
      // Add to available industries list
      const updatedIndustries = [...availableIndustries, trimmedName].sort();
      setAvailableIndustries(updatedIndustries);

      // Select the new industry
      setSelectedIndustry(trimmedName);

      // Close dialog and reset input
      setShowAddIndustryDialog(false);
      setNewIndustryName("");

      toast.success(`Industry "${trimmedName}" added successfully`);
    } catch (error) {
      console.error("Error adding industry:", error);
      toast.error("Failed to add industry");
    } finally {
      setAddingIndustry(false);
    }
  };

  const handleAddCountry = async () => {
    if (!newCountryName.trim()) {
      toast.error("Please enter a country name");
      return;
    }

    const trimmedName = newCountryName.trim();

    // Check if country already exists (check name or code)
    if (
      availableCountries.some(
        (c) =>
          c.name.toLowerCase() === trimmedName.toLowerCase() ||
          c.code.toLowerCase() === trimmedName.toLowerCase(),
      )
    ) {
      toast.error("This country already exists");
      setNewCountryName("");
      setShowAddCountryDialog(false);

      // Try to select existing
      const existing = availableCountries.find(
        (c) =>
          c.name.toLowerCase() === trimmedName.toLowerCase() ||
          c.code.toLowerCase() === trimmedName.toLowerCase(),
      );

      if (existing) setSelectedCountry(existing.code);
      return;
    }

    setAddingCountry(true);

    try {
      // Add to available countries list
      // For custom countries, we use the name as the code
      const newCountry = { code: trimmedName, name: trimmedName };
      const updatedCountries = [...availableCountries, newCountry].sort(
        (a, b) => a.name.localeCompare(b.name),
      );
      setAvailableCountries(updatedCountries);

      // Select the new country
      setSelectedCountry(newCountry.code);

      // Close dialog and reset input
      setShowAddCountryDialog(false);
      setNewCountryName("");

      toast.success(`Country "${trimmedName}" added successfully`);
    } catch (error) {
      console.error("Error adding country:", error);
      toast.error("Failed to add country");
    } finally {
      setAddingCountry(false);
    }
  };

  const addTargetIndustry = () => {
    if (selectedIndustry && !targetIndustries.includes(selectedIndustry))
      setTargetIndustries([...targetIndustries, selectedIndustry]);
  };

  const removeTargetIndustry = (industry: string) =>
    setTargetIndustries(targetIndustries.filter((i) => i !== industry));

  const addTargetCountry = () => {
    if (selectedCountry && !targetCountries.includes(selectedCountry)) {
      // Find the full name for the selected country code
      const countryObj = availableCountries.find(
        (c) => c.code === selectedCountry,
      );
      // Store Full Name (e.g., "United Kingdom") instead of Code (e.g., "GB")
      // If not found (shouldn't happen), fall back to code
      const valueToStore = countryObj ? countryObj.name : selectedCountry;

      if (!targetCountries.includes(valueToStore))
        setTargetCountries([...targetCountries, valueToStore]);
    }
  };

  const removeTargetCountry = (country: string) =>
    setTargetCountries(targetCountries.filter((c) => c !== country));

  const generateQueue = () => {
    if (targetIndustries.length === 0 || targetCountries.length === 0) {
      toast.error("Please select at least one industry and one country");
      return;
    }

    const newQueueItems: QueueItem[] = [];

    targetIndustries.forEach((industry) => {
      targetCountries.forEach((country) => {
        // Check if already in queue
        const exists = queue.some(
          (q) =>
            q.industry === industry &&
            q.country === country &&
            q.status !== "failed",
        );
        if (!exists) {
          newQueueItems.push({
            id: crypto.randomUUID(),
            industry,
            country,
            status: "pending",
            progress: 0,
          });
        }
      });
    });

    if (newQueueItems.length === 0) {
      toast.info("All selected combinations are already in the queue");
      return;
    }

    setQueue((prev) => [...prev, ...newQueueItems]);
    toast.success(`Added ${newQueueItems.length} items to queue`);
  };

  const clearCompleted = () =>
    setQueue((prev) => prev.filter((item) => item.status !== "completed"));

  const clearAll = () => {
    if (processing) {
      toast.error("Cannot clear queue while processing");
      return;
    }

    setQueue([]);
    setLogs([]);
  };

  const processQueue = async () => {
    if (processing) return;

    const pendingItems = queue.filter((i) => i.status === "pending");
    if (pendingItems.length === 0) {
      toast.info("No pending items in queue");
      return;
    }

    setProcessing(true);
    addLog(`Starting batch processing of ${pendingItems.length} items...`);

    // Process items sequentially
    for (const item of pendingItems) {
      // Check if user cleared queue or something changed (though we blocked clear)
      // We need to access the latest queue state or just rely on our local 'item' copy
      // but strictly speaking, if we want to support "Stop", we need a ref.
      // For now, we assume it runs until done or error.

      // Update status to processing
      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id ? { ...q, status: "processing", progress: 0 } : q,
        ),
      );

      // item.country is now likely the Full Name (e.g. United Kingdom)
      // But we need to try and find the Code if possible, or just send Name if that's what we have.
      // The backend expects 'country' param to be Code ideally, or Name.
      // Let's try to map back to code if it matches a name in our list.
      const countryCode =
        availableCountries.find((c) => c.name === item.country)?.code ||
        item.country;
      const countryName = item.country; // Since we store full names now

      addLog(`Processing: ${item.industry} (${countryName})`);

      try {
        // Step 1: Ensure prompts exist (skipResponses: true)
        // This creates the prompts if they don't exist
        addLog(`  -> Initializing prompts...`);
        const initResponse = await supabase.functions.invoke(
          "collect-industry-visibility",
          {
            body: {
              industry: item.industry,
              country: countryCode, // Send Code (e.g. GB) if found, else Name
              countryName: countryName, // Send Full Name
              skipResponses: true,
            },
          },
        );

        if (initResponse.error) throw new Error(initResponse.error.message);
        if (!initResponse.data?.success)
          throw new Error(
            initResponse.data?.error || "Failed to initialize prompts",
          );

        // Step 2: Collect responses in small batches to avoid 504 Timeouts
        // We assume ~16 prompts total.
        // Batch size of 1 prompt * 3 models (parallel) = ~15s.
        // This is much safer for the 60s timeout limit.
        const TOTAL_PROMPTS = 16;
        const BATCH_SIZE = 1;

        for (let offset = 0; offset < TOTAL_PROMPTS; offset += BATCH_SIZE) {
          addLog(
            `  -> Collecting batch ${Math.floor(offset / BATCH_SIZE) + 1}/${Math.ceil(TOTAL_PROMPTS / BATCH_SIZE)} (Prompts ${offset + 1}-${Math.min(offset + BATCH_SIZE, TOTAL_PROMPTS)})...`,
          );

          const batchResponse = await supabase.functions.invoke(
            "collect-industry-visibility",
            {
              body: {
                industry: item.industry,
                country: countryCode,
                countryName: countryName,
                batchOffset: offset,
                batchSize: BATCH_SIZE,
                skipResponses: false,
              },
            },
          );

          if (batchResponse.error)
            // If 504, we might want to retry with smaller batch?
            // For now just throw to fail this item but continue queue
            throw new Error(`Batch failed: ${batchResponse.error.message}`);

          if (!batchResponse.data?.success)
            throw new Error(
              batchResponse.data?.error || "Unknown error in batch collection",
            );

          // Update progress
          const progress = Math.min(
            100,
            Math.round(((offset + BATCH_SIZE) / TOTAL_PROMPTS) * 100),
          );
          setQueue((prev) =>
            prev.map((q) => (q.id === item.id ? { ...q, progress } : q)),
          );

          // Refresh results table occasionally
          if (offset % 4 === 0) loadRecentResults();

          // Small delay between batches to be nice to the API
          await new Promise((r) => setTimeout(r, 1000));
        }

        // Mark completed
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id ? { ...q, status: "completed", progress: 100 } : q,
          ),
        );
        addLog(`  -> COMPLETED: ${item.industry} / ${item.country}`);
        toast.success(`Completed ${item.industry} (${item.country})`);

        // Final refresh of results
        loadRecentResults();
      } catch (err: any) {
        console.error(`Error processing ${item.industry}:`, err);
        addLog(`  -> ERROR: ${err.message}`);
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? { ...q, status: "failed", error: err.message }
              : q,
          ),
        );
      }

      // Delay between items
      await new Promise((r) => setTimeout(r, 2000));
    }

    setProcessing(false);
    addLog("Batch processing finished.");
    toast.success("Batch processing queue finished");
    loadRecentResults();
  };

  return (
    <div className="space-y-6">
      {/* Add Industry Dialog */}
      <Dialog
        open={showAddIndustryDialog}
        onOpenChange={setShowAddIndustryDialog}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Industry</DialogTitle>
            <DialogDescription>
              Add a new industry to the list. This will be available for
              selection immediately.
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
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddIndustry();
                }}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddIndustryDialog(false);
                  setNewIndustryName("");
                }}
                disabled={addingIndustry}
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddIndustry}
                disabled={addingIndustry || !newIndustryName.trim()}
                className="bg-teal hover:bg-teal/90"
              >
                {addingIndustry ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Adding...
                  </>
                ) : (
                  "Add Industry"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Country Dialog */}
      <Dialog
        open={showAddCountryDialog}
        onOpenChange={setShowAddCountryDialog}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Country</DialogTitle>
            <DialogDescription>
              Add a new country to the list. This will be available for
              selection immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="newCountry">Country Name</Label>
              <Input
                id="newCountry"
                value={newCountryName}
                onChange={(e) => setNewCountryName(e.target.value)}
                placeholder="e.g., Portugal, Vietnam, Poland"
                className="mt-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddCountry();
                }}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddCountryDialog(false);
                  setNewCountryName("");
                }}
                disabled={addingCountry}
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddCountry}
                disabled={addingCountry || !newCountryName.trim()}
                className="bg-teal hover:bg-teal/90"
              >
                {addingCountry ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Adding...
                  </>
                ) : (
                  "Add Country"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Schedule Dialog */}
      <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Automated Data Collection</DialogTitle>
            <DialogDescription>
              Schedule automatic monthly data collection for your selected
              industries and countries.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="flex items-center justify-between space-x-2">
              <div className="flex flex-col space-y-1">
                <Label htmlFor="automation-mode">Enable Automation</Label>
                <span className="text-xs text-muted-foreground">
                  Run automatically every month
                </span>
              </div>
              <Switch
                id="automation-mode"
                checked={isScheduleActive}
                onCheckedChange={(checked) => {
                  setIsScheduleActive(checked);
                  // Force immediate save when toggling to ensure state persists
                  // Use timeout to allow state update to propagate if needed,
                  // but passing 'checked' directly to saveConfiguration is safer
                  if (configLoaded) saveConfiguration(checked);
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Day of Month</Label>
                <Select
                  value={scheduleDay.toString()}
                  onValueChange={(v) => setScheduleDay(parseInt(v))}
                  disabled={!isScheduleActive}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select day" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                      <SelectItem key={day} value={day.toString()}>
                        Day {day}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Time (UTC)</Label>
                <Select
                  value={scheduleHour.toString()}
                  onValueChange={(v) => setScheduleHour(parseInt(v))}
                  disabled={!isScheduleActive}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select hour" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => i).map((hour) => (
                      <SelectItem key={hour} value={hour.toString()}>
                        {hour.toString().padStart(2, "0")}:00
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-md text-xs text-muted-foreground border">
              <p className="font-medium mb-1">Next scheduled run:</p>
              {isScheduleActive ? (
                <div className="flex items-center gap-2">
                  <Calendar className="h-3 w-3" />
                  <span>
                    Day {scheduleDay} at{" "}
                    {scheduleHour.toString().padStart(2, "0")}:00 UTC
                  </span>
                </div>
              ) : (
                <span>Automation is disabled.</span>
              )}
              <p className="mt-2 text-[10px] opacity-80">
                Note: Automation uses the industries and countries selected in
                the configuration panel at the time of execution.
              </p>
            </div>

            <div className="flex justify-between gap-2">
              <Button
                variant="outline"
                onClick={testSchedule}
                disabled={testingSchedule || !isScheduleActive}
                className="text-teal border-teal hover:bg-teal/5"
              >
                {testingSchedule ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Run Now (Test)
              </Button>
              <Button onClick={() => setShowScheduleDialog(false)}>Done</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Configuration */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Configuration</CardTitle>
                <CardDescription>
                  Select industries and countries to build your collection
                  queue.
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowScheduleDialog(true)}
                  className={
                    isScheduleActive
                      ? "border-teal text-teal hover:text-teal"
                      : ""
                  }
                  title="Configure automation schedule"
                >
                  {savingConfig ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Clock className="h-4 w-4" />
                  )}
                  <span className="ml-2 hidden sm:inline">
                    {isScheduleActive ? "Scheduled" : "Schedule"}
                  </span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearConfiguration}
                  disabled={
                    targetIndustries.length === 0 &&
                    targetCountries.length === 0
                  }
                  title="Clear saved configuration"
                >
                  <RotateCcw className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Industry Selection */}
              <div className="space-y-3">
                <Label>Industries</Label>
                <div className="flex gap-2">
                  <Select
                    value={selectedIndustry}
                    onValueChange={setSelectedIndustry}
                  >
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

                {/* Selected Industries Chips */}
                <div className="flex flex-wrap gap-2 min-h-[40px] p-2 bg-slate-50 rounded-md border border-slate-100">
                  {targetIndustries.length === 0 && (
                    <span className="text-sm text-muted-foreground italic p-1">
                      No industries selected
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

              {/* Country Selection */}
              <div className="space-y-3">
                <Label>Countries</Label>
                <div className="flex gap-2">
                  <Select
                    value={selectedCountry}
                    onValueChange={setSelectedCountry}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select country" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableCountries.map((country) => (
                        <SelectItem key={country.code} value={country.code}>
                          {country.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    onClick={() => setShowAddCountryDialog(true)}
                    title="Add new country"
                    className="shrink-0"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={addTargetCountry}
                    disabled={!selectedCountry}
                    className="shrink-0 bg-teal hover:bg-teal/90"
                  >
                    Add
                  </Button>
                </div>

                {/* Selected Countries Chips */}
                <div className="flex flex-wrap gap-2 min-h-[40px] p-2 bg-slate-50 rounded-md border border-slate-100">
                  {targetCountries.length === 0 && (
                    <span className="text-sm text-muted-foreground italic p-1">
                      No countries selected
                    </span>
                  )}
                  {targetCountries.map((countryName) => (
                    <Badge
                      key={countryName}
                      variant="secondary"
                      className="flex items-center gap-1 pl-2 pr-1 py-1"
                    >
                      {countryName}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 ml-1 rounded-full hover:bg-slate-200"
                        onClick={() => removeTargetCountry(countryName)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              </div>

              <Button
                onClick={generateQueue}
                disabled={
                  targetIndustries.length === 0 || targetCountries.length === 0
                }
                className="w-full"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Combinations to Queue
              </Button>
            </CardContent>
          </Card>

          {/* Logs */}
          <Card className="flex-1 flex flex-col min-h-[300px]">
            <CardHeader className="py-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                Processing Logs
                <Badge
                  variant="outline"
                  className="ml-auto font-normal text-xs"
                >
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
                {queue.filter((i) => i.status === "completed").length}{" "}
                completed)
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
                      Queue is empty. Add items from the configuration panel.
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
                          {item.industry}
                        </div>
                        <Badge
                          variant="outline"
                          className="text-xs font-normal"
                        >
                          {availableCountries.find(
                            (c) => c.code === item.country,
                          )?.name || item.country}
                        </Badge>
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
              Recent Database Entries
            </CardTitle>
            <CardDescription>
              Live view of the last 10 responses collected across all
              industries.
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
                  <TableHead>Industry</TableHead>
                  <TableHead>Theme</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Companies Found</TableHead>
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
                      <TableCell>
                        {result.confirmed_prompts?.industry_context}
                      </TableCell>
                      <TableCell
                        className="max-w-[200px] truncate"
                        title={result.confirmed_prompts?.prompt_theme}
                      >
                        {result.confirmed_prompts?.prompt_theme}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="font-normal text-xs"
                        >
                          {result.ai_model}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {result.detected_competitors ? (
                          <div className="flex flex-wrap gap-1">
                            {result.detected_competitors
                              .split(",")
                              .slice(0, 3)
                              .map((comp: string, i: number) => (
                                <Badge
                                  key={i}
                                  variant="secondary"
                                  className="text-[10px] h-5"
                                >
                                  {comp.trim()}
                                </Badge>
                              ))}
                            {result.detected_competitors.split(",").length >
                              3 && (
                              <Badge
                                variant="secondary"
                                className="text-[10px] h-5"
                              >
                                +
                                {result.detected_competitors.split(",").length -
                                  3}{" "}
                                more
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">
                            None detected
                          </span>
                        )}
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
