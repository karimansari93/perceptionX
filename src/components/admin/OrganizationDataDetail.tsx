import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Building2,
  RefreshCw,
  Globe,
  Play,
  RotateCw,
  ArrowRight,
  Loader2,
  XCircle,
} from 'lucide-react';
import { useAdminCompanyCollection } from '@/hooks/useAdminCompanyCollection';
import { coverageLabel, EXPECTED_MODELS_PER_PROMPT } from '@/utils/collectionCoverage';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export interface Organization {
  id: string;
  name: string;
  description?: string | null;
}

export interface OrgCompany {
  id: string;
  name: string;
  industry: string;
  industries: string[];
  organization_id: string;
  country: string | null;
  data_collection_status: string | null;
  last_updated: string | null;
  /** Active prompts count for this company */
  prompt_count: number;
  /** Prompt responses count for this company (all models) */
  response_count: number;
  /** Prompts that have >= 5 model responses each (required for Completed) */
  prompts_with_full_coverage: number;
}

interface OrganizationDataDetailProps {
  org: Organization;
  onBack: () => void;
  onViewCompany?: (company: OrgCompany) => void;
}

function statusBadgeVariant(
  status: string | null,
  promptCount: number,
  promptsWithFullCoverage: number
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'collecting_search_insights' || status === 'collecting_llm_data') return 'secondary';
  if (status === 'failed') return 'destructive';
  if (status === 'pending') return 'outline';
  if (promptCount === 0) return 'secondary';
  return promptsWithFullCoverage === promptCount ? 'default' : 'outline';
}

export const OrganizationDataDetail = ({ org, onBack, onViewCompany }: OrganizationDataDetailProps) => {
  const [companies, setCompanies] = useState<OrgCompany[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingCompanyId, setRefreshingCompanyId] = useState<string | null>(null);
  const [fullRefreshCompany, setFullRefreshCompany] = useState<OrgCompany | null>(null);
  const { runContinueCollection, runFullRefresh, isRunning } = useAdminCompanyCollection();

  useEffect(() => {
    loadOrgData();
  }, [org.id]);

  const loadOrgData = async () => {
    setLoading(true);
    try {
      const { data: ocData, error: ocError } = await supabase
        .from('organization_companies')
        .select('company_id')
        .eq('organization_id', org.id);

      if (ocError) {
        console.error('OrganizationDataDetail organization_companies error:', ocError.message, ocError);
        throw ocError;
      }
      const companyIds = (ocData || []).map((r) => r.company_id).filter(Boolean);
      if (companyIds.length === 0) {
        setCompanies([]);
        setCountries([]);
        setLoading(false);
        return;
      }

      const { data: companiesData, error: companiesError } = await supabase
        .from('companies')
        .select('id, name, industry, updated_at, data_collection_status')
        .in('id', companyIds);

      if (companiesError) {
        console.error('OrganizationDataDetail companies error:', companiesError.message, companiesError);
        throw companiesError;
      }

      const [industriesRes, countriesRes, promptsRes, responsesRes] = await Promise.all([
        supabase.from('company_industries').select('company_id, industry').in('company_id', companyIds),
        supabase
          .from('user_onboarding')
          .select('company_id, country')
          .in('company_id', companyIds)
          .not('company_id', 'is', null),
        supabase
          .from('confirmed_prompts')
          .select('company_id, id')
          .eq('is_active', true)
          .in('company_id', companyIds),
        supabase.from('prompt_responses').select('company_id, confirmed_prompt_id').in('company_id', companyIds),
      ]);

      const industriesMap = new Map<string, Set<string>>();
      (industriesRes.data || []).forEach((row) => {
        if (!industriesMap.has(row.company_id)) industriesMap.set(row.company_id, new Set());
        industriesMap.get(row.company_id)!.add(row.industry);
      });

      const countryByCompany = new Map<string, string | null>();
      const countrySet = new Set<string>();
      (countriesRes.data || []).forEach((row) => {
        if (row.company_id && !countryByCompany.has(row.company_id)) {
          const c = row.country || null;
          countryByCompany.set(row.company_id, c);
          if (c) countrySet.add(c);
        }
      });

      const promptCountByCompany = new Map<string, number>();
      const promptIdsByCompany = new Map<string, Set<string>>();
      (promptsRes.data || []).forEach((row: { company_id?: string; id?: string }) => {
        if (row.company_id) {
          promptCountByCompany.set(row.company_id, (promptCountByCompany.get(row.company_id) ?? 0) + 1);
          if (row.id) {
            if (!promptIdsByCompany.has(row.company_id)) promptIdsByCompany.set(row.company_id, new Set());
            promptIdsByCompany.get(row.company_id)!.add(row.id);
          }
        }
      });
      const responseCountByCompany = new Map<string, number>();
      const responseCountByPrompt = new Map<string, number>();
      (responsesRes.data || []).forEach((row: { company_id?: string; confirmed_prompt_id?: string }) => {
        if (row.company_id) {
          responseCountByCompany.set(row.company_id, (responseCountByCompany.get(row.company_id) ?? 0) + 1);
          if (row.confirmed_prompt_id) {
            const key = `${row.company_id}:${row.confirmed_prompt_id}`;
            responseCountByPrompt.set(key, (responseCountByPrompt.get(key) ?? 0) + 1);
          }
        }
      });

      const promptsWithFullCoverageByCompany = new Map<string, number>();
      promptIdsByCompany.forEach((promptIds, companyId) => {
        let full = 0;
        promptIds.forEach((pid) => {
          if ((responseCountByPrompt.get(`${companyId}:${pid}`) ?? 0) >= EXPECTED_MODELS_PER_PROMPT) full++;
        });
        promptsWithFullCoverageByCompany.set(companyId, full);
      });

      const list: OrgCompany[] = (companiesData || []).map((c) => {
        const row = c as { id: string; name: string; industry: string; updated_at?: string | null; data_collection_status?: string | null };
        const promptCount = promptCountByCompany.get(row.id) ?? 0;
        const responseCount = responseCountByCompany.get(row.id) ?? 0;
        const promptsWithFullCoverage = promptsWithFullCoverageByCompany.get(row.id) ?? 0;
        return {
          id: row.id,
          name: row.name,
          industry: row.industry,
          industries: Array.from(industriesMap.get(row.id) || (row.industry ? [row.industry] : [])),
          organization_id: org.id,
          country: countryByCompany.get(row.id) ?? null,
          data_collection_status: row.data_collection_status ?? null,
          last_updated: row.updated_at ?? null,
          prompt_count: promptCount,
          response_count: responseCount,
          prompts_with_full_coverage: promptsWithFullCoverage,
        };
      });

      setCompanies(list);
      setCountries(Array.from(countrySet).sort());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const details = e && typeof e === 'object' && 'message' in e ? (e as { message?: string }).message : msg;
      console.error('Error loading org data:', details, e);
      toast.error(`Failed to load organization data: ${details}`);
      setCompanies([]);
      setCountries([]);
    } finally {
      setLoading(false);
    }
  };

  const handleContinueCollection = async (company: OrgCompany) => {
    setRefreshingCompanyId(company.id);
    try {
      const ok = await runContinueCollection(company.id, company.organization_id, company.name);
      if (ok) await loadOrgData();
    } finally {
      setRefreshingCompanyId(null);
    }
  };

  const handleFullRefreshConfirm = async () => {
    if (!fullRefreshCompany) return;
    const company = fullRefreshCompany;
    setFullRefreshCompany(null);
    setRefreshingCompanyId(company.id);
    try {
      const ok = await runFullRefresh(company.id, company.organization_id, company.name);
      if (ok) await loadOrgData();
    } finally {
      setRefreshingCompanyId(null);
    }
  };

  const handleCancelCollection = async (company: OrgCompany) => {
    try {
      const { error } = await supabase
        .from('companies')
        .update({ data_collection_status: 'pending', data_collection_progress: null })
        .eq('id', company.id)
        .in('data_collection_status', ['collecting_search_insights', 'collecting_llm_data']);
      if (error) throw error;
      toast.success(`Collection cancelled for ${company.name}`);
      await loadOrgData();
    } catch (e) {
      console.error('Cancel collection error:', e);
      toast.error('Failed to cancel collection');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <RefreshCw className="h-12 w-12 animate-spin text-pink mx-auto mb-4" />
          <p className="text-nightsky/60">Loading organization data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button onClick={onBack} variant="ghost" className="text-nightsky/70 hover:text-nightsky -ml-2">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Organizations
        </Button>
      </div>

      <div>
        <h1 className="text-3xl font-headline font-bold text-nightsky">{org.name}</h1>
        {org.description && (
          <p className="text-nightsky/60 mt-1">{org.description}</p>
        )}
      </div>

      {countries.length > 0 && (
        <Card className="border-none shadow-md">
          <CardHeader>
            <CardTitle className="text-nightsky flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Countries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {countries.map((c) => (
                <Badge key={c} variant="outline" className="border-teal/30 text-teal bg-teal/5">
                  {c}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-none shadow-md">
        <CardHeader>
          <CardTitle className="text-nightsky flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Companies ({companies.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {companies.length === 0 ? (
            <p className="text-nightsky/60 text-center py-8">No companies in this organization.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Industries</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Collection status</TableHead>
                  <TableHead>Last updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((company) => {
                  const busy = isRunning && refreshingCompanyId === company.id;
                  return (
                    <TableRow key={company.id}>
                      <TableCell>
                        <span className="font-medium text-nightsky">{company.name}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(company.industries.length ? company.industries : [company.industry].filter(Boolean)).map(
                            (ind) => (
                              <Badge key={ind} variant="outline" className="border-teal/30 text-teal bg-teal/5 text-xs">
                                {ind}
                              </Badge>
                            )
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-nightsky/70">
                        {company.country || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={statusBadgeVariant(
                            company.data_collection_status,
                            company.prompt_count,
                            company.prompts_with_full_coverage
                          )}
                          title={
                            company.prompt_count > 0
                              ? `${company.prompts_with_full_coverage}/${company.prompt_count} prompts have 5 model responses each`
                              : 'No active prompts'
                          }
                        >
                          {coverageLabel(
                            company.prompt_count,
                            company.response_count,
                            company.data_collection_status,
                            company.prompts_with_full_coverage
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-nightsky/60 text-sm">
                        {company.last_updated
                          ? new Date(company.last_updated).toLocaleDateString()
                          : 'Never'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-2 justify-end flex-wrap">
                          {(company.data_collection_status === 'collecting_search_insights' ||
                            company.data_collection_status === 'collecting_llm_data') && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-destructive/50 text-destructive hover:bg-destructive/10"
                              disabled={busy}
                              onClick={() => handleCancelCollection(company)}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Cancel
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-teal/30"
                            disabled={busy}
                            onClick={() => handleContinueCollection(company)}
                          >
                            {busy ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Play className="h-4 w-4 mr-1" />
                                Continue collection
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-silver"
                            disabled={busy}
                            onClick={() => setFullRefreshCompany(company)}
                          >
                            <RotateCw className="h-4 w-4 mr-1" />
                            Full refresh
                          </Button>
                          {onViewCompany && (
                            <Button
                              size="sm"
                              className="bg-pink hover:bg-pink/90"
                              onClick={() => onViewCompany(company)}
                            >
                              View details
                              <ArrowRight className="h-4 w-4 ml-1" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!fullRefreshCompany} onOpenChange={() => setFullRefreshCompany(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Full refresh</DialogTitle>
            <DialogDescription>
              This will re-run all prompts and models for{' '}
              <strong>{fullRefreshCompany?.name}</strong>. Existing responses may be overwritten. Continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFullRefreshCompany(null)}>
              Cancel
            </Button>
            <Button className="bg-pink hover:bg-pink/90" onClick={handleFullRefreshConfirm}>
              Run full refresh
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
