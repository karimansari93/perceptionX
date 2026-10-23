-- The source filter hid real employers (Karim, 2026-10-18: "yeah fix").
-- is_source_entity() drops names the AI cites as sources (Glassdoor, Great
-- Place to Work, news outlets). Its prefix rule also dropped every company
-- whose name merely started with a source's letters: Ryanair ("ryan"),
-- Mitsubishi, Mitsui and MUFG ("mit"), CapitaLand ("capital"), and every
-- company starting with a city or country on the source list (Singapore
-- Airlines, China Mobile, Riyadh Air, Amsterdam UMC, Toronto-Dominion Bank).
--
-- Now a source only covers longer names when it is followed by more words or
-- a domain ("glassdoor india", "indeed.com", "great place to work mexico"),
-- and places and generic words never act as prefixes. Exact matches and the
-- recruiter and university patterns are unchanged.

CREATE OR REPLACE FUNCTION public.is_source_entity(p_company_name text, p_canonical_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_entity_classifications ec
    CROSS JOIN LATERAL (VALUES (lower(trim(p_company_name))), (lower(trim(p_canonical_name)))) AS n(name)
    WHERE ec.entity_type = 'source'
      AND (
        ec.company_name = n.name
        OR (length(ec.company_name) >= 3
            AND ec.company_name <> ALL (ARRAY[
              -- places
              'amsterdam', 'bangalore', 'beijing', 'berlin', 'brazil', 'cairo', 'cambridge', 'chennai',
              'china', 'delhi', 'doha', 'dubai', 'france', 'germany', 'hyderabad', 'india', 'kolkata',
              'lagos', 'london', 'mumbai', 'nairobi', 'oxford', 'paris', 'pune', 'riyadh', 'shanghai',
              'singapore', 'sydney', 'tokyo', 'toronto', 'uae',
              -- words that start real company names
              'capital', 'enterprise', 'global', 'government', 'group', 'startup', 'time', 'medium',
              'fortune', 'monster', 'paradox'])
            AND (n.name LIKE ec.company_name || ' %' OR n.name LIKE ec.company_name || '.%'
                 OR n.name LIKE ec.company_name || '-%' OR n.name LIKE ec.company_name || ',%'))
      )
  )
  OR (
    -- Recruiting/staffing pattern matching
    lower(trim(p_company_name)) ~ '(recruitment|recruiting|staffing|headhunt|executive search)'
    OR lower(trim(p_canonical_name)) ~ '(recruitment|recruiting|staffing|headhunt|executive search)'
  )
  OR (
    -- University/academic pattern matching
    lower(trim(p_company_name)) ~ '(^university of |university$| university | nhs foundation trust| nhs ft$| nhs trust$)'
    OR lower(trim(p_canonical_name)) ~ '(^university of |university$| university | nhs foundation trust| nhs ft$| nhs trust$)'
  );
$function$;

-- One restored employer had a size label far too small (about 19,000 staff).
UPDATE public.company_employee_tiers
SET estimated_tier = '5000-49999', confidence = 'medium', classified_by = 'manual', classified_at = now()
WHERE lower(company_name) = 'amsterdam umc';
