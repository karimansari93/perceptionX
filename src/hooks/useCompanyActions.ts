import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCompany } from '@/contexts/CompanyContext';
import type { CompanyAction } from '@/lib/actions';

// Every column: the dismiss fields only exist once their migration is applied,
// and naming them would fail the whole read before then.
const ACTION_COLUMNS = '*';

export const companyActionsKey = (orgId: string | null | undefined) => ['company-actions', orgId ?? null] as const;

// The organisation's action register, one fetch per organisation, shared by
// the Actions tab and the Overview card. Every row in the register is shown;
// what a member may read is decided by RLS alone.
export function useCompanyActions() {
  const { currentCompany } = useCompany();
  const orgId = currentCompany?.organization_id ?? null;

  const query = useQuery({
    queryKey: companyActionsKey(orgId),
    enabled: !!orgId,
    queryFn: async (): Promise<CompanyAction[]> => {
      const { data, error } = await (supabase as any).from('company_actions').select(ACTION_COLUMNS).eq('organization_id', orgId);
      if (error) throw error;
      return ((data || []) as CompanyAction[]).filter((a) => a.organization_id === orgId);
    },
  });

  return { orgId, query, actions: query.data ?? [] };
}
