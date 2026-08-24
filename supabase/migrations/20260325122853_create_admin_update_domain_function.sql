-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260325122853; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Admin function to update a company's website_domain
-- Uses SECURITY DEFINER to bypass RLS
CREATE OR REPLACE FUNCTION admin_update_company_domain(
  company text,
  new_domain text,
  admin_key text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  expected_key text;
  old_domain text;
BEGIN
  -- Simple secret check - store in Supabase secrets/vault for production
  SELECT decrypted_secret INTO expected_key
  FROM vault.decrypted_secrets
  WHERE name = 'ADMIN_KEY';
  
  IF expected_key IS NULL OR admin_key != expected_key THEN
    RETURN json_build_object('error', 'Unauthorized');
  END IF;

  -- Get old domain
  SELECT website_domain INTO old_domain
  FROM company_canonical_names
  WHERE canonical_name = company;
  
  IF old_domain IS NULL THEN
    RETURN json_build_object('error', 'Company not found');
  END IF;

  -- Update domain
  UPDATE company_canonical_names
  SET website_domain = new_domain
  WHERE canonical_name = company;

  -- Also update the search index
  REFRESH MATERIALIZED VIEW company_search_index;

  RETURN json_build_object(
    'success', true,
    'company', company,
    'old_domain', old_domain,
    'new_domain', new_domain
  );
END;
$$;

