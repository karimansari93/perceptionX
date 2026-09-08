-- Each chat thread snapshots the scope it was answered in (company, markets,
-- job functions, period) so reopening an old chat shows that scope, not
-- today's filters. Written by the app under the owner's RLS policy.
ALTER TABLE public.chat_conversations ADD COLUMN IF NOT EXISTS scope jsonb;
