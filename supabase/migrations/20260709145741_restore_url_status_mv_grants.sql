-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260709145741; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Fix regression from 20260707131000: v_company_url_status and
-- v_organization_url_status are security_invoker views that read
-- organization_company_source_urls_mv / organization_source_urls_mv, so the
-- querying (authenticated) role needs SELECT on those materialized views.
-- Revoking it broke the admin recency-coverage tab with 403s. Restore the
-- authenticated grant (anon stays revoked; the tab is authenticated-only).
GRANT SELECT ON public.organization_company_source_urls_mv TO authenticated;
GRANT SELECT ON public.organization_source_urls_mv TO authenticated;
