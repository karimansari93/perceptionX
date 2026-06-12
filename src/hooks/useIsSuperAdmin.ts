import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface SuperAdminOrg {
  organization_id: string;
  organization_name: string;
}

// Organizations where the current user is an owner/admin ("Super Admin") —
// i.e. orgs they can invite teammates into.
export function useSuperAdminOrgs(): { orgs: SuperAdminOrg[]; loading: boolean } {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState<SuperAdminOrg[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setOrgs([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('organization_members')
        .select('organization_id, role, organizations(name)')
        .eq('user_id', user.id)
        .in('role', ['owner', 'admin']);
      if (!cancelled) {
        setOrgs(
          error
            ? []
            : (data ?? []).map((m) => {
                const org = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
                return {
                  organization_id: m.organization_id,
                  organization_name: (org as { name?: string } | null)?.name ?? 'Your organization',
                };
              }),
        );
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return { orgs, loading };
}

// True when the current user is a Super Admin of at least one organization.
export function useIsSuperAdmin(): boolean {
  const { orgs } = useSuperAdminOrgs();
  return orgs.length > 0;
}
