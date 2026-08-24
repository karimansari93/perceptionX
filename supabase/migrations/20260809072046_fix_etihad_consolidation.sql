-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260809072046; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Fix Etihad split (see repo migration 20260809150000_fix_etihad_consolidation.sql).
-- Repoint 'etihad airways' at the pre-existing 'Etihad' canonical (tier + slug live);
-- row keeps etihad.com as the domain fallback for the canonical.
UPDATE public.company_canonical_names
SET canonical_name = 'Etihad',
    brand_key      = 'etihad',
    variant_type   = 'alias'
WHERE variant_name = 'etihad airways'
  AND canonical_name = 'Etihad Airways';
