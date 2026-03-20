import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export type OrgCompany = {
  id: string;
  name: string;
  industry: string | null;
  promptCount: number;
  createdAt: string | null;
  lastUpdated: string | null;
  country: string | null;
};

type Props = {
  organizationId: string;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
};

export const CompanyMultiSelect = ({ organizationId, selectedIds, onSelectionChange }: Props) => {
  const [companies, setCompanies] = useState<OrgCompany[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!organizationId) return;
    loadCompanies(organizationId);
  }, [organizationId]);

  const loadCompanies = async (orgId: string) => {
    setLoading(true);
    try {
      // Step 1: Get company IDs for this org
      const { data: links, error: linksError } = await supabase
        .from("organization_companies")
        .select("company_id")
        .eq("organization_id", orgId);

      if (linksError) {
        console.error("[CompanyMultiSelect] Error fetching org companies:", linksError);
        setCompanies([]);
        return;
      }

      if (!links || links.length === 0) {
        setCompanies([]);
        return;
      }

      const companyIds = links.map((l: any) => l.company_id);

      // Step 2: Get company details
      const { data: companyData, error: companyError } = await supabase
        .from("companies")
        .select("id, name, industry, updated_at, created_at")
        .in("id", companyIds)
        .order("name");

      if (companyError) {
        console.error("[CompanyMultiSelect] Error fetching companies:", companyError);
        setCompanies([]);
        return;
      }

      if (!companyData || companyData.length === 0) {
        setCompanies([]);
        return;
      }

      // Step 3: Get prompt counts and location per company (paginate to avoid 1000-row limit)
      const PAGE_SIZE = 1000;
      let allPromptData: any[] = [];
      let page = 0;
      let chunk: any[] | null;
      do {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const { data } = await supabase
          .from("confirmed_prompts")
          .select("company_id, location_context")
          .eq("is_active", true)
          .in("company_id", companyIds)
          .range(from, to);
        chunk = data ?? [];
        allPromptData = allPromptData.concat(chunk);
        page++;
      } while (chunk && chunk.length === PAGE_SIZE);

      const countMap = new Map<string, number>();
      const locationMap = new Map<string, Set<string>>();
      allPromptData.forEach((p: any) => {
        countMap.set(p.company_id, (countMap.get(p.company_id) || 0) + 1);
        if (p.location_context) {
          if (!locationMap.has(p.company_id)) locationMap.set(p.company_id, new Set());
          locationMap.get(p.company_id)!.add(p.location_context);
        }
      });

      setCompanies(
        companyData.map((c: any) => {
          const locations = locationMap.get(c.id);
          // Pick the primary location (first non-GLOBAL, or GLOBAL if that's all there is)
          let country: string | null = null;
          if (locations && locations.size > 0) {
            const nonGlobal = [...locations].filter(l => l !== 'GLOBAL');
            country = nonGlobal.length > 0 ? nonGlobal[0] : 'Global';
          }
          return {
            id: c.id,
            name: c.name,
            industry: c.industry,
            promptCount: countMap.get(c.id) || 0,
            createdAt: c.created_at,
            lastUpdated: c.updated_at,
            country,
          };
        })
      );
    } finally {
      setLoading(false);
    }
  };

  const allSelected = companies.length > 0 && selectedIds.length === companies.length;

  const toggleAll = () => {
    if (allSelected) {
      onSelectionChange([]);
    } else {
      onSelectionChange(companies.map((c) => c.id));
    }
  };

  const toggleCompany = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((x) => x !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading companies...
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No companies found in this organization.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 pb-2 border-b">
        <Checkbox
          checked={allSelected}
          onCheckedChange={toggleAll}
          id="select-all"
        />
        <Label htmlFor="select-all" className="font-medium cursor-pointer">
          Select All ({companies.length} companies)
        </Label>
      </div>
      <ScrollArea className="h-[400px]">
        <div className="space-y-1 pr-3">
          {companies.map((company) => (
            <div
              key={company.id}
              className="flex items-center gap-3 py-2 px-1 rounded hover:bg-accent/50 cursor-pointer"
              onClick={() => toggleCompany(company.id)}
            >
              <Checkbox
                checked={selectedIds.includes(company.id)}
                onCheckedChange={() => toggleCompany(company.id)}
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{company.name}</span>
                {company.country && (
                  <Badge variant="secondary" className="text-[10px] ml-2 px-1.5 py-0">
                    {company.country}
                  </Badge>
                )}
                {company.industry && (
                  <span className="text-xs text-muted-foreground ml-2">
                    {company.industry}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className="text-xs">
                  {company.promptCount} prompts
                </Badge>
                {company.createdAt && (
                  <span className="text-xs text-muted-foreground">
                    Created {new Date(company.createdAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      {selectedIds.length > 0 && (
        <p className="text-xs text-muted-foreground pt-1">
          {selectedIds.length} of {companies.length} selected
        </p>
      )}
    </div>
  );
};
