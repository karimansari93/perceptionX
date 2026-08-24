-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260208143304; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Add indexes to reduce disk IO on frequently queried columns

-- Rankings overview - country filter is heavily used
CREATE INDEX IF NOT EXISTS idx_rankings_overview_country 
ON rankings_overview(country);

-- Prompt responses - created_at is used for ordering
CREATE INDEX IF NOT EXISTS idx_prompt_responses_created_at 
ON prompt_responses(created_at DESC);

-- Prompt responses - confirmed_prompt_id for joins
CREATE INDEX IF NOT EXISTS idx_prompt_responses_confirmed_prompt_id 
ON prompt_responses(confirmed_prompt_id);

-- Confirmed prompts - prompt_type filter
CREATE INDEX IF NOT EXISTS idx_confirmed_prompts_prompt_type 
ON confirmed_prompts(prompt_type);

-- Composite index for the most expensive query pattern
CREATE INDEX IF NOT EXISTS idx_prompt_responses_composite 
ON prompt_responses(confirmed_prompt_id, created_at DESC);
