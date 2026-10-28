-- Priority labels on client actions (applied to production by hand on
-- 2026-10-27 as migration company_actions_priority; this file records it so
-- the repo and the database agree, and is safe to re-run).
--
-- Priority is the expected effect on what AI tells candidates: the share of
-- negative opinions the action targets, how much the client controls, and how
-- fast AI picks it up. It is NOT timing: the client decides when to act, so no
-- surface shows "act now / next / later" wording. priority_reason is one
-- sentence explaining the label in the client's own figures.
--
-- Labelled by hand per client; retired and done actions stay null.

ALTER TABLE public.company_actions ADD COLUMN IF NOT EXISTS priority text;
ALTER TABLE public.company_actions ADD COLUMN IF NOT EXISTS priority_reason text;

ALTER TABLE public.company_actions DROP CONSTRAINT IF EXISTS company_actions_priority_check;
ALTER TABLE public.company_actions ADD CONSTRAINT company_actions_priority_check
  CHECK (priority IS NULL OR priority = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]));

COMMENT ON COLUMN public.company_actions.priority IS
  'Expected impact on the score: high, medium or low (share of negatives targeted x client control x speed). Not timing.';
COMMENT ON COLUMN public.company_actions.priority_reason IS
  'One sentence: why this priority, in the client''s own figures.';
