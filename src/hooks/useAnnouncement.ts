import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { ANNOUNCEMENT_RELEASED_AT, ANNOUNCEMENT_VERSION } from '@/lib/announcements';

const seenKey = (userId: string | null | undefined) => ['announcement', 'seen', ANNOUNCEMENT_VERSION, userId ?? 'anon'] as const;

// Whether the signed-in user still has to see the current announcement.
// `unseen` is false until the row has been checked, so the modal never
// flashes for someone who already dismissed it. Brand-new accounts (created
// after the announcement shipped) are never shown it.
export function useAnnouncement(user: User | null | undefined) {
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  const returning = !!user && (!user.created_at || user.created_at < ANNOUNCEMENT_RELEASED_AT);

  const query = useQuery({
    queryKey: seenKey(userId),
    enabled: !!userId && returning,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('announcement_seen')
        .select('version')
        .eq('user_id', userId as string)
        .eq('version', ANNOUNCEMENT_VERSION)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });

  // Fail closed: a read error means "don't show" — never nag on a hiccup.
  const unseen = returning && query.isSuccess && query.data === false;

  const markSeen = useCallback(async () => {
    if (!userId) return;
    queryClient.setQueryData(seenKey(userId), true);
    const { error } = await supabase
      .from('announcement_seen')
      .upsert({ user_id: userId, version: ANNOUNCEMENT_VERSION }, { onConflict: 'user_id,version', ignoreDuplicates: true });
    if (error) console.error('announcement_seen write failed:', error);
  }, [queryClient, userId]);

  return { unseen, markSeen };
}

export interface IntegrationRequestInput {
  userId: string;
  organizationId: string | null;
  tools: string[];
  other: string;
  note: string;
  replyTo: string;
}

// The "which assistants does your team use?" form → the integration-request
// edge function, which stores the row and posts it to Slack.
export async function submitIntegrationRequest(input: IntegrationRequestInput): Promise<void> {
  const { data, error } = await supabase.functions.invoke('integration-request', {
    body: { organizationId: input.organizationId, tools: input.tools, other: input.other.trim(), note: input.note.trim() },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'request failed');
}
