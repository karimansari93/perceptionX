-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260316082946; this file was
-- back-filled afterwards and therefore post-dates the deployment.


DROP MATERIALIZED VIEW IF EXISTS rankings_overview CASCADE;

CREATE MATERIALIZED VIEW rankings_overview AS
WITH raw_data AS (
  SELECT pr.ai_model,
    cp.industry_context,
    cp.location_context AS country,
    cp.prompt_theme,
    pr.detected_competitors
  FROM (prompt_responses pr
    JOIN confirmed_prompts cp ON ((pr.confirmed_prompt_id = cp.id)))
  WHERE ((pr.for_index = true) AND (cp.industry_context IS NOT NULL) AND (cp.location_context IS NOT NULL))
), industry_stats AS (
  SELECT raw_data.industry_context,
    raw_data.country,
    array_agg(DISTINCT ((raw_data.ai_model || '::'::text) || COALESCE(raw_data.prompt_theme, 'null'::text))) AS all_industry_combinations
  FROM raw_data
  GROUP BY raw_data.industry_context, raw_data.country
), raw_split AS (
  SELECT rd.ai_model,
    rd.industry_context,
    rd.country,
    rd.prompt_theme,
    clean_company_name(token.token) AS company_name
  FROM (raw_data rd
    CROSS JOIN LATERAL regexp_split_to_table(rd.detected_competitors, '[,;\n]+'::text) token(token))
  WHERE (length(TRIM(BOTH FROM token.token)) > 1)
), company_stats AS (
  SELECT raw_split.industry_context,
    raw_split.country,
    raw_split.company_name,
    count(*) AS mention_count,
    array_agg(DISTINCT ((raw_split.ai_model || '::'::text) || COALESCE(raw_split.prompt_theme, 'null'::text))) AS combinations
  FROM raw_split
  GROUP BY raw_split.industry_context, raw_split.country, raw_split.company_name
), with_canonical AS (
  SELECT cs.company_name,
    COALESCE(ccn.canonical_name, cs.company_name) AS canonical_name,
    COALESCE(ccn.website_domain, ''::text) AS website_domain,
    cs.industry_context,
    cs.country,
    cs.mention_count,
    cs.combinations,
    ist.all_industry_combinations
  FROM ((company_stats cs
    JOIN industry_stats ist ON (((cs.industry_context = ist.industry_context) AND (cs.country = ist.country))))
    LEFT JOIN company_canonical_names ccn ON ((lower(cs.company_name) = lower(ccn.variant_name))))
  WHERE (NOT is_source_entity(cs.company_name, COALESCE(ccn.canonical_name, cs.company_name)))
), canonical_aggregated AS (
  SELECT with_canonical.canonical_name,
    max(with_canonical.website_domain) AS website_domain,
    with_canonical.industry_context,
    with_canonical.country,
    sum(with_canonical.mention_count) AS mention_count,
    array_agg(DISTINCT combo.combo) AS combinations,
    max(with_canonical.all_industry_combinations) AS all_industry_combinations
  FROM (with_canonical
    CROSS JOIN LATERAL unnest(with_canonical.combinations) combo(combo))
  GROUP BY with_canonical.canonical_name, with_canonical.industry_context, with_canonical.country
)
SELECT ca.canonical_name,
  ca.website_domain,
  ca.industry_context,
  ca.country,
  ca.mention_count,
  ca.combinations,
  ca.all_industry_combinations
FROM (canonical_aggregated ca
  LEFT JOIN company_employee_tiers cet ON ((lower(ca.canonical_name) = lower(cet.company_name))))
  -- Exclude companies flagged in company_overrides
  LEFT JOIN company_overrides co ON (lower(ca.canonical_name) = lower(co.canonical_name))
WHERE ((cet.estimated_tier IS NOT NULL) AND (cet.estimated_tier <> ALL (ARRAY['<50'::text, '50-499'::text])))
  AND (co.id IS NULL OR co.status != 'excluded');

