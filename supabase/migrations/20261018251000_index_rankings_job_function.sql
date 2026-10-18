-- Rankings per job function: country x industry x job function, for the 15
-- new countries (Karim, 2026-10-18: "top 10 by country, by industry by job
-- function"). Same scoring, name mapping and visibility filter as
-- rankings_overview, over the job-function prompts in index_prompts (five per
-- industry, e.g. Nursing in Healthcare, Pilots & Flight Crew in Airline).
--
-- Not public yet: the public site needs its own change to show job
-- functions, and Karim checks the lists first.

CREATE MATERIALIZED VIEW IF NOT EXISTS public.rankings_job_function AS
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

CREATE INDEX IF NOT EXISTS idx_rankings_job_function_slice
  ON public.rankings_job_function (country, industry_context, job_function);

REVOKE ALL ON public.rankings_job_function FROM anon, authenticated;
COMMENT ON MATERIALIZED VIEW public.rankings_job_function IS
  'Rankings per country x industry x job function (new countries). Not public yet: refresh with REFRESH MATERIALIZED VIEW; add to refresh_rankings_pipeline and grant anon SELECT when the public site shows job functions.';
