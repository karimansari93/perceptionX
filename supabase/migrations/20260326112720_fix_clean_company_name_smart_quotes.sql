-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260326112720; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Update clean_company_name to normalize smart quotes to ASCII
CREATE OR REPLACE FUNCTION public.clean_company_name(name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  cleaned TEXT;
BEGIN
  cleaned := TRIM(BOTH ' "''' FROM TRIM(name));
  -- Normalize smart/curly quotes to ASCII equivalents
  cleaned := normalize_quotes(cleaned);
  cleaned := LOWER(cleaned);
  IF cleaned ~ 'comcast.*nbcuniversal|nbcuniversal.*comcast|comcast/nbcuniversal' THEN
    RETURN 'NBCUniversal';
  ELSIF cleaned = 'nbcuniversal' THEN
    RETURN 'NBCUniversal';
  END IF;
  RETURN cleaned;
END;
$function$;

