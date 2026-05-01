-- Add 'expand_setup' phase to company_batch_queue.
-- This phase is used by the Admin → Expand Coverage flow, where the target
-- company already exists and prompts must be appended to it rather than going
-- through the onboarding/auto-create-company trigger (which always forks a new
-- companies row, causing duplicate Netflix/GSK/etc. records).

ALTER TABLE public.company_batch_queue
    DROP CONSTRAINT IF EXISTS company_batch_queue_phase_check;

ALTER TABLE public.company_batch_queue
    ADD CONSTRAINT company_batch_queue_phase_check
    CHECK (phase IN ('setup', 'expand_setup', 'search_insights', 'llm_collection', 'done'));
