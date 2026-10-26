// The quarterly update email, admin side: the three calls into the
// quarterly-digest edge function. Platform admins only (the function checks).

import { supabase } from '@/integrations/supabase/client';

export interface DigestPreview {
  html: string;
  subject: string;
  payload: unknown;
}

export interface DigestTestResult {
  sentTo: string;
  subject: string;
  resendId: string;
  conversationId: string | null;
  period: string;
}

export interface DigestSendResult {
  organizationId: string;
  attempted: number;
  results: Array<{ email: string; status: 'sent' | 'failed'; error?: string; conversationId?: string | null }>;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('quarterly-digest', { body });
  if (error) {
    // The function's own error text is in the response body; surface it.
    let detail = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const j = await ctx.json();
        if (j?.error) detail = j.error;
      }
    } catch { /* keep the generic message */ }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(String(data.error));
  return data as T;
}

/** Render one member's email without sending or creating anything. */
export const previewDigest = (memberId: string) => call<DigestPreview>({ action: 'preview', memberId });

/** Send one member's email to the caller's own inbox (with a chat thread for the caller). */
export const sendDigestTest = (memberId: string) => call<DigestTestResult>({ action: 'send_test', memberId });

/** Send to every member on the organization's list. */
export const sendDigestToList = (organizationId: string) =>
  call<DigestSendResult>({ action: 'send', organizationId, confirm: true });
