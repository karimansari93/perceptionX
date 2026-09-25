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
import { OrgReadinessPanel } from './OrgReadinessPanel';
import { coverageLabel } from '@/utils/collectionCoverage';
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
  /** Models collected in the company's latest month — what "complete" is judged against */
  expected_models: string[];
  /** Latest collection month (YYYY-MM-DD), or null if never collected */
  latest_month: string | null;
}

interface OrganizationDataDetailProps {
  org: Organization;
  onBack: () => void;
  onViewCompany?: (company: OrgCompany) => void;
  /** Hide the back button and title when rendered inside OrgWorkspace. */
  hideHeader?: boolean;
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

export const OrganizationDataDetail = ({ org, onBack, onViewCompany, hideHeader }: OrganizationDataDetailProps) => {
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
        // .range() lifts the default 1000-row cap; an org with several
        // multi-market companies exceeds it and the counts under-report.
        supabase
          .from('confirmed_prompts')
          .select('company_id, id, location_context')
          .eq('is_active', true)
          .in('company_id', companyIds)
          .range(0, 49999),
        supabase
          .from('prompt_responses')
          .select('company_id, confirmed_prompt_id, ai_model, response_month')
          .in('company_id', companyIds)
          .range(0, 99999),
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

      // Markets come from the prompts themselves (location_context): that is
      // every market a company is tracked in, whichever flow created it.
      // user_onboarding.country only exists for Company Batch setups and holds
      // one market, so it's the fallback for companies without prompts.
      const marketsByCompany = new Map<string, Set<string>>();
      const promptCountByCompany = new Map<string, number>();
      const promptIdsByCompany = new Map<string, Set<string>>();
      (promptsRes.data || []).forEach((row: { company_id?: string; id?: string; location_context?: string | null }) => {
        if (row.company_id && row.location_context) {
          if (!marketsByCompany.has(row.company_id)) marketsByCompany.set(row.company_id, new Set());
          marketsByCompany.get(row.company_id)!.add(row.location_context);
        }
        if (row.company_id) {
          promptCountByCompany.set(row.company_id, (promptCountByCompany.get(row.company_id) ?? 0) + 1);
          if (row.id) {
            if (!promptIdsByCompany.has(row.company_id)) promptIdsByCompany.set(row.company_id, new Set());
            promptIdsByCompany.get(row.company_id)!.add(row.id);
          }
        }
      });
      // "Complete" is judged on the company's latest collection month, against
      // the models actually collected that month — not a fixed model count,
      // which went stale whenever the collected model set changed.
      type ResponseRow = { company_id?: string; confirmed_prompt_id?: string; ai_model?: string; response_month?: string | null };
      const responseRows = (responsesRes.data || []) as ResponseRow[];
      const responseCountByCompany = new Map<string, number>();
      const latestMonthByCompany = new Map<string, string>();
      for (const row of responseRows) {
        if (!row.company_id) continue;
        responseCountByCompany.set(row.company_id, (responseCountByCompany.get(row.company_id) ?? 0) + 1);
        const m = row.response_month;
        if (m && (!latestMonthByCompany.has(row.company_id) || m > latestMonthByCompany.get(row.company_id)!)) {
          latestMonthByCompany.set(row.company_id, m);
        }
      }
      const modelsByCompany = new Map<string, Set<string>>();
      const modelsByPrompt = new Map<string, Set<string>>();
      for (const row of responseRows) {
        if (!row.company_id || !row.ai_model || row.response_month !== latestMonthByCompany.get(row.company_id)) continue;
        if (!modelsByCompany.has(row.company_id)) modelsByCompany.set(row.company_id, new Set());
        modelsByCompany.get(row.company_id)!.add(row.ai_model);
        if (row.confirmed_prompt_id) {
          const key = `${row.company_id}:${row.confirmed_prompt_id}`;
          if (!modelsByPrompt.has(key)) modelsByPrompt.set(key, new Set());
          modelsByPrompt.get(key)!.add(row.ai_model);
        }
      }

      const promptsWithFullCoverageByCompany = new Map<string, number>();
      promptIdsByCompany.forEach((promptIds, companyId) => {
        const expected = modelsByCompany.get(companyId);
        let full = 0;
        if (expected && expected.size > 0) {
          promptIds.forEach((pid) => {
            const got = modelsByPrompt.get(`${companyId}:${pid}`);
            if (got && [...expected].every((m) => got.has(m))) full++;
          });
        }
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
          country: marketsByCompany.has(row.id)
            ? Array.from(marketsByCompany.get(row.id)!).sort().join(', ')
            : countryByCompany.get(row.id) ?? null,
          data_collection_status: row.data_collection_status ?? null,
          last_updated: row.updated_at ?? null,
          prompt_count: promptCount,
          response_count: responseCount,
          prompts_with_full_coverage: promptsWithFullCoverage,
          expected_models: Array.from(modelsByCompany.get(row.id) ?? []).sort(),
          latest_month: latestMonthByCompany.get(row.id) ?? null,
        };
      });

      setCompanies(list);
      const allMarkets = new Set<string>(countrySet);
      marketsByCompany.forEach((ms) => ms.forEach((m) => allMarkets.add(m)));
      setCountries(Array.from(allMarkets).sort());
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
      {!hideHeader && (
        <>
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
        </>
      )}

      <OrgReadinessPanel companies={companies.map((c) => ({ id: c.id, name: c.name }))} />

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
                              ? `${company.prompts_with_full_coverage}/${company.prompt_count} prompts have a response from every model collected in ${company.latest_month?.slice(0, 7) ?? 'the latest month'} (${company.expected_models.join(', ') || 'none yet'})`
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
