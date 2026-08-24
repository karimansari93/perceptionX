-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260221115858; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Create a helper function that checks source classification with prefix matching
-- This handles variants like "great place to work france", "glassdoor uk", etc.
CREATE OR REPLACE FUNCTION public.is_source_entity(p_company_name text, p_canonical_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_entity_classifications ec
    WHERE ec.entity_type = 'source'
      AND (
        -- Exact match on raw name
        ec.company_name = lower(trim(p_company_name))
        -- Exact match on canonical name
        OR ec.company_name = lower(trim(p_canonical_name))
        -- Prefix match: "glassdoor uk" starts with classified source "glassdoor"
        OR lower(trim(p_company_name)) LIKE (ec.company_name || '%')
        OR lower(trim(p_canonical_name)) LIKE (ec.company_name || '%')
      )
  );
$$;

