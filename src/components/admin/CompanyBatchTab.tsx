import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Building2 } from "lucide-react";
import { ActionSelector, type BatchAction } from "./batch/ActionSelector";
import { RecollectPanel } from "./batch/RecollectPanel";
import { ExpandCoveragePanel } from "./batch/ExpandCoveragePanel";
import { NewCompanyPanel } from "./batch/NewCompanyPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BatchMode = "idle" | "recollect" | "expand" | "new_company" | "new_org";

type Organization = {
  id: string;
  name: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CompanyBatchTab = () => {
  const [mode, setMode] = useState<BatchMode>("idle");
  const [orgMode, setOrgMode] = useState<"existing_org" | "new_org">("existing_org");
  const [organizationId, setOrganizationId] = useState("");
  const [newOrgName, setNewOrgName] = useState("");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [recentResults, setRecentResults] = useState<any[]>([]);

  useEffect(() => {
    loadOrganizations();
    loadRecentResults();
  }, []);

  const loadOrganizations = async () => {
    const { data } = await supabase.from("organizations").select("id, name").order("name");
    if (data) setOrganizations(data);
  };

  const loadRecentResults = async () => {
    const { data } = await supabase
      .from("prompt_responses")
      .select(`
        id, ai_model, detected_competitors, created_at,
        confirmed_prompts!inner(
          prompt_type, industry_context, location_context, job_function_context,
          companies(name)
        )
      `)
      .eq("confirmed_prompts.prompt_type", "discovery")
      .order("created_at", { ascending: false })
      .limit(10);

    if (data) setRecentResults(data);
  };

  const handleOrgModeChange = (v: string) => {
    setOrgMode(v as "existing_org" | "new_org");
    if (v === "new_org") {
      setMode("new_org");
    } else {
      setMode("idle");
    }
  };

  const handleOrgSelect = (id: string) => {
    setOrganizationId(id);
    setMode("idle");
  };

  const handleActionSelect = (action: BatchAction) => {
    setMode(action);
  };

  const handleBack = () => {
    setMode("idle");
  };

  // Find selected org name for display
  const selectedOrgName = organizations.find((o) => o.id === organizationId)?.name;

  return (
    <div className="space-y-6">
      {/* Step 1: Organization selector — always visible */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Batch Collection
          </CardTitle>
          <CardDescription>
            Re-collect data, expand coverage, or add new companies.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Organization</Label>
            <RadioGroup
              value={orgMode}
              onValueChange={handleOrgModeChange}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="existing_org" id="existing" />
                <Label htmlFor="existing" className="font-normal cursor-pointer">Existing organization</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="new_org" id="new" />
                <Label htmlFor="new" className="font-normal cursor-pointer">Create new</Label>
              </div>
            </RadioGroup>

            {orgMode === "existing_org" ? (
              <Select value={organizationId} onValueChange={handleOrgSelect}>
                <SelectTrigger className="max-w-md">
                  <SelectValue placeholder="Select organization..." />
                </SelectTrigger>
                <SelectContent>
                  {organizations.map((org) => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                className="max-w-md"
                placeholder="New organization name"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Step 2: Action selector — shown when org is selected and mode is idle */}
      {orgMode === "existing_org" && organizationId && mode === "idle" && (
        <ActionSelector onSelect={handleActionSelect} />
      )}

      {/* Step 3: Scenario panels */}
      {mode === "recollect" && (
        <RecollectPanel organizationId={organizationId} onBack={handleBack} />
      )}

      {mode === "expand" && (
        <ExpandCoveragePanel organizationId={organizationId} onBack={handleBack} />
      )}

      {(mode === "new_company" || mode === "new_org") && (
        <NewCompanyPanel
          orgMode={mode === "new_org" ? "new_org" : "existing_org"}
          organizationId={organizationId}
          newOrgName={newOrgName}
          onBack={handleBack}
        />
      )}

      {/* Bottom: Recent Results (always visible) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Results</CardTitle>
          <CardDescription>Last 10 discovery responses collected via batch.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Job Function</TableHead>
                <TableHead>AI Model</TableHead>
                <TableHead>Companies Found</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentResults.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No results yet.
                  </TableCell>
                </TableRow>
              ) : (
                recentResults.map((r: any) => {
                  const prompt = r.confirmed_prompts;
                  const companyNameResult = prompt?.companies?.name || "—";
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                      <TableCell>{companyNameResult}</TableCell>
                      <TableCell>{prompt?.location_context || "—"}</TableCell>
                      <TableCell>{prompt?.industry_context || "—"}</TableCell>
                      <TableCell>{prompt?.job_function_context || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{r.ai_model}</Badge>
                      </TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate">
                        {r.detected_competitors || "—"}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
