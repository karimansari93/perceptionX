import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Play, CheckCircle2, X } from "lucide-react";
import { CompanyMultiSelect } from "./CompanyMultiSelect";

// Theme gap-fill runs on the server: the panel queues a request
// (request_theme_gap_fill) and theme_gap_tick works through it every minute,
// so closing the tab doesn't stop it.

type GapRequest = {
  id: string;
  company_ids: string[];
  response_month: string | null;
  status: "pending" | "running" | "done" | "cancelled";
  sent_count: number;
  created_at: string;
  finished_at: string | null;
  last_error: string | null;
  remaining: number | null;
};

type Props = {
  organizationId: string;
  onBack: () => void;
};

const monthLabel = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" })
    : "All months";

export const AnalyzeThemesPanel = ({ organizationId, onBack }: Props) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [onlyMonth, setOnlyMonth] = useState<string>(""); // "YYYY-MM" or ""
  const [queueing, setQueueing] = useState(false);
  const [requests, setRequests] = useState<GapRequest[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_theme_gap_requests" as never, { p_org: organizationId } as never);
    if (error) return;
    const rows = ((data ?? []) as unknown as GapRequest[]);
    setRequests(rows);
    const ids = [...new Set(rows.flatMap((r) => r.company_ids))];
    if (ids.length > 0) {
      const { data: companies } = await supabase.from("companies").select("id, name").in("id", ids);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setNames(new Map((companies ?? []).map((c: any) => [c.id, c.name])));
    }
  }, [organizationId]);

  const active = requests.some((r) => r.status === "pending" || r.status === "running");

  useEffect(() => {
    load();
  }, [load]);

  // Poll while something is running.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [active, load]);

  const handleQueue = async () => {
    if (selectedIds.length === 0) {
      toast.error("Select at least one company");
      return;
    }
    if (onlyMonth && !/^\d{4}-\d{2}$/.test(onlyMonth)) {
      toast.error("Pick a valid month");
      return;
    }
    setQueueing(true);
    const { error } = await supabase.rpc("request_theme_gap_fill" as never, {
      p_org: organizationId,
      p_company_ids: selectedIds,
      p_month: onlyMonth ? `${onlyMonth}-01` : null,
    } as never);
    setQueueing(false);
    if (error) {
      toast.error(`Could not queue theme analysis: ${error.message}`);
      return;
    }
    toast.success("Theme analysis queued. It runs in the background; you can close this tab.");
    load();
  };

  const handleCancel = async (id: string) => {
    const { error } = await supabase.rpc("cancel_theme_gap_fill" as never, { p_request_id: id } as never);
    if (error) toast.error(error.message);
    else load();
  };

  const companyList = (ids: string[]) => {
    const labels = ids.map((id) => names.get(id) ?? "…");
    const unique = [...new Set(labels)];
    return unique.length <= 3 ? unique.join(", ") : `${unique.slice(0, 3).join(", ")} +${unique.length - 3} more`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <h3 className="font-semibold">Analyze Themes</h3>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Select Companies</CardTitle>
            <CardDescription>
              Fill theme gaps: answers that mention the company but were never theme-analysed.
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

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Scope</CardTitle>
            <CardDescription>Optionally limit to one collection month.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border p-3 space-y-2">
              <Label className="text-sm">Only this month</Label>
              <Input
                type="month"
                value={onlyMonth}
                onChange={(e) => setOnlyMonth(e.target.value)}
                className="max-w-xs"
              />
              <p className="text-xs text-muted-foreground">Leave blank to fill gaps in every month.</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Runs on the server, about 40 answers per company per minute. Safe to close the tab.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2">
        <Button onClick={handleQueue} disabled={queueing || selectedIds.length === 0}>
          {queueing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
          Analyze themes for {selectedIds.length} compan{selectedIds.length === 1 ? "y" : "ies"}
        </Button>
      </div>

      {requests.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Runs in the last 7 days</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {requests.map((r) => {
                const running = r.status === "pending" || r.status === "running";
                return (
                  <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{companyList(r.company_ids)}</div>
                      <div className="text-xs text-muted-foreground">
                        {monthLabel(r.response_month)} · started {new Date(r.created_at).toLocaleString()}
                        {r.sent_count > 0 && ` · ${r.sent_count} answers sent`}
                        {running && r.remaining !== null && ` · ${r.remaining} still without themes`}
                      </div>
                      {r.last_error && <div className="text-xs text-destructive">{r.last_error}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {running ? (
                        <>
                          <Badge>
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            {r.status === "pending" ? "Queued" : "Running"}
                          </Badge>
                          <Button size="sm" variant="outline" className="h-7" onClick={() => handleCancel(r.id)}>
                            <X className="h-3.5 w-3.5 mr-1" />
                            Cancel
                          </Button>
                        </>
                      ) : r.status === "done" ? (
                        <Badge variant="secondary" className="bg-green-100 text-green-800">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Done
                        </Badge>
                      ) : (
                        <Badge variant="outline">Cancelled</Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
