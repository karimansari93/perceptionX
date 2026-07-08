-- admin_data_health_overview() and admin_data_health_org() were declared
-- STABLE but execute `SET LOCAL statement_timeout` in their bodies, which
-- Postgres forbids in non-volatile functions (0A000: "SET is not allowed in
-- a non-volatile function"). Every call therefore failed with a 400.
-- Mark them VOLATILE so the per-call timeout override is permitted.
ALTER FUNCTION public.admin_data_health_overview() VOLATILE;
ALTER FUNCTION public.admin_data_health_org(uuid) VOLATILE;
