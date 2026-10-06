-- Which classifier labelled each theme. Set from CLASSIFIER_VERSION in
-- supabase/functions/_shared/theme-analysis.ts by every writer (real-time,
-- bulk, theme-batch). NULL = themed before versioning (pre 2026-10-06 rules).
-- Report pre-flight compares absolute sentiment across periods only when both
-- periods carry the same single version (docs/methodology-sentiment.md).
SET lock_timeout = '5s';
ALTER TABLE public.ai_themes ADD COLUMN IF NOT EXISTS classifier_version text;

-- Rows written since the 2026-10-06 classifier went live (11:32:33 UTC).
UPDATE public.ai_themes SET classifier_version = 'v2-2026-10-06'
WHERE classifier_version IS NULL AND created_at >= '2026-10-06 11:32:33+00';

-- Reference checks queue through theme-batch without touching live themes.
ALTER TABLE public.theme_batch_items ADD COLUMN IF NOT EXISTS apply_result boolean NOT NULL DEFAULT true;

-- Fixed reference set: answers labelled by a known classifier version, used to
-- test any classifier change before it goes live.
CREATE TABLE IF NOT EXISTS public.theme_reference_labels (
  classifier_version text NOT NULL,
  run smallint NOT NULL,
  response_id uuid NOT NULL,
  attribute_name text NOT NULL,
  sentiment text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.theme_reference_labels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.theme_reference_labels FROM anon, authenticated;
