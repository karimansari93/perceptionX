-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260820112353; this file was
-- back-filled afterwards and therefore post-dates the deployment.

drop materialized view if exists company_search_index;
drop materialized view if exists rankings_overview;

create materialized view rankings_overview as
WITH raw_data AS (
         SELECT pr.id AS response_id,
            pr.ai_model,
            cp.industry_context,
            cp.location_context AS country,
            cp.prompt_theme,
            pr.detected_competitors
           FROM prompt_responses pr
             JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
          WHERE pr.for_index = true AND pr.index_period IS NULL AND cp.prompt_version = 2 AND cp.industry_context IS NOT NULL AND cp.location_context IS NOT NULL
        ), industry_stats AS (
         SELECT raw_data.industry_context,
            raw_data.country,
            array_agg(DISTINCT (raw_data.ai_model || '::'::text) || COALESCE(raw_data.prompt_theme, 'null'::text)) AS all_industry_combinations
           FROM raw_data
          GROUP BY raw_data.industry_context, raw_data.country
        ), raw_split AS (
         SELECT rd.response_id,
            rd.ai_model,
            rd.industry_context,
            rd.country,
            rd.prompt_theme,
            clean_company_name(token.token) AS company_name
           FROM raw_data rd
             CROSS JOIN LATERAL regexp_split_to_table(rd.detected_competitors, '[,;\n]+'::text) token(token)
          WHERE length(TRIM(BOTH FROM token.token)) > 1
        ), distinct_names AS (
         SELECT DISTINCT raw_split.company_name
           FROM raw_split
        ), canonical_map AS (
         SELECT dn.company_name AS raw_name,
            COALESCE(ccn.canonical_name, initcap(dn.company_name)) AS canonical_name
           FROM distinct_names dn
             LEFT JOIN company_canonical_names ccn ON lower(dn.company_name) = lower(ccn.variant_name)
          WHERE NOT is_source_entity(dn.company_name, COALESCE(ccn.canonical_name, dn.company_name)) AND length(TRIM(BOTH FROM COALESCE(ccn.canonical_name, initcap(dn.company_name)))) > 0
        ), mapped AS (
         SELECT DISTINCT rs.response_id,
            rs.ai_model,
            rs.industry_context,
            rs.country,
            rs.prompt_theme,
            cm.canonical_name
           FROM raw_split rs
             JOIN canonical_map cm ON cm.raw_name = rs.company_name
        ), canonical_domains AS (
         SELECT lower(company_canonical_names.canonical_name) AS ck,
            COALESCE(max(company_canonical_names.website_domain) FILTER (WHERE lower(company_canonical_names.variant_name) = lower(company_canonical_names.canonical_name) AND company_canonical_names.website_domain <> ''::text), max(company_canonical_names.website_domain) FILTER (WHERE company_canonical_names.website_domain <> ''::text)) AS website_domain
           FROM company_canonical_names
          WHERE company_canonical_names.website_domain IS NOT NULL AND company_canonical_names.website_domain <> ''::text
          GROUP BY (lower(company_canonical_names.canonical_name))
        ), canonical_aggregated AS (
         SELECT mapped.canonical_name,
            mapped.industry_context,
            mapped.country,
            count(DISTINCT mapped.response_id) AS mention_count,
            array_agg(DISTINCT (mapped.ai_model || '::'::text) || COALESCE(mapped.prompt_theme, 'null'::text)) AS combinations
           FROM mapped
          GROUP BY mapped.canonical_name, mapped.industry_context, mapped.country
        ), current_scored AS (
         SELECT ca.canonical_name,
            ca.industry_context,
            ca.country,
            NULL::text AS data_period,
            ca.mention_count,
            ca.combinations,
            ist.all_industry_combinations,
            index_family_score(ca.combinations, ist.all_industry_combinations, NULL::text[]) AS score_all,
            index_family_score(ca.combinations, ist.all_industry_combinations, ARRAY['%gpt%'::text]) AS score_chatgpt,
            index_family_score(ca.combinations, ist.all_industry_combinations, ARRAY['%google%'::text, '%gemini%'::text, '%bard%'::text]) AS score_google,
            index_family_score(ca.combinations, ist.all_industry_combinations, ARRAY['%perplexity%'::text]) AS score_perplexity
           FROM canonical_aggregated ca
             JOIN industry_stats ist USING (industry_context, country)
             LEFT JOIN company_employee_tiers cet ON lower(ca.canonical_name) = lower(cet.company_name)
             LEFT JOIN company_overrides co ON lower(ca.canonical_name) = lower(co.canonical_name)
          WHERE (ca.country = 'United Arab Emirates' OR (cet.estimated_tier IS NOT NULL AND (cet.estimated_tier <> ALL (ARRAY['<50'::text, '50-499'::text, '500-4999'::text, 'unknown'::text])))) AND (co.id IS NULL OR co.status <> 'excluded'::text) AND (co.allowed_industries IS NULL OR (ca.industry_context = ANY (co.allowed_industries)))
        ), covered AS (
         SELECT DISTINCT current_scored.industry_context,
            current_scored.country
           FROM current_scored
        ), slice_latest_historical AS (
         SELECT rankings_historical.industry_context,
            rankings_historical.country,
            max(rankings_historical.index_period) AS latest_period
           FROM rankings_historical
          GROUP BY rankings_historical.industry_context, rankings_historical.country
        ), fallback AS (
         SELECT h.canonical_name,
            h.industry_context,
            h.country,
            h.index_period AS data_period,
            h.mention_count,
            h.combinations,
            h.all_period_combinations AS all_industry_combinations,
            h.score_all,
            h.score_chatgpt,
            h.score_google,
            h.score_perplexity
           FROM rankings_historical h
             JOIN slice_latest_historical sl ON sl.industry_context = h.industry_context AND sl.country = h.country AND sl.latest_period = h.index_period
          WHERE NOT (EXISTS ( SELECT 1
                   FROM covered c
                  WHERE c.industry_context = h.industry_context AND c.country = h.country))
        )
 SELECT cs.canonical_name,
    COALESCE(cd.website_domain, ''::text) AS website_domain,
    cs.industry_context,
    cs.country,
    cs.data_period,
    cs.mention_count,
    cs.combinations,
    cs.all_industry_combinations,
    cs.score_all,
    cs.score_chatgpt,
    cs.score_google,
    cs.score_perplexity
   FROM current_scored cs
     LEFT JOIN canonical_domains cd ON cd.ck = lower(cs.canonical_name)
UNION ALL
 SELECT fb.canonical_name,
    COALESCE(cd.website_domain, ''::text) AS website_domain,
    fb.industry_context,
    fb.country,
    fb.data_period,
    fb.mention_count,
    fb.combinations,
    fb.all_industry_combinations,
    fb.score_all,
    fb.score_chatgpt,
    fb.score_google,
    fb.score_perplexity
   FROM fallback fb
     LEFT JOIN canonical_domains cd ON cd.ck = lower(fb.canonical_name);

create materialized view company_search_index as
WITH best AS (
         SELECT DISTINCT ON (rankings_overview.canonical_name) rankings_overview.canonical_name,
            rankings_overview.industry_context AS best_industry
           FROM rankings_overview
          ORDER BY rankings_overview.canonical_name, rankings_overview.score_all DESC
        )
 SELECT ro.canonical_name,
    max(ro.website_domain) AS website_domain,
    array_agg(DISTINCT ro.industry_context ORDER BY ro.industry_context) AS industries,
    sum(ro.mention_count)::integer AS total_mentions,
    b.best_industry
   FROM rankings_overview ro
     JOIN best b ON ro.canonical_name = b.canonical_name
     LEFT JOIN company_overrides co ON lower(co.canonical_name) = lower(ro.canonical_name)
  WHERE length(TRIM(BOTH FROM ro.canonical_name)) > 0 AND (co.status IS NULL OR co.status <> 'excluded'::text)
  GROUP BY ro.canonical_name, b.best_industry;
