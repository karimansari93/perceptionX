import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

// Platform admin = a row in user_roles with role 'admin', the same check
// public.is_admin() applies in every admin RLS policy. Admins are granted
// and revoked from the admin Users tab (set_platform_admin), never by
// editing an email list in code.

// One lookup per signed-in user per page load; every caller shares it.
const cache = new Map<string, Promise<boolean>>();

export const fetchIsPlatformAdmin = (userId: string | undefined | null): Promise<boolean> => {
  if (!userId) return Promise.resolve(false);
  let pending = cache.get(userId);
  if (!pending) {
    pending = (async () => {
      const { data, error } = await supabase.rpc('is_admin' as never);
      if (error) {
        // Don't cache a failed lookup, so the next caller retries.
        cache.delete(userId);
        return false;
      }
      return data === true;
    })();
    cache.set(userId, pending);
  }
  return pending;
};

/** Call after changing someone's admin access so the next check re-reads it. */
export const clearPlatformAdminCache = () => cache.clear();

export const useIsPlatformAdmin = (): { isAdmin: boolean; loading: boolean } => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [state, setState] = useState<{ userId: string | null; isAdmin: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchIsPlatformAdmin(userId).then((isAdmin) => {
      if (!cancelled) setState({ userId, isAdmin });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const loading = !state || state.userId !== userId;
  return { isAdmin: !loading && state!.isAdmin, loading };
};
