-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260713071957; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Index already built with CREATE INDEX CONCURRENTLY on 2026-07-13;
-- recorded here so migration history matches the repo.
CREATE INDEX IF NOT EXISTS idx_prompt_responses_tested_at_missing_themes
ON public.prompt_responses (tested_at DESC)
WHERE response_text IS NOT NULL AND COALESCE(for_index, false) = false;
