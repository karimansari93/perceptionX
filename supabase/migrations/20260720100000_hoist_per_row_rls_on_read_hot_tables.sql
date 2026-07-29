-- Replace per-row user_can_access_company(company_id) calls in the select
-- policies of read-hot tables with the hashable IN-subquery form already
-- used by prompt_responses_select_policy / confirmed_prompts_select_policy.
--
-- user_can_access_company() is SECURITY DEFINER and therefore never inlined:
-- Postgres calls it once per scanned row (~97 buffer hits cold, ~0.2-1.6ms
-- each). Measured on the 18-profile Ford brand: 200ms to read 1000
-- company_response_sentiment_mv rows, 1.6s per 1000 ai_themes rows — pure
-- policy overhead, paid across ~30k first-paint MV rows per brand entry.
-- After the rewrite the same sentiment-MV read is 1.7ms: the membership
-- subquery runs once per statement ((select auth.uid()) and
-- (select is_admin()) are initplans) and each row is a hash probe.
--
-- Semantics are identical by construction:
--   user_can_access_company(c) = is_admin() OR EXISTS (
--     select 1 from organization_companies oc
--     join organization_members om on om.organization_id = oc.organization_id
--     where oc.company_id = c and om.user_id = auth.uid())
-- which is exactly: is_admin() OR c IN (<the subquery below>).
-- Verified in production: member sees identical counts on all eight tables,
-- non-member sees zero rows, admin (non-member) sees everything.
--
-- Deliberately not touched: low-traffic select policies (companies,
-- company_industries, company_owned_domains/_patterns — bounded to dozens of
-- rows per read) and all write policies (single-row operations).

ALTER POLICY ai_themes_select_policy ON public.ai_themes
USING (
  (SELECT is_admin()) OR company_id IN (
    SELECT oc.company_id
    FROM organization_companies oc
    JOIN organization_members om ON om.organization_id = oc.organization_id
    WHERE om.user_id = (SELECT auth.uid())
  )
);

ALTER POLICY "Org members can read their companies" ON public.company_response_sentiment_mv
USING (
  (SELECT is_admin()) OR company_id IN (
    SELECT oc.company_id
    FROM organization_companies oc
    JOIN organization_members om ON om.organization_id = oc.organization_id
    WHERE om.user_id = (SELECT auth.uid())
  )
);

ALTER POLICY "Org members can read their companies" ON public.company_attribute_themes_mv
USING (
  (SELECT is_admin()) OR company_id IN (
    SELECT oc.company_id
    FROM organization_companies oc
    JOIN organization_members om ON om.organization_id = oc.organization_id
    WHERE om.user_id = (SELECT auth.uid())
  )
);

ALTER POLICY "Org members can read their companies" ON public.company_sentiment_scores_mv
USING (
  (SELECT is_admin()) OR company_id IN (
    SELECT oc.company_id
    FROM organization_companies oc
    JOIN organization_members om ON om.organization_id = oc.organization_id
    WHERE om.user_id = (SELECT auth.uid())
  )
);

ALTER POLICY "Org members can read their companies" ON public.company_relevance_scores_mv
USING (
  (SELECT is_admin()) OR company_id IN (
    SELECT oc.company_id
    FROM organization_companies oc
    JOIN organization_members om ON om.organization_id = oc.organization_id
    WHERE om.user_id = (SELECT auth.uid())
  )
);

ALTER POLICY "Org members can read their companies" ON public.company_top_sources_mv
USING (
  (SELECT is_admin()) OR company_id IN (
    SELECT oc.company_id
    FROM organization_companies oc
    JOIN organization_members om ON om.organization_id = oc.organization_id
    WHERE om.user_id = (SELECT auth.uid())
  )
);

ALTER POLICY "Org members can read their companies" ON public.company_competitors_mv
USING (
  (SELECT is_admin()) OR company_id IN (
    SELECT oc.company_id
    FROM organization_companies oc
    JOIN organization_members om ON om.organization_id = oc.organization_id
    WHERE om.user_id = (SELECT auth.uid())
  )
);

ALTER POLICY "Org members can read their companies" ON public.company_llm_rankings_mv
USING (
  (SELECT is_admin()) OR company_id IN (
    SELECT oc.company_id
    FROM organization_companies oc
    JOIN organization_members om ON om.organization_id = oc.organization_id
    WHERE om.user_id = (SELECT auth.uid())
  )
);
