-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260218070311; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- ============================================================
-- FIX 7: Consolidate duplicate permissive SELECT policies
-- Split the ALL policy into separate INSERT/UPDATE/DELETE for admins
-- Keep the single SELECT policy for all authenticated users
-- ============================================================

DROP POLICY "Admins can manage canonical names" ON company_canonical_names;

-- Admins can write (INSERT, UPDATE, DELETE) — no overlap with SELECT
CREATE POLICY "Admins can insert canonical names" ON company_canonical_names
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_admin()));

CREATE POLICY "Admins can update canonical names" ON company_canonical_names
  FOR UPDATE TO authenticated
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

CREATE POLICY "Admins can delete canonical names" ON company_canonical_names
  FOR DELETE TO authenticated
  USING ((SELECT is_admin()));

