-- Job-function slice for the industry visibility index (October 2026).
-- A queue job with job_function set collects the 13 discovery prompts for that
-- function's roles within the industry (collect-industry-visibility
-- `jobFunction`). Null keeps the existing industry-wide behaviour.
ALTER TABLE public.visibility_queue
  ADD COLUMN IF NOT EXISTS job_function text;
