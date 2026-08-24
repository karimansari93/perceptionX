-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260809064841; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- ---------------------------------------------------------------------------
-- Add United Arab Emirates to the public API country mapping.
--
-- The August 2026 index added the UAE as a tracked country. The rankings
-- matviews (rankings_overview, company_search_index, mv_industry_stats,
-- mv_company_mentions) are country-agnostic and already pick the UAE up from
-- confirmed_prompts.location_context = 'United Arab Emirates', but
-- api_db_country() — the code/name resolver used by api_company, api_search,
-- api_rankings, and api_compare — whitelists countries explicitly, so
-- ?country=ae fell through to NULL and callers got the United States default.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_db_country(p_country text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(trim(coalesce(p_country, '')))
    WHEN 'us'  THEN 'United States'
    WHEN 'usa' THEN 'United States'
    WHEN 'united states' THEN 'United States'
    WHEN 'gb'  THEN 'United Kingdom'
    WHEN 'uk'  THEN 'United Kingdom'
    WHEN 'united kingdom' THEN 'United Kingdom'
    WHEN 'fr'  THEN 'France'
    WHEN 'france' THEN 'France'
    WHEN 'de'  THEN 'Germany'
    WHEN 'germany' THEN 'Germany'
    WHEN 'br'  THEN 'Brazil'
    WHEN 'brazil' THEN 'Brazil'
    WHEN 'cn'  THEN 'China'
    WHEN 'china' THEN 'China'
    WHEN 'in'  THEN 'India'
    WHEN 'india' THEN 'India'
    WHEN 'ae'  THEN 'United Arab Emirates'
    WHEN 'uae' THEN 'United Arab Emirates'
    WHEN 'united arab emirates' THEN 'United Arab Emirates'
    ELSE NULL
  END;
$$;

GRANT EXECUTE ON FUNCTION public.api_db_country(text) TO anon, authenticated, service_role;
