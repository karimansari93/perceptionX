import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCompany } from '@/contexts/CompanyContext';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { CompanyAction } from '@/lib/actions';

const ACTION_COLUMNS = 'id, organization_id, company_id, key, register, title, cycle_raised, action_number, problem, ai_says, ai_reads, urls, recommendation, lanes, timing, work_kind, source_domain, markets, owner_name, assignee_id, work_status, tracking_status, assertion_note, assertion_url, asserted_done_at, notes, published_at, created_at';

export const companyActionsKey = (orgId: string | null | undefined) => ['company-actions', orgId ?? null] as const;

// The organisation's action register, one fetch per organisation, shared by
// the Actions tab and the Overview card. RLS returns published rows only to
// members; platform admins get drafts too, which stay hidden unless they turn
// on "Include unpublished".
export function useCompanyActions() {
  const { currentCompany, isPlatformAdmin } = useCompany();
  const orgId = currentCompany?.organization_id ?? null;
  const [includeDrafts, setIncludeDrafts] = usePersistedState<boolean>('actions.includeDrafts', false);

  const query = useQuery({
    queryKey: companyActionsKey(orgId),
    enabled: !!orgId,
    queryFn: async (): Promise<CompanyAction[]> => {
      const { data, error } = await (supabase as any).from('company_actions').select(ACTION_COLUMNS).eq('organization_id', orgId);
      if (error) throw error;
      return ((data || []) as CompanyAction[]).filter((a) => a.organization_id === orgId);
    },
  });

  const showDrafts = isPlatformAdmin && includeDrafts;
  const actions = useMemo(
    () => (query.data ?? []).filter((a) => showDrafts || a.published_at != null),
    [query.data, showDrafts],
  );

  return { orgId, query, actions, includeDrafts, setIncludeDrafts, canIncludeDrafts: isPlatformAdmin };
}
