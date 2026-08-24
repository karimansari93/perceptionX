-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260210053102; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Fix clean_company_name
CREATE OR REPLACE FUNCTION public.clean_company_name(name text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path = public
AS $function$
DECLARE
  cleaned TEXT;
BEGIN
  cleaned := TRIM(BOTH ' "''' FROM TRIM(name));
  cleaned := LOWER(cleaned);
  IF cleaned ~ 'comcast.*nbcuniversal|nbcuniversal.*comcast|comcast/nbcuniversal' THEN
    RETURN 'NBCUniversal';
  ELSIF cleaned = 'nbcuniversal' THEN
    RETURN 'NBCUniversal';
  END IF;
  RETURN cleaned;
END;
$function$;

-- Fix get_canonical_company_name
CREATE OR REPLACE FUNCTION public.get_canonical_company_name(raw_name text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path = public
AS $function$
DECLARE
  canonical TEXT;
BEGIN
  SELECT cm.canonical_name INTO canonical
  FROM company_variants cv
  JOIN company_master cm ON cv.company_master_id = cm.id
  WHERE LOWER(cv.variant_name) = LOWER(raw_name)
  LIMIT 1;
  IF canonical IS NOT NULL THEN
    RETURN canonical;
  END IF;
  RETURN clean_company_name(raw_name);
END;
$function$;

-- Fix normalize_company_name
CREATE OR REPLACE FUNCTION public.normalize_company_name(raw_name text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path = public
AS $function$
DECLARE
  normalized TEXT;
BEGIN
  normalized := TRIM(BOTH ' "''' FROM raw_name);
  IF normalized ~* 'comcast.*nbcuniversal|nbcuniversal.*comcast|comcast/nbcuniversal' THEN
    RETURN 'NBCUniversal';
  ELSIF normalized ~* '^nbcuniversal$' THEN
    RETURN 'NBCUniversal';
  END IF;
  RETURN normalized;
END;
$function$;

-- Fix get_distinct_industries (also fixing broken reference to mv_rankings_scored → mv_industry_stats)
CREATE OR REPLACE FUNCTION public.get_distinct_industries()
 RETURNS TABLE(industry text)
 LANGUAGE sql
 STABLE
 SET search_path = public
AS $function$
  SELECT DISTINCT industry FROM mv_industry_stats ORDER BY industry;
$function$;

-- Fix get_rankings
CREATE OR REPLACE FUNCTION public.get_rankings(p_industry text, p_country text, p_model text DEFAULT 'all'::text, p_limit integer DEFAULT 10, p_offset integer DEFAULT 0)
 RETURNS TABLE(company_name text, industry text, country text, visibility_score numeric, rank_position bigint, mention_count bigint, total_responses bigint, themes text[], all_industries text[], full_count bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path = public
AS $function$
DECLARE
  v_total_combinations bigint;
BEGIN
  SELECT SUM(response_count)
  INTO v_total_combinations
  FROM mv_industry_stats s
  WHERE s.industry = p_industry
    AND s.country = p_country
    AND (p_model = 'all' OR s.ai_model = p_model);
  IF v_total_combinations IS NULL OR v_total_combinations = 0 THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH company_scores AS (
    SELECT
      m.company_name,
      SUM(m.mention_count) as company_mentions,
      array_agg(DISTINCT m.theme) as themes
    FROM mv_company_mentions m
    WHERE m.industry = p_industry
      AND m.country = p_country
      AND (p_model = 'all' OR m.ai_model = p_model)
    GROUP BY m.company_name
  )
  SELECT
    cs.company_name,
    p_industry as industry,
    p_country as country,
    ROUND((cs.company_mentions::numeric / v_total_combinations::numeric) * 100, 2) as visibility_score,
    (ROW_NUMBER() OVER (ORDER BY (cs.company_mentions::numeric / v_total_combinations::numeric) DESC) + p_offset)::bigint as rank_position,
    cs.company_mentions as mention_count,
    v_total_combinations as total_responses,
    cs.themes,
    ARRAY[p_industry] as all_industries,
    COUNT(*) OVER() as full_count
  FROM company_scores cs
  ORDER BY visibility_score DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

-- Fix refresh_prompt_responses_view
CREATE OR REPLACE FUNCTION public.refresh_prompt_responses_view()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY prompt_responses_with_prompts;
END;
$function$;

-- Fix refresh_rankings_overview
CREATE OR REPLACE FUNCTION public.refresh_rankings_overview()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.rankings_overview;
  RETURN NULL;
END;
$function$;

-- Fix refresh_rankings_views
CREATE OR REPLACE FUNCTION public.refresh_rankings_views()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW public.mv_industry_stats;
  REFRESH MATERIALIZED VIEW public.mv_company_mentions;
END;
$function$;

