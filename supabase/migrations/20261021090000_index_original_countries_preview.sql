-- Previews for Karim's sign-off of the 8 original countries (not public).
--
-- rankings_job_function_preview: job-function rankings for countries whose
-- job functions are not published yet (index_country_status), built exactly
-- as rankings_job_function builds the published ones.
--
-- rankings_overview_index_preview: industry rankings for countries whose
-- public rankings still read the earlier collection, built from the same
-- three models as everywhere else. Compared with rankings_overview, it shows
-- what switching those countries would change.
--
-- Refresh by hand with REFRESH MATERIALIZED VIEW. Neither is in
-- refresh_rankings_pipeline or readable by the public site.

CREATE MATERIALIZED VIEW IF NOT EXISTS public.rankings_job_function_preview AS
WITH raw_data AS (
  SELECT ir.id AS response_id,
         ir.ai_model,
         ip.industry AS industry_context,
         ip.country,
         ip.job_function,
         ip.prompt_theme,
         ir.detected_competitors
  FROM index_responses ir
  JOIN index_prompts ip ON ip.id = ir.index_prompt_id
  WHERE ip.job_function IS NOT NULL AND ir.index_period IS NULL AND ip.prompt_version = 2
    AND ip.country IS NOT NULL
    AND EXISTS (SELECT 1 FROM index_country_status s
                WHERE s.country = ip.country AND NOT s.job_functions_published)
), slice_stats AS (
  SELECT industry_context, country, job_function,
         array_agg(DISTINCT ((ai_model || '::'::text) || COALESCE(prompt_theme, 'null'::text))) AS all_slice_combinations
  FROM raw_data
  GROUP BY industry_context, country, job_function
), raw_split AS (
  SELECT rd.response_id, rd.ai_model, rd.industry_context, rd.country, rd.job_function, rd.prompt_theme,
         clean_company_name(token.token) AS company_name
  FROM raw_data rd
  CROSS JOIN LATERAL regexp_split_to_table(rd.detected_competitors, '[,;\n]+'::text) token(token)
  WHERE length(TRIM(BOTH FROM token.token)) > 1
), distinct_names AS (
  SELECT DISTINCT company_name FROM raw_split
), canonical_map AS (
  SELECT dn.company_name AS raw_name,
         COALESCE(ccn.canonical_name, initcap(dn.company_name)) AS canonical_name
  FROM distinct_names dn
  LEFT JOIN company_canonical_names ccn ON lower(dn.company_name) = lower(ccn.variant_name)
  WHERE NOT is_source_entity(dn.company_name, COALESCE(ccn.canonical_name, dn.company_name))
    AND length(TRIM(BOTH FROM COALESCE(ccn.canonical_name, initcap(dn.company_name)))) > 0
), mapped AS (
  SELECT DISTINCT rs.response_id, rs.ai_model, rs.industry_context, rs.country, rs.job_function, rs.prompt_theme,
         cm.canonical_name
  FROM raw_split rs
  JOIN canonical_map cm ON cm.raw_name = rs.company_name
), canonical_domains AS (
  SELECT lower(canonical_name) AS ck,
         COALESCE(
           max(website_domain) FILTER (WHERE lower(variant_name) = lower(canonical_name) AND website_domain <> ''::text),
           max(website_domain) FILTER (WHERE website_domain <> ''::text)) AS website_domain
  FROM company_canonical_names
  WHERE website_domain IS NOT NULL AND website_domain <> ''::text
  GROUP BY lower(canonical_name)
), aggregated AS (
  SELECT canonical_name, industry_context, country, job_function,
         count(DISTINCT response_id) AS mention_count,
         array_agg(DISTINCT ((ai_model || '::'::text) || COALESCE(prompt_theme, 'null'::text))) AS combinations
  FROM mapped
  GROUP BY canonical_name, industry_context, country, job_function
)
SELECT a.canonical_name,
       COALESCE(cd.website_domain, ''::text) AS website_domain,
       a.industry_context,
       a.country,
       a.job_function,
       a.mention_count,
       a.combinations,
       ss.all_slice_combinations,
       index_family_score(a.combinations, ss.all_slice_combinations, NULL::text[]) AS score_all,
       index_family_score(a.combinations, ss.all_slice_combinations, ARRAY['%gpt%'::text]) AS score_chatgpt,
       index_family_score(a.combinations, ss.all_slice_combinations, ARRAY['%google%'::text, '%gemini%'::text, '%bard%'::text]) AS score_google,
       index_family_score(a.combinations, ss.all_slice_combinations, ARRAY['%claude%'::text]) AS score_claude
FROM aggregated a
JOIN slice_stats ss USING (industry_context, country, job_function)
LEFT JOIN canonical_domains cd ON cd.ck = lower(a.canonical_name)
LEFT JOIN company_employee_tiers cet ON lower(a.canonical_name) = lower(cet.company_name)
LEFT JOIN company_overrides co ON lower(a.canonical_name) = lower(co.canonical_name)
WHERE (a.country = 'United Arab Emirates'::text
       OR (cet.estimated_tier IS NOT NULL AND cet.estimated_tier <> ALL (ARRAY['<50'::text, '50-499'::text, '500-4999'::text, 'unknown'::text])))
  AND (co.id IS NULL OR co.status <> 'excluded'::text)
  AND (co.allowed_industries IS NULL OR a.industry_context = ANY (co.allowed_industries))
WITH NO DATA;

CREATE INDEX IF NOT EXISTS idx_rankings_job_function_preview_slice
  ON public.rankings_job_function_preview (country, industry_context, job_function);

CREATE MATERIALIZED VIEW IF NOT EXISTS public.rankings_overview_index_preview AS
WITH raw_data AS (
  SELECT ir.id AS response_id, ir.ai_model, ip.industry AS industry_context, ip.country, ip.prompt_theme, ir.detected_competitors
  FROM index_responses ir
  JOIN index_prompts ip ON ip.id = ir.index_prompt_id
  WHERE ip.job_function IS NULL AND ir.index_period IS NULL AND ip.prompt_version = 2 AND ip.country IS NOT NULL
    AND EXISTS (SELECT 1 FROM index_country_status s
                WHERE s.country = ip.country AND s.overview_source = 'legacy')
), industry_stats AS (
  SELECT industry_context, country,
         array_agg(DISTINCT ((ai_model || '::'::text) || COALESCE(prompt_theme, 'null'::text))) AS all_industry_combinations
  FROM raw_data
  GROUP BY industry_context, country
), raw_split AS (
  SELECT rd.response_id, rd.ai_model, rd.industry_context, rd.country, rd.prompt_theme,
         clean_company_name(token.token) AS company_name
  FROM raw_data rd
  CROSS JOIN LATERAL regexp_split_to_table(rd.detected_competitors, '[,;\n]+'::text) token(token)
  WHERE length(TRIM(BOTH FROM token.token)) > 1
), distinct_names AS (
  SELECT DISTINCT company_name FROM raw_split
), canonical_map AS (
  SELECT dn.company_name AS raw_name,
         COALESCE(ccn.canonical_name, initcap(dn.company_name)) AS canonical_name
  FROM distinct_names dn
  LEFT JOIN company_canonical_names ccn ON lower(dn.company_name) = lower(ccn.variant_name)
  WHERE NOT is_source_entity(dn.company_name, COALESCE(ccn.canonical_name, dn.company_name))
    AND length(TRIM(BOTH FROM COALESCE(ccn.canonical_name, initcap(dn.company_name)))) > 0
), mapped AS (
  SELECT DISTINCT rs.response_id, rs.ai_model, rs.industry_context, rs.country, rs.prompt_theme, cm.canonical_name
  FROM raw_split rs
  JOIN canonical_map cm ON cm.raw_name = rs.company_name
), canonical_domains AS (
  SELECT lower(canonical_name) AS ck,
         COALESCE(
           max(website_domain) FILTER (WHERE lower(variant_name) = lower(canonical_name) AND website_domain <> ''::text),
           max(website_domain) FILTER (WHERE website_domain <> ''::text)) AS website_domain
  FROM company_canonical_names
  WHERE website_domain IS NOT NULL AND website_domain <> ''::text
  GROUP BY lower(canonical_name)
), aggregated AS (
  SELECT canonical_name, industry_context, country,
         count(DISTINCT response_id) AS mention_count,
         array_agg(DISTINCT ((ai_model || '::'::text) || COALESCE(prompt_theme, 'null'::text))) AS combinations
  FROM mapped
  GROUP BY canonical_name, industry_context, country
)
SELECT a.canonical_name,
       COALESCE(cd.website_domain, ''::text) AS website_domain,
       a.industry_context,
       a.country,
       a.mention_count,
       a.combinations,
       ist.all_industry_combinations,
       index_family_score(a.combinations, ist.all_industry_combinations, NULL::text[]) AS score_all,
       index_family_score(a.combinations, ist.all_industry_combinations, ARRAY['%gpt%'::text]) AS score_chatgpt,
       index_family_score(a.combinations, ist.all_industry_combinations, ARRAY['%google%'::text, '%gemini%'::text, '%bard%'::text]) AS score_google,
       index_family_score(a.combinations, ist.all_industry_combinations, ARRAY['%claude%'::text]) AS score_claude
FROM aggregated a
JOIN industry_stats ist USING (industry_context, country)
LEFT JOIN canonical_domains cd ON cd.ck = lower(a.canonical_name)
LEFT JOIN company_employee_tiers cet ON lower(a.canonical_name) = lower(cet.company_name)
LEFT JOIN company_overrides co ON lower(a.canonical_name) = lower(co.canonical_name)
WHERE (a.country = 'United Arab Emirates'::text
       OR (cet.estimated_tier IS NOT NULL AND cet.estimated_tier <> ALL (ARRAY['<50'::text, '50-499'::text, '500-4999'::text, 'unknown'::text])))
  AND (co.id IS NULL OR co.status <> 'excluded'::text)
  AND (co.allowed_industries IS NULL OR a.industry_context = ANY (co.allowed_industries))
WITH NO DATA;

CREATE INDEX IF NOT EXISTS idx_rankings_overview_index_preview_slice
  ON public.rankings_overview_index_preview (country, industry_context);

REVOKE ALL ON public.rankings_job_function_preview, public.rankings_overview_index_preview FROM anon, authenticated;
COMMENT ON MATERIALIZED VIEW public.rankings_job_function_preview IS
  'Not public. Job-function rankings for countries awaiting sign-off (index_country_status.job_functions_published = false).';
COMMENT ON MATERIALIZED VIEW public.rankings_overview_index_preview IS
  'Not public. Industry rankings from the three-model Index collection for countries whose public rankings read the earlier collection (overview_source = legacy).';
