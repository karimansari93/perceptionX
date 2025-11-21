-- Add job function and location context columns for prompt variants
ALTER TABLE confirmed_prompts
  ADD COLUMN IF NOT EXISTS job_function_context TEXT,
  ADD COLUMN IF NOT EXISTS location_context TEXT;

COMMENT ON COLUMN confirmed_prompts.job_function_context IS 'Optional job function context for a prompt variant (e.g., Software Engineers).';
COMMENT ON COLUMN confirmed_prompts.location_context IS 'Optional location context for a prompt variant (e.g., Toronto or UK).';







