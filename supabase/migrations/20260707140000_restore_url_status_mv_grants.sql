-- Fix regression from 20260707131000.
--
-- v_company_url_status and v_organization_url_status are security_invoker views
-- that read organization_company_source_urls_mv / organization_source_urls_mv.
-- With security_invoker, the querying (authenticated) role needs SELECT on the
-- underlying materialized views. The previous migration revoked that grant
-- (the MVs have no direct client references, only these indirect view reads),
-- which broke the admin recency-coverage tab with 403 Forbidden errors.
--
-- Restore SELECT for authenticated. anon stays revoked: the recency-coverage
-- tab is authenticated/admin-only.
GRANT SELECT ON public.organization_company_source_urls_mv TO authenticated;
GRANT SELECT ON public.organization_source_urls_mv TO authenticated;
