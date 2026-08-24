-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260221115834; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Drop and rebuild rankings_overview filtering on canonical_name instead of company_name
-- This catches all variants (great place to work france, great place to work®, etc.)
DROP MATERIALIZED VIEW public.rankings_overview;

CREATE MATERIALIZED VIEW public.rankings_overview AS
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
),
with_canonical AS (
  SELECT
    cs.company_name,
    COALESCE(ccn.canonical_name, cs.company_name) AS canonical_name,
    COALESCE(ccn.website_domain, '') AS website_domain,
    cs.industry_context,
    cs.country,
    cs.mention_count,
    cs.combinations,
    ist.all_industry_combinations
  FROM company_stats cs
  JOIN industry_stats ist ON (cs.industry_context = ist.industry_context AND cs.country = ist.country)
  LEFT JOIN company_canonical_names ccn ON (lower(cs.company_name) = lower(ccn.variant_name))
)
SELECT wc.*
FROM with_canonical wc
WHERE COALESCE(
  -- Check by raw company_name first
  (SELECT entity_type FROM public.company_entity_classifications WHERE company_name = lower(wc.company_name) LIMIT 1),
  -- Fall back to checking by canonical_name (catches all variants)
  (SELECT entity_type FROM public.company_entity_classifications WHERE company_name = lower(wc.canonical_name) LIMIT 1),
  'unclassified'
) != 'source';

CREATE UNIQUE INDEX ON public.rankings_overview(company_name, industry_context, country);
CREATE INDEX ON public.rankings_overview(industry_context, country);
CREATE INDEX ON public.rankings_overview(canonical_name, industry_context, country);
CREATE INDEX ON public.rankings_overview(company_name);

-- Same fix for rankings_historical
DROP MATERIALIZED VIEW public.rankings_historical;

CREATE MATERIALIZED VIEW public.rankings_historical AS
WITH raw_data AS (
  SELECT pr.index_period, pr.ai_model,
    cp.industry_context,
    cp.location_context AS country,
    cp.prompt_theme,
    pr.detected_competitors
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON (pr.confirmed_prompt_id = cp.id)
  WHERE pr.for_index = true
    AND cp.industry_context IS NOT NULL
    AND cp.location_context IS NOT NULL
    AND pr.index_period IS NOT NULL
),
period_industry_stats AS (
  SELECT index_period, industry_context, country,
    array_agg(DISTINCT (ai_model || '::' || COALESCE(prompt_theme, 'null'))) AS all_combinations
  FROM raw_data
  GROUP BY index_period, industry_context, country
),
raw_split AS (
  SELECT rd.index_period, rd.ai_model, rd.industry_context, rd.country, rd.prompt_theme,
    clean_company_name(token.token) AS company_name
  FROM raw_data rd
  CROSS JOIN LATERAL regexp_split_to_table(rd.detected_competitors, '[,;\n]+') token(token)
  WHERE length(trim(token.token)) > 1
),
company_stats AS (
  SELECT index_period, industry_context, country, company_name,
    count(*) AS mention_count,
    array_agg(DISTINCT (ai_model || '::' || COALESCE(prompt_theme, 'null'))) AS combinations
  FROM raw_split
  GROUP BY index_period, industry_context, country, company_name
),
with_canonical AS (
  SELECT
    cs.index_period,
    cs.company_name,
    COALESCE(ccn.canonical_name, cs.company_name) AS canonical_name,
    COALESCE(ccn.website_domain, '') AS website_domain,
    cs.industry_context,
    cs.country,
    cs.mention_count,
    cs.combinations,
    pis.all_combinations AS all_period_combinations
  FROM company_stats cs
  JOIN period_industry_stats pis ON (
    cs.index_period = pis.index_period
    AND cs.industry_context = pis.industry_context
    AND cs.country = pis.country
  )
  LEFT JOIN company_canonical_names ccn ON (lower(cs.company_name) = lower(ccn.variant_name))
)
SELECT wc.*
FROM with_canonical wc
WHERE COALESCE(
  (SELECT entity_type FROM public.company_entity_classifications WHERE company_name = lower(wc.company_name) LIMIT 1),
  (SELECT entity_type FROM public.company_entity_classifications WHERE company_name = lower(wc.canonical_name) LIMIT 1),
  'unclassified'
) != 'source';

CREATE UNIQUE INDEX ON public.rankings_historical(company_name, index_period, industry_context, country);
CREATE INDEX ON public.rankings_historical(index_period, industry_context, country);
CREATE INDEX ON public.rankings_historical(canonical_name, index_period, industry_context, country);
CREATE INDEX ON public.rankings_historical(company_name);

