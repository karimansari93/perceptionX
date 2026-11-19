-- Employer Narrative: claims and claim matches.
-- Approved by Karim in-session, 2026-11-19.
--
-- Scope of the first test (Karim, 2026-11-19): United States only, Ford and
-- Netflix. Nothing in the schema limits it to the US; the scope lives in the
-- loaded claims and in the matching job's filter.
--
-- Design notes
-- - Themes use the live classifier ids (attribute_id on ai_themes), checked
--   below against the 13 v2 ids. No new taxonomy.
-- - Market and function store the exact spellings from
--   confirmed_prompts.location_context / job_function_context (Ford uses
--   'United States', Netflix 'the United States'). NULL = all markets / all
--   functions.
-- - A match row is one verdict for one claim against one AI answer. The
--   assistant, answer text and cited sources are NOT copied: they are joined
--   from prompt_responses (ai_model, response_text, canonical_citations), so
--   there is one source of truth.
-- - Claim status (aligned / gap / contradiction / inaccurate) is derived from
--   match rows in a view, not stored, so thresholds can change without
--   rewriting data.
-- - Clients only see claims and matches once published_at is set, same
--   pattern as company_actions. Writes are admin-only for the test; client
--   editing arrives with the screen.

CREATE TABLE public.narrative_claims (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id),
  company_id       uuid NOT NULL REFERENCES public.companies(id),
  claim_text       text NOT NULL CHECK (length(btrim(claim_text)) > 0),
  original_text    text,               -- scanned wording, kept when a client edits
  attribute_id     text NOT NULL CHECK (attribute_id IN (
                     'mission-purpose-impact','compensation','company-culture',
                     'leadership','job-security','career-opportunities',
                     'wellbeing-balance','inclusion','innovation',
                     'application-communication','candidate-feedback',
                     'interview-experience','onboarding-experience')),
  location_context     text,           -- NULL = all markets
  job_function_context text,           -- NULL = all functions
  source_url       text,
  source_type      text NOT NULL CHECK (source_type IN
                     ('career_site','job_ad','newsroom','client_input','other')),
  found_on         date,
  origin           text NOT NULL DEFAULT 'scanned'
                     CHECK (origin IN ('scanned','client_edited','client_added')),
  scan_batch       text,               -- e.g. 'karim-2026-11-ford-us'
  is_active        boolean NOT NULL DEFAULT true,
  published_at     timestamptz,
  created_by       uuid REFERENCES auth.users(id),
  updated_by       uuid REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX narrative_claims_company_idx
  ON public.narrative_claims (company_id, attribute_id) WHERE is_active;

CREATE TABLE public.narrative_claim_matches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id         uuid NOT NULL REFERENCES public.narrative_claims(id) ON DELETE CASCADE,
  response_id      uuid NOT NULL REFERENCES public.prompt_responses(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES public.organizations(id),
  verdict          text NOT NULL CHECK (verdict IN
                     ('echoes','silent','contradicts','inaccurate')),
  evidence_quote   text,               -- verbatim span from the answer; required below
  reason           text,               -- one line from the matcher, internal only
  matcher_version  text NOT NULL,      -- e.g. 'narrative-v1-2026-11'
  review_status    text NOT NULL DEFAULT 'not_needed'
                     CHECK (review_status IN ('not_needed','pending','confirmed','rejected')),
  reviewed_by      uuid REFERENCES auth.users(id),
  reviewed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (claim_id, response_id, matcher_version),
  -- Echo, contradiction and inaccuracy must quote the answer.
  CHECK (verdict = 'silent' OR evidence_quote IS NOT NULL),
  -- Every inaccuracy goes through PerceptionX review before a client sees it.
  CHECK (verdict <> 'inaccurate' OR review_status IN ('pending','confirmed','rejected'))
);

CREATE INDEX narrative_claim_matches_claim_idx
  ON public.narrative_claim_matches (claim_id, matcher_version);
CREATE INDEX narrative_claim_matches_response_idx
  ON public.narrative_claim_matches (response_id);

ALTER TABLE public.narrative_claims        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.narrative_claim_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY narrative_claims_select ON public.narrative_claims
  FOR SELECT TO authenticated
  USING (is_admin() OR (published_at IS NOT NULL AND is_org_member(organization_id)));

CREATE POLICY narrative_claims_admin_write ON public.narrative_claims
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY narrative_claim_matches_select ON public.narrative_claim_matches
  FOR SELECT TO authenticated
  USING (is_admin() OR (
    is_org_member(organization_id)
    AND review_status <> 'pending' AND review_status <> 'rejected'
    AND EXISTS (SELECT 1 FROM public.narrative_claims c
                 WHERE c.id = narrative_claim_matches.claim_id
                   AND c.published_at IS NOT NULL)));

CREATE POLICY narrative_claim_matches_admin_write ON public.narrative_claim_matches
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

REVOKE ALL ON public.narrative_claims, public.narrative_claim_matches FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.narrative_claims TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.narrative_claim_matches TO authenticated;
