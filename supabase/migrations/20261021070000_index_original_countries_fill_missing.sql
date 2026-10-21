-- 7 of the 56,160 answers for the 8 original countries came back empty (one
-- model each). Re-queue just those slices: the collector skips models that
-- already answered, so this makes 7 calls.

INSERT INTO public.visibility_queue (config_id, industry, country, status, batch_index, total_prompts, job_function)
VALUES
  ('d426966c-5b9e-418e-a9c6-d77c9c69e7c2', 'Fintech', 'IN', 'pending', 0, 13, NULL),
  ('d426966c-5b9e-418e-a9c6-d77c9c69e7c2', 'Pharmaceutical', 'CN', 'pending', 0, 13, 'Research & Development'),
  ('d426966c-5b9e-418e-a9c6-d77c9c69e7c2', 'Real Estate', 'DE', 'pending', 0, 13, NULL),
  ('d426966c-5b9e-418e-a9c6-d77c9c69e7c2', 'Beauty', 'FR', 'pending', 0, 13, 'Research & Development'),
  ('d426966c-5b9e-418e-a9c6-d77c9c69e7c2', 'Technology', 'AE', 'pending', 0, 13, NULL),
  ('d426966c-5b9e-418e-a9c6-d77c9c69e7c2', 'Financial Services', 'US', 'pending', 0, 13, NULL),
  ('d426966c-5b9e-418e-a9c6-d77c9c69e7c2', 'Petcare', 'IN', 'pending', 0, 13, 'Veterinary');
