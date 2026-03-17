import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Loader2, Play, CheckCircle2, AlertCircle, X } from "lucide-react";
import { CompanyMultiSelect, type OrgCompany } from "./CompanyMultiSelect";
import { useAdminCompanyCollection } from "@/hooks/useAdminCompanyCollection";

type CompanyProgress = {
  status: "pending" | "processing" | "done" | "error";
  responsesCollected?: number;
  error?: string;
  progress?: { completed: number; total: number };
};

type Props = {
  organizationId: string;
  onBack: () => void;
};

export const RecollectPanel = ({ organizationId, onBack }: Props) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [companyNames, setCompanyNames] = useState<Map<string, string>>(new Map());
  const [companyProgress, setCompanyProgress] = useState<Map<string, CompanyProgress>>(new Map());
  const [processing, setProcessing] = useState(false);
  const [currentCompanyId, setCurrentCompanyId] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const { runCollection } = useAdminCompanyCollection();

  // Poll progress for the currently-processing company
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

  const handleRecollect = async () => {
    if (selectedIds.length === 0) {
      toast.error("Select at least one company");
      return;
    }

    setProcessing(true);
    cancelledRef.current = false;

    // We need company names for toast messages — fetch them
    const { data: companyRows } = await supabase
      .from("companies")
      .select("id, name")
      .in("id", selectedIds);

    const companyMap = new Map((companyRows || []).map((c: any) => [c.id, c.name]));
    setCompanyNames(companyMap);

    // Initialize progress
    const initial = new Map<string, CompanyProgress>();
    selectedIds.forEach((id) => initial.set(id, { status: "pending" }));
    setCompanyProgress(initial);

    let succeeded = 0;
    let failed = 0;

    for (const companyId of selectedIds) {
      if (cancelledRef.current) break;

      const name = companyMap.get(companyId) || companyId;
      setCurrentCompanyId(companyId);
      setCompanyProgress((prev) => {
        const next = new Map(prev);
        next.set(companyId, { status: "processing" });
        return next;
      });

      const ok = await runCollection(companyId, organizationId, name, { skipExisting: false });

      if (ok) {
        succeeded++;
        setCompanyProgress((prev) => {
          const next = new Map(prev);
          next.set(companyId, { status: "done" });
          return next;
        });
      } else {
        failed++;
        setCompanyProgress((prev) => {
          const next = new Map(prev);
          next.set(companyId, { status: "error", error: "Collection failed" });
          return next;
        });
      }
    }

    setCurrentCompanyId(null);
    setProcessing(false);

    if (cancelledRef.current) {
      toast.info("Re-collection cancelled.");
    } else if (failed === 0) {
      toast.success(`Re-collection complete: ${succeeded} companies processed.`);
    } else {
      toast.warning(`Re-collection complete: ${succeeded} succeeded, ${failed} failed.`);
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
        <h3 className="font-semibold">Re-collect Data</h3>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Select Companies</CardTitle>
        </CardHeader>
        <CardContent>
          <CompanyMultiSelect
            organizationId={organizationId}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
          />
        </CardContent>
      </Card>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          onClick={handleRecollect}
          disabled={processing || selectedIds.length === 0}
        >
          {processing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          {processing ? `Processing ${completedCount}/${totalCount}...` : `Re-collect ${selectedIds.length} compan${selectedIds.length === 1 ? "y" : "ies"}`}
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
                        <Progress
                          value={(p.progress.completed / p.progress.total) * 100}
                          className="h-1.5"
                        />
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
