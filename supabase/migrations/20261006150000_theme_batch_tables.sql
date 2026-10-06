-- Re-theme responses through the Message Batches API (half price, same model,
-- prompt and schema as live theming via _shared/theme-analysis.ts).
--
-- theme_batch_items is the queue: one row per response per run. The
-- theme-batch edge function (cron, every minute) submits queued rows as
-- batches, collects finished batches into `result`, then applies results by
-- replacing the response's ai_themes / competitor_themes rows.
--
-- status: queued -> submitted -> stored -> applied
--         errored results go back to queued until attempts reach 3 (failed)

CREATE TABLE IF NOT EXISTS public.theme_batch_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_label text NOT NULL,
  company_name text NOT NULL,
  anthropic_batch_id text NOT NULL,
  key_slot text NOT NULL,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'collected', 'failed')),
  request_count int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  collected_at timestamptz,
  last_error text
);

CREATE TABLE IF NOT EXISTS public.theme_batch_items (
  run_label text NOT NULL,
  response_id uuid NOT NULL,
  company_name text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'submitted', 'stored', 'applied', 'failed')),
  job_id uuid REFERENCES public.theme_batch_jobs(id) ON DELETE SET NULL,
  attempts int NOT NULL DEFAULT 0,
  competitors text[] NOT NULL DEFAULT '{}',
  result jsonb,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_label, response_id)
);
CREATE INDEX IF NOT EXISTS theme_batch_items_status_idx ON public.theme_batch_items (status, company_name);
CREATE INDEX IF NOT EXISTS theme_batch_items_job_idx ON public.theme_batch_items (job_id);

-- Single-runner lease so overlapping cron invocations never double-submit.
CREATE TABLE IF NOT EXISTS public.theme_batch_lease (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  leased_until timestamptz NOT NULL DEFAULT 'epoch'
);
INSERT INTO public.theme_batch_lease (id) VALUES (true) ON CONFLICT DO NOTHING;

ALTER TABLE public.theme_batch_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.theme_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.theme_batch_lease ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS theme_batch_jobs_admin_read ON public.theme_batch_jobs;
CREATE POLICY theme_batch_jobs_admin_read ON public.theme_batch_jobs FOR SELECT USING (public.is_admin());
DROP POLICY IF EXISTS theme_batch_items_admin_read ON public.theme_batch_items;
CREATE POLICY theme_batch_items_admin_read ON public.theme_batch_items FOR SELECT USING (public.is_admin());
REVOKE ALL ON public.theme_batch_jobs, public.theme_batch_items, public.theme_batch_lease FROM anon;

-- Bulk field update for the queue: each element is {run_label, response_id,
-- ...fields}; a field present in the element overwrites, an absent one is kept.
CREATE OR REPLACE FUNCTION public.theme_batch_update_items(p_rows jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  UPDATE theme_batch_items i SET
    status      = COALESCE(r->>'status', i.status),
    job_id      = CASE WHEN r ? 'job_id' THEN (r->>'job_id')::uuid ELSE i.job_id END,
    attempts    = COALESCE((r->>'attempts')::int, i.attempts),
    competitors = CASE WHEN r ? 'competitors'
                       THEN ARRAY(SELECT jsonb_array_elements_text(r->'competitors'))
                       ELSE i.competitors END,
    result      = CASE WHEN r ? 'result' THEN r->'result' ELSE i.result END,
    error       = CASE WHEN r ? 'error' THEN r->>'error' ELSE i.error END,
    updated_at  = now()
  FROM jsonb_array_elements(p_rows) r
  WHERE i.run_label = r->>'run_label' AND i.response_id = (r->>'response_id')::uuid;
$$;
REVOKE ALL ON FUNCTION public.theme_batch_update_items(jsonb) FROM PUBLIC, anon, authenticated;
