import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Play, CheckCircle2, AlertCircle, X } from "lucide-react";
import { CompanyMultiSelect } from "./CompanyMultiSelect";

// Must match the model names wired up in collect-company-responses (each
// corresponds to a `test-prompt-<name>` edge function).
const MODEL_OPTIONS = [
  { value: "openai", label: "OpenAI (ChatGPT)" },
  { value: "perplexity", label: "Perplexity" },
  { value: "gemini", label: "Gemini" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "google-ai-overviews", label: "Google AI Overviews" },
  { value: "google-ai-mode", label: "Google AI Mode" },
  { value: "claude", label: "Claude" },
];

// Chunk prompts across multiple edge-function invocations so each one stays
// under the 150s Supabase timeout. Same size used by useAdminCompanyCollection.
const PROMPT_CHUNK_SIZE = 5;

type CompanyProgress = {
  status: "pending" | "processing" | "done" | "error";
  error?: string;
  responsesCollected?: number;
  chunksDone?: number;
  chunksTotal?: number;
  progress?: { completed: number; total: number };
};

type Props = {
  organizationId: string;
  onBack: () => void;
};

export const CollectModelPanel = ({ organizationId, onBack }: Props) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [companyNames, setCompanyNames] = useState<Map<string, string>>(new Map());
  const [companyProgress, setCompanyProgress] = useState<Map<string, CompanyProgress>>(new Map());
  const [model, setModel] = useState<string>("perplexity");
  const [skipExisting, setSkipExisting] = useState(true);
  // "YYYY-MM". When set, a prompt is only considered "already collected" for
  // this model if a response exists WITHIN that month. Prompts missing a
  // response for that specific month — regardless of earlier/later data —
  // get re-run. Blank = any existing response counts (original behavior).
  const [skipIfCollectedInMonth, setSkipIfCollectedInMonth] = useState<string>("");
  const [processing, setProcessing] = useState(false);
  const [currentCompanyId, setCurrentCompanyId] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  // Poll per-prompt progress for the currently-processing company. Driven by
  // `data_collection_progress` writes inside collect-company-responses.
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

  const handleCollect = async () => {
    if (selectedIds.length === 0) {
      toast.error("Select at least one company");
      return;
    }
    if (!model) {
      toast.error("Pick a model");
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
        // Fetch every active prompt for this company.
        const { data: prompts, error: promptsError } = await supabase
          .from("confirmed_prompts")
          .select("id")
          .eq("company_id", companyId)
          .eq("is_active", true);

        if (promptsError) throw new Error(promptsError.message);
        const promptIds = (prompts || []).map((p: any) => p.id);

        if (promptIds.length === 0) {
          throw new Error("No active prompts for this company");
        }

        const totalChunks = Math.ceil(promptIds.length / PROMPT_CHUNK_SIZE);
        setCompanyProgress((prev) => {
          const next = new Map(prev);
          const existing = next.get(companyId) || { status: "processing" as const };
          next.set(companyId, { ...existing, chunksDone: 0, chunksTotal: totalChunks });
          return next;
        });

        let collected = 0;
        const errors: string[] = [];

        for (let i = 0; i < promptIds.length; i += PROMPT_CHUNK_SIZE) {
          if (cancelledRef.current) break;

          const chunk = promptIds.slice(i, i + PROMPT_CHUNK_SIZE);
          const { data, error } = await supabase.functions.invoke("collect-company-responses", {
            body: {
              companyId,
              promptIds: chunk,
              models: [model],
              batchSize: 1,
              skipExisting,
              skipIfCollectedInMonth: skipExisting && skipIfCollectedInMonth ? skipIfCollectedInMonth : null,
            },
          });

          if (error) {
            errors.push(error.message);
          } else if (!data?.success) {
            errors.push(data?.error || "Unknown error");
          } else {
            collected += data.results?.responsesCollected ?? 0;
            if (data.results?.errors?.length) errors.push(...data.results.errors);
          }

          const chunksDone = Math.floor(i / PROMPT_CHUNK_SIZE) + 1;
          setCompanyProgress((prev) => {
            const next = new Map(prev);
            const existing = next.get(companyId) || { status: "processing" as const };
            next.set(companyId, {
              ...existing,
              status: "processing",
              chunksDone,
              chunksTotal: totalChunks,
              responsesCollected: collected,
            });
            return next;
          });
        }

        if (cancelledRef.current) break;

        if (errors.length > 0) {
          // Partial success is still a success from the queue standpoint —
          // surface error count but keep overall status "done".
          setCompanyProgress((prev) => {
            const next = new Map(prev);
            next.set(companyId, {
              status: "done",
              responsesCollected: collected,
              chunksDone: totalChunks,
              chunksTotal: totalChunks,
              error: `${errors.length} error(s). ${collected} responses collected.`,
            });
            return next;
          });
        } else {
          setCompanyProgress((prev) => {
            const next = new Map(prev);
            next.set(companyId, {
              status: "done",
              responsesCollected: collected,
              chunksDone: totalChunks,
              chunksTotal: totalChunks,
            });
            return next;
          });
        }
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

    setCurrentCompanyId(null);
    setProcessing(false);

    if (cancelledRef.current) {
      toast.info("Collection cancelled.");
    } else if (failed === 0) {
      toast.success(`${model} collection complete: ${succeeded} compan${succeeded === 1 ? "y" : "ies"} processed.`);
    } else {
      toast.warning(`Collection: ${succeeded} succeeded, ${failed} failed.`);
    }
  };

  const handleCancel = () => {
    cancelledRef.current = true;
    toast.info("Cancelling after current company finishes...");
  };

  const completedCount = [...companyProgress.values()].filter((p) => p.status === "done").length;
  const totalCount = companyProgress.size;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={processing}>
          Back
        </Button>
        <h3 className="font-semibold">Collect Single Model</h3>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT: Company selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Select Companies</CardTitle>
            <CardDescription>
              Run the selected model against every active prompt of the chosen companies.
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

        {/* RIGHT: Model + options */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Model</CardTitle>
            <CardDescription>
              Useful when a prior run missed a model (e.g. ran out of credits).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>AI Model</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a model..." />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label className="text-sm">Skip prompts that already have a response from this model</Label>
                <p className="text-xs text-muted-foreground">
                  On = only fill gaps. Off = overwrite by re-running every prompt.
                </p>
              </div>
              <Switch checked={skipExisting} onCheckedChange={setSkipExisting} />
            </div>

            {skipExisting && (
              <div className="rounded-md border p-3 space-y-2">
                <Label className="text-sm">Only count responses in this month</Label>
                <Input
                  type="month"
                  value={skipIfCollectedInMonth}
                  onChange={(e) => setSkipIfCollectedInMonth(e.target.value)}
                  className="max-w-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to skip any prompt that has ever had a response for this model. Pick a month to re-run prompts that are missing a response for that specific month — e.g. set <span className="font-mono">April 2026</span> to refill the April Perplexity gap even for prompts that already have March or May data.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          onClick={handleCollect}
          disabled={processing || selectedIds.length === 0 || !model}
        >
          {processing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          {processing
            ? `Processing ${completedCount}/${totalCount}...`
            : `Collect ${model || "model"} for ${selectedIds.length} compan${selectedIds.length === 1 ? "y" : "ies"}`}
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

                  const chunkPct =
                    p.chunksTotal && p.chunksTotal > 0
                      ? ((p.chunksDone || 0) / p.chunksTotal) * 100
                      : undefined;
                  const promptPct =
                    p.progress && p.progress.total > 0
                      ? (p.progress.completed / p.progress.total) * 100
                      : undefined;
                  const pct = promptPct ?? chunkPct;

                  return (
                    <div key={id} className="px-4 py-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {companyNames.get(id) || id.slice(0, 8) + "..."}
                        </span>
                        <div className="flex items-center gap-2">
                          {p.responsesCollected !== undefined && (
                            <span className="text-xs text-muted-foreground">
                              {p.responsesCollected} responses
                            </span>
                          )}
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
                      </div>
                      {p.status === "processing" && pct !== undefined && (
                        <Progress value={pct} className="h-1.5" />
                      )}
                      {p.error && (
                        <p className="text-xs text-destructive">{p.error}</p>
                      )}
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
