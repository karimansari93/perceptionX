-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260206134644; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Update clean_company_name to normalize company variants

CREATE OR REPLACE FUNCTION public.clean_company_name(name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  cleaned TEXT;
BEGIN
  -- Step 1: Basic cleanup - trim and remove quotes
  cleaned := TRIM(BOTH ' "''' FROM TRIM(name));
  
  -- Step 2: Normalize to lowercase for comparison
  cleaned := LOWER(cleaned);
  
  -- Step 3: Company-specific normalization
  
  -- NBCUniversal / Comcast NBCUniversal variants
  IF cleaned ~ 'comcast.*nbcuniversal|nbcuniversal.*comcast|comcast/nbcuniversal' THEN
    RETURN 'NBCUniversal';
  ELSIF cleaned = 'nbcuniversal' THEN
    RETURN 'NBCUniversal';
  END IF;
  
  -- Return cleaned name (will be lowercase for everything else)
  RETURN cleaned;
END;
$function$;

-- Refresh the rankings_overview to apply the new normalization
REFRESH MATERIALIZED VIEW public.rankings_overview;

