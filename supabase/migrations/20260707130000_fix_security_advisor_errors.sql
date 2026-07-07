-- Fix all ERROR-level Supabase security advisor findings.
--
-- 1) rls_disabled_in_public: the seven company_*_mv per-company metric cache
--    tables are exposed over PostgREST with no RLS, so any authenticated (or
--    anon) request can read every company's metrics across tenants. The
--    dashboard always queries them as an authenticated user filtered by
--    company_id, and writes happen only through the SECURITY DEFINER
--    _refresh_cm_* functions (table owner bypasses RLS) and service_role,
--    so a single org-scoped SELECT policy is sufficient.
--
-- 2) security_definer_view: five views default to SECURITY DEFINER and
--    bypass RLS on their underlying tables. Every underlying table already
--    has RLS policies that grant the intended readers access
--    (prompt_responses/ai_themes/confirmed_prompts are org-scoped,
--    company_visibility_history and company_employee_tiers are public-read),
--    so the views can safely run as the invoker.

-- 1. Enable RLS on the per-company metric cache tables.
ALTER TABLE public.company_sentiment_scores_mv ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_relevance_scores_mv ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_top_sources_mv ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_competitors_mv ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_llm_rankings_mv ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_attribute_themes_mv ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_response_sentiment_mv ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'company_sentiment_scores_mv',
    'company_relevance_scores_mv',
    'company_top_sources_mv',
    'company_competitors_mv',
    'company_llm_rankings_mv',
    'company_attribute_themes_mv',
    'company_response_sentiment_mv'
  ] LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "Org members can read their companies" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "Org members can read their companies" ON public.%I
         FOR SELECT TO authenticated
         USING (public.user_can_access_company(company_id))', t);
  END LOOP;
END $$;

-- 2. Make the flagged views run with the querying user's permissions.
ALTER VIEW public.v_company_url_status SET (security_invoker = true);
ALTER VIEW public.company_visibility_resolved SET (security_invoker = true);
ALTER VIEW public.canonical_names_summary SET (security_invoker = true);
ALTER VIEW public.prompt_responses_canonical SET (security_invoker = true);
ALTER VIEW public.theme_analysis_summary SET (security_invoker = true);
