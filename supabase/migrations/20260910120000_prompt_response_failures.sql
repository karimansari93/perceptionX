-- Provider failures are not responses.
--
-- The Google edge functions deliberately answer 200 with a failure STRING
-- ("Google search API error: …", "No AI overview available …", "Request timed
-- out …") so a queue run never aborts. collect-company-responses stored that
-- string in prompt_responses as if it were the model's answer: it counted in
-- every visibility denominator and citation total, generated no themes, and —
-- because of the per-month unique index — blocked a real re-run of the prompt
-- for that month (PepsiCo Sep-2026: 6 rows). The collector now skips such rows
-- and records them here instead, so the failure stays auditable and the
-- coverage panel shows the prompt as missing until a recollect fills it.
CREATE TABLE IF NOT EXISTS public.prompt_response_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  confirmed_prompt_id uuid NOT NULL REFERENCES public.confirmed_prompts(id) ON DELETE CASCADE,
  ai_model text NOT NULL,
  error_text text NOT NULL,
  collection_cycle date NULL,
  -- Set when a stored failure row was moved here from prompt_responses
  -- (keeps the original id for traceability); NULL for new failures.
  source_response_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prompt_response_failures_company_month_idx
  ON public.prompt_response_failures (company_id, collection_cycle, ai_model);
ALTER TABLE public.prompt_response_failures ENABLE ROW LEVEL SECURITY;
-- Written by edge functions with the service role; admins read it in Data Health.
GRANT SELECT ON public.prompt_response_failures TO authenticated, service_role;
GRANT INSERT ON public.prompt_response_failures TO service_role;
