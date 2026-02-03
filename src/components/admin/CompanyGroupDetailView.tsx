import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Building2, Globe, Play, Loader2, XCircle, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { coverageLabel } from '@/utils/collectionCoverage';

export interface CompanyInGroup {
  id: string;
  name: string;
  industry: string;
  countries: string[];
  country: string | null;
  organization_id: string;
  organization_name: string;
  last_updated: string | null;
  data_collection_status?: string | null;
  prompt_count: number;
  response_count: number;
  prompts_with_full_coverage: number;
}

export interface CompanyGroupDetail {
  name: string;
  organization_id: string;
  organization_name: string;
  industries: string[];
  companies: CompanyInGroup[];
  countries: string[];
}

interface CompanyGroupDetailViewProps {
  group: CompanyGroupDetail;
  onBack: () => void;
  onSelectCompany: (company: CompanyInGroup) => void;
  onUpdate: () => void;
  onContinueCollection: (company: CompanyInGroup) => Promise<void>;
  continueCollectionCompanyId: string | null;
  isCollectionRunning: boolean;
}

export const CompanyGroupDetailView = ({
  group,
  onBack,
  onSelectCompany,
  onUpdate,
  onContinueCollection,
  continueCollectionCompanyId,
  isCollectionRunning,
}: CompanyGroupDetailViewProps) => {

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <Button onClick={onBack} variant="ghost" size="sm" className="mb-3 text-slate-600 hover:text-slate-800 -ml-2">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back to Companies
          </Button>
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-md bg-slate-100 text-slate-500 flex-shrink-0">
              <Building2 className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-headline font-semibold text-slate-800 truncate">{group.name}</h1>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {group.industries.map((ind) => (
                  <Badge key={ind} variant="outline" className="border-slate-200 text-slate-600 bg-slate-50 text-xs font-normal">
                    {ind}
                  </Badge>
                ))}
                <span className="text-xs text-slate-500">{group.organization_name}</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {group.companies.length} location{group.companies.length !== 1 ? 's' : ''}: {group.countries.join(', ') || '—'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <Card className="border border-slate-200 shadow-sm bg-white">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-medium text-slate-700">
            Collection Status by Location
          </CardTitle>
          <p className="text-xs text-slate-500 mt-1">
            Each location (country) has its own data collection. Global = prompts without country context.
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="rounded-md border border-slate-200 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-200 hover:bg-transparent bg-slate-50/80">
                  <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Location</TableHead>
                  <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Collection status</TableHead>
                  <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Last Updated</TableHead>
                  <TableHead className="h-9 px-3 text-right text-xs font-medium text-slate-600">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.companies.map((company) => {
                  const busy = isCollectionRunning && continueCollectionCompanyId === company.id;
                  const status = company.data_collection_status ?? null;
                  const isInProgress = status === 'collecting_search_insights' || status === 'collecting_llm_data';
                  const locationLabel = company.country || 'Global';
                  return (
                    <TableRow key={company.id} className="border-slate-200">
                      <TableCell className="py-2 px-3 text-sm">
                        <div className="flex items-center gap-2">
                          {company.country ? (
                            <span className="font-medium text-slate-800">{company.country}</span>
                          ) : (
                            <>
                              <Globe className="h-3.5 w-3.5 text-slate-400" />
                              <span className="font-medium text-slate-800">Global</span>
                            </>
                          )}
                          <span className="text-xs font-mono text-slate-400 truncate max-w-[120px]" title={company.id}>
                            {company.id.slice(0, 8)}…
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-2 px-3">
                        <Badge
                          variant={
                            isInProgress ? 'secondary' :
                            status === 'failed' ? 'destructive' :
                            status === 'pending' ? 'outline' :
                            ((company.prompt_count ?? 0) > 0 && (company.prompts_with_full_coverage ?? 0) === (company.prompt_count ?? 0)) ? 'default' : 'outline'
                          }
                          className="text-xs font-normal"
                          title={
                            (company.prompt_count ?? 0) > 0
                              ? `${company.prompts_with_full_coverage ?? 0}/${company.prompt_count} prompts have 5 responses each`
                              : 'No active prompts'
                          }
                        >
                          {coverageLabel(
                            company.prompt_count ?? 0,
                            company.response_count ?? 0,
                            status,
                            company.prompts_with_full_coverage ?? 0
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2 px-3 text-xs text-slate-500">
                        {company.last_updated
                          ? new Date(company.last_updated).toLocaleDateString()
                          : 'Never'}
                      </TableCell>
                      <TableCell className="py-2 px-3 text-right">
                        <div className="flex gap-1.5 justify-end flex-wrap">
                          {isInProgress && (
                            <Button
                              onClick={async () => {
                                try {
                                  const { error } = await supabase
                                    .from('companies')
                                    .update({ data_collection_status: 'pending', data_collection_progress: null })
                                    .eq('id', company.id)
                                    .in('data_collection_status', ['collecting_search_insights', 'collecting_llm_data']);
                                  if (error) throw error;
                                  toast.success(`Collection cancelled for ${group.name} (${locationLabel})`);
                                  onUpdate();
                                } catch (e) {
                                  console.error('Cancel collection error:', e);
                                  toast.error('Failed to cancel collection');
                                }
                              }}
                              size="sm"
                              variant="outline"
                              className="border-destructive/50 text-destructive hover:bg-destructive/10 h-7 text-xs"
                              disabled={busy}
                            >
                              <XCircle className="h-3.5 w-3.5 mr-1" />
                              Cancel
                            </Button>
                          )}
                          <Button
                            onClick={() => onContinueCollection(company)}
                            size="sm"
                            variant="outline"
                            className="border-slate-200 text-slate-600 h-7 text-xs"
                            disabled={busy}
                          >
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Play className="h-3.5 w-3.5 mr-1" />Continue</>}
                          </Button>
                          <Button
                            onClick={() => onSelectCompany(company)}
                            size="sm"
                            className="bg-pink hover:bg-pink/90 text-white h-7 text-xs"
                          >
                            View Details
                            <ArrowRight className="h-3.5 w-3.5 ml-1" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
