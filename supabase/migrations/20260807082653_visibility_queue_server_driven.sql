-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260807082653; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Server-driven visibility queue: the admin UI now enqueues jobs via
-- process-visibility-queue instead of looping in the browser, so runs
-- survive tab close (parity with company batch collection).

-- Optional per-run model subset (e.g. {openai,gemini}); null = all models.
alter table public.visibility_queue
  add column if not exists models text[];

-- Methodology v2: 13 discovery prompts per industry/country (was 16).
alter table public.visibility_queue
  alter column total_prompts set default 13;
