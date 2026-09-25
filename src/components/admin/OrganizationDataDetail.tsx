import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ArrowLeft, RefreshCw, Play, RotateCw, Loader2, XCircle } from 'lucide-react';
import { useAdminCompanyCollection } from '@/hooks/useAdminCompanyCollection';
import { OrgReadinessPanel } from './OrgReadinessPanel';
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

interface CompanyRow {
  id: string;
  name: string;
  data_collection_status: string | null;
}

interface OrganizationDataDetailProps {
  org: Organization;
  onBack: () => void;
  /** Hide the back button and title when rendered inside OrgWorkspace. */
  hideHeader?: boolean;
}

// Companies & data: one row per company (and market) with its readiness
// checks and collection actions. All counts come from get_company_readiness
// in the database; this page only loads the company list itself.
export const OrganizationDataDetail = ({ org, onBack, hideHeader }: OrganizationDataDetailProps) => {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyCompanyId, setBusyCompanyId] = useState<string | null>(null);
  const [fullRefreshCompany, setFullRefreshCompany] = useState<CompanyRow | null>(null);
  const { runContinueCollection, runFullRefresh, isRunning } = useAdminCompanyCollection();

  const loadCompanies = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('organization_companies')
      .select('companies(id, name, data_collection_status)')
      .eq('organization_id', org.id);
    if (error) {
      toast.error(`Failed to load companies: ${error.message}`);
      setCompanies([]);
    } else {
      setCompanies(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((data ?? []) as any[]).map((r) => r.companies).filter(Boolean) as CompanyRow[],
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    loadCompanies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id]);

  const refreshAfter = async (run: () => Promise<boolean>, companyId: string) => {
    setBusyCompanyId(companyId);
    try {
      if (await run()) {
        await loadCompanies();
        setReloadKey((k) => k + 1);
      }
    } finally {
      setBusyCompanyId(null);
    }
  };

  const handleCancelCollection = async (company: CompanyRow) => {
    const { error } = await supabase
      .from('companies')
      .update({ data_collection_status: 'pending', data_collection_progress: null })
      .eq('id', company.id)
      .in('data_collection_status', ['collecting_search_insights', 'collecting_llm_data']);
    if (error) {
      toast.error('Failed to cancel collection');
      return;
    }
    toast.success(`Collection cancelled for ${company.name}`);
    await loadCompanies();
  };

  const byId = new Map(companies.map((c) => [c.id, c]));

  return (
    <div className="space-y-6">
      {!hideHeader && (
        <div className="space-y-2">
          <Button onClick={onBack} variant="ghost" className="text-nightsky/70 hover:text-nightsky -ml-2">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Organizations
          </Button>
          <h1 className="text-3xl font-headline font-bold text-nightsky">{org.name}</h1>
          {org.description && <p className="text-nightsky/60">{org.description}</p>}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <RefreshCw className="h-8 w-8 animate-spin text-pink" />
        </div>
      ) : (
        <OrgReadinessPanel
          companies={companies.map((c) => ({ id: c.id, name: c.name }))}
          reloadKey={reloadKey}
          renderActions={(c) => {
            const company = byId.get(c.id);
            if (!company) return null;
            const busy = isRunning || busyCompanyId === company.id;
            const collecting =
              company.data_collection_status === 'collecting_search_insights' ||
              company.data_collection_status === 'collecting_llm_data';
            return (
              <div className="flex gap-1.5 justify-end">
                {collecting && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-destructive/50 text-destructive hover:bg-destructive/10"
                    disabled={busy}
                    onClick={() => handleCancelCollection(company)}
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1" />
                    Cancel
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-teal/30"
                  disabled={busy}
                  title="Fill missing answers in the latest month, on the models already collected"
                  onClick={() =>
                    refreshAfter(() => runContinueCollection(company.id, org.id, company.name), company.id)
                  }
                >
                  {busyCompanyId === company.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5 mr-1" />
                      Continue
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={busy}
                  onClick={() => setFullRefreshCompany(company)}
                >
                  <RotateCw className="h-3.5 w-3.5 mr-1" />
                  Full refresh
                </Button>
              </div>
            );
          }}
        />
      )}

      <Dialog open={!!fullRefreshCompany} onOpenChange={() => setFullRefreshCompany(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Full refresh</DialogTitle>
            <DialogDescription>
              This will re-run all prompts on the standard models for{' '}
              <strong>{fullRefreshCompany?.name}</strong>. Existing responses may be overwritten. Continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFullRefreshCompany(null)}>
              Cancel
            </Button>
            <Button
              className="bg-pink hover:bg-pink/90"
              onClick={() => {
                const company = fullRefreshCompany;
                setFullRefreshCompany(null);
                if (company) refreshAfter(() => runFullRefresh(company.id, org.id, company.name), company.id);
              }}
            >
              Run full refresh
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
