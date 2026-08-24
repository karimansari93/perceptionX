-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260307075053; this file was
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
)
SELECT wc.company_name,
    wc.canonical_name,
    wc.website_domain,
    wc.industry_context,
    wc.country,
    wc.mention_count,
    wc.combinations,
    wc.all_industry_combinations
FROM with_canonical wc
LEFT JOIN company_employee_tiers cet ON (lower(wc.canonical_name) = lower(cet.company_name))
WHERE (NOT is_source_entity(wc.company_name, wc.canonical_name))
  AND (cet.estimated_tier IS NOT NULL)
  AND (cet.estimated_tier NOT IN ('<50', '50-499'));

