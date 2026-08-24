-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260316083057; this file was
-- back-filled afterwards and therefore post-dates the deployment.


DROP MATERIALIZED VIEW IF EXISTS rankings_historical CASCADE;

CREATE MATERIALIZED VIEW rankings_historical AS
WITH raw_data AS (
  SELECT pr.index_period,
    pr.ai_model,
    cp.industry_context,
    cp.location_context AS country,
    cp.prompt_theme,
    pr.detected_competitors
  FROM (prompt_responses pr
    JOIN confirmed_prompts cp ON ((pr.confirmed_prompt_id = cp.id)))
  WHERE ((pr.for_index = true) AND (cp.industry_context IS NOT NULL) AND (cp.location_context IS NOT NULL) AND (pr.index_period IS NOT NULL))
), period_industry_stats AS (
  SELECT raw_data.index_period,
    raw_data.industry_context,
    raw_data.country,
    array_agg(DISTINCT ((raw_data.ai_model || '::'::text) || COALESCE(raw_data.prompt_theme, 'null'::text))) AS all_combinations
  FROM raw_data
  GROUP BY raw_data.index_period, raw_data.industry_context, raw_data.country
), raw_split AS (
  SELECT rd.index_period,
    rd.ai_model,
    rd.industry_context,
    rd.country,
    rd.prompt_theme,
    clean_company_name(token.token) AS company_name
  FROM (raw_data rd
    CROSS JOIN LATERAL regexp_split_to_table(rd.detected_competitors, '[,;\n]+'::text) token(token))
  WHERE (length(TRIM(BOTH FROM token.token)) > 1)
), company_stats AS (
  SELECT raw_split.index_period,
    raw_split.industry_context,
    raw_split.country,
    raw_split.company_name,
    count(*) AS mention_count,
    array_agg(DISTINCT ((raw_split.ai_model || '::'::text) || COALESCE(raw_split.prompt_theme, 'null'::text))) AS combinations
  FROM raw_split
  GROUP BY raw_split.index_period, raw_split.industry_context, raw_split.country, raw_split.company_name
), with_canonical AS (
  SELECT cs.index_period,
    cs.company_name,
    COALESCE(ccn.canonical_name, cs.company_name) AS canonical_name,
    COALESCE(ccn.website_domain, ''::text) AS website_domain,
    cs.industry_context,
    cs.country,
    cs.mention_count,
    cs.combinations,
    pis.all_combinations AS all_period_combinations
  FROM ((company_stats cs
    JOIN period_industry_stats pis ON (((cs.index_period = pis.index_period) AND (cs.industry_context = pis.industry_context) AND (cs.country = pis.country))))
    LEFT JOIN company_canonical_names ccn ON ((lower(cs.company_name) = lower(ccn.variant_name))))
)
SELECT wc.index_period,
  wc.company_name,
  wc.canonical_name,
  wc.website_domain,
  wc.industry_context,
  wc.country,
  wc.mention_count,
  wc.combinations,
  wc.all_period_combinations
FROM with_canonical wc
  LEFT JOIN company_overrides co ON (lower(wc.canonical_name) = lower(co.canonical_name))
WHERE (NOT is_source_entity(wc.company_name, wc.canonical_name))
  AND (co.id IS NULL OR co.status != 'excluded');

