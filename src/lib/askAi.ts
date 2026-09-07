import type { User } from '@supabase/supabase-js';

// Platform-wide kill switch for the in-app analyst. Unset means on; set
// VITE_ASK_AI_ENABLED=false at build time to hide the sidebar entry, the
// overview chat box and the /chat route in one go.
export const ASK_AI_ENABLED = import.meta.env.VITE_ASK_AI_ENABLED !== 'false';

export const ASK_AI_TITLE = 'Ask PerceptionX';
// Sub-line from docs/connect-your-ai-assistant.md.
export const ASK_AI_SUBLINE =
  'Ask a question in plain English and get an answer built from your own dashboard data, with links to the pages the AI models are actually citing.';

// The name we greet with: the first word of the profile name saved at
// first login (mirrored into user_metadata.full_name), else nothing.
export function firstNameOf(user: User | null | undefined): string | null {
  const full = (user?.user_metadata?.full_name as string | undefined)?.trim();
  if (!full) return null;
  return full.split(/\s+/)[0] || null;
}

export function greetingFor(user: User | null | undefined): string {
  const name = firstNameOf(user);
  return name ? `Hey ${name}, what do you want to do today?` : 'Hey, what do you want to do today?';
}
