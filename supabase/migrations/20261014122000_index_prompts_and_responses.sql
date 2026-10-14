-- Separate storage for the visibility index (October 2026).
--
-- Index collection used to write industry-wide prompts into confirmed_prompts
-- and their answers into prompt_responses (company_id null, for_index true),
-- alongside client data. From now on collect-industry-visibility writes here
-- instead, so index runs never touch client tables, dashboards or theming.
--
-- Index answers are never themed. Nothing in the theming pipeline reads these
-- tables; keep it that way.
--
-- The public Index views (rankings_overview, rankings_historical) still read
-- the legacy rows in prompt_responses. Moving those rows across and pointing
-- the views here is a separate, signed-off step.

CREATE TABLE IF NOT EXISTS public.index_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_text text NOT NULL,
  attribute_id text NOT NULL,
  prompt_category text,
  prompt_theme text,
  industry text NOT NULL,
  -- Full country name; null = global (no location in the prompt).
  country text,
  -- Null = industry-wide prompt; otherwise the job function the prompt asks about.
  job_function text,
  prompt_version integer NOT NULL DEFAULT 2,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT index_prompts_slice_key
    UNIQUE NULLS NOT DISTINCT (industry, country, job_function, attribute_id, prompt_version)
);

CREATE TABLE IF NOT EXISTS public.index_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  index_prompt_id uuid NOT NULL REFERENCES public.index_prompts(id) ON DELETE CASCADE,
  ai_model text NOT NULL,
  response_text text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Comma-separated company names from detect-competitors.
  detected_competitors text,
  -- Null = current period; set when a period is archived.
  index_period text,
  tested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT index_responses_prompt_model_period_key
    UNIQUE NULLS NOT DISTINCT (index_prompt_id, ai_model, index_period)
);

CREATE INDEX IF NOT EXISTS index_prompts_industry_country_idx
  ON public.index_prompts (industry, country);
CREATE INDEX IF NOT EXISTS index_responses_tested_at_idx
  ON public.index_responses (tested_at);

-- Service role only (edge functions). No anon or authenticated access.
ALTER TABLE public.index_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.index_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.index_prompts, public.index_responses FROM anon, authenticated;
