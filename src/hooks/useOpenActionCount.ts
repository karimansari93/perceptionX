import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Count of actions still needing work, for the sidebar badge.
 *
 * A HEAD request with an exact count rather than reusing useCompanyActions:
 * the sidebar is mounted on every page, and pulling every row (plus assignees)
 * just to render one number would refetch the whole register on each
 * navigation. RLS scopes it, so a member counts only their own org.
 *
 * Matches what the Actions page shows as "All open": published, not retired,
 * not done.
 */
export function useOpenActionCount(organizationId?: string): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!organizationId) {
      setCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      const { count: n, error } = await (supabase as any)
        .from('company_actions')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .not('published_at', 'is', null)
        .neq('register', 'retired')
        .neq('work_status', 'done');
      if (!cancelled) setCount(error ? 0 : (n ?? 0));
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  return count;
}
