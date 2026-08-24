-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260221115158; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Function to check if a company should be filtered as a source
-- Used by rankings queries. Returns true if the company is a known source.
CREATE OR REPLACE FUNCTION public.is_ranked_entity(p_company_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (
      SELECT entity_type != 'source'
      FROM public.company_entity_classifications
      WHERE company_name = lower(trim(p_company_name))
      LIMIT 1
    ),
    true  -- if not in table, assume it's a valid company (innocent until proven guilty)
  );
$$;

-- Refresh rankings_overview to incorporate the classification filter
-- We do this by updating the view definition to join against classifications
CREATE MATERIALIZED VIEW public.rankings_overview_v2 AS
WITH raw_data AS (
  SELECT pr.ai_model,
    cp.industry_context,
    cp.location_context AS country,
    cp.prompt_theme,
    pr.detected_competitors
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON (pr.confirmed_prompt_id = cp.id)
  WHERE pr.for_index = true
    AND cp.industry_context IS NOT NULL
    AND cp.location_context IS NOT NULL
),
industry_stats AS (
  SELECT industry_context, country,
    array_agg(DISTINCT (ai_model || '::' || COALESCE(prompt_theme, 'null'))) AS all_industry_combinations
  FROM raw_data
  GROUP BY industry_context, country
),
raw_split AS (
  SELECT rd.ai_model, rd.industry_context, rd.country, rd.prompt_theme,
    clean_company_name(token.token) AS company_name
  FROM raw_data rd
  CROSS JOIN LATERAL regexp_split_to_table(rd.detected_competitors, '[,;\n]+') token(token)
  WHERE length(trim(token.token)) > 1
),
company_stats AS (
  SELECT industry_context, country, company_name,
    count(*) AS mention_count,
    array_agg(DISTINCT (ai_model || '::' || COALESCE(prompt_theme, 'null'))) AS combinations
  FROM raw_split
  GROUP BY industry_context, country, company_name
)
SELECT 
  cs.company_name,
  COALESCE(ccn.canonical_name, cs.company_name) AS canonical_name,
  COALESCE(ccn.website_domain, '') AS website_domain,
  cs.industry_context,
  cs.country,
  cs.mention_count,
  cs.combinations,
  ist.all_industry_combinations,
  -- Classification columns for transparency
  COALESCE(ec.entity_type, 'unclassified') AS entity_type,
  ec.reviewed AS classification_reviewed
FROM company_stats cs
JOIN industry_stats ist ON (cs.industry_context = ist.industry_context AND cs.country = ist.country)
LEFT JOIN company_canonical_names ccn ON (lower(cs.company_name) = lower(ccn.variant_name))
LEFT JOIN public.company_entity_classifications ec ON (lower(cs.company_name) = ec.company_name)
-- Filter out confirmed sources; keep companies, ambiguous, and unclassified
WHERE COALESCE(ec.entity_type, 'unclassified') != 'source';

CREATE UNIQUE INDEX ON public.rankings_overview_v2(company_name, industry_context, country);
CREATE INDEX ON public.rankings_overview_v2(industry_context, country);
CREATE INDEX ON public.rankings_overview_v2(canonical_name, industry_context, country);

