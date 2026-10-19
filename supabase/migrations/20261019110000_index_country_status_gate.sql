-- Per-country switch for what the public rankings show (Karim, 2026-10-19).
--
-- Job-function and industry answers for the 8 original countries are now
-- being collected on the same three models as the 15 new countries. Without a
-- gate they would flow straight into the public rankings: the industry
-- answers would mix into the live rankings of those 8 countries (which come
-- from the earlier collection), and half-collected job-function lists would
-- be readable before Karim signs them off.
--
-- index_country_status says, per country:
--   overview_source          which collection the industry rankings use:
--                            'legacy' (prompt_responses) or 'index'
--                            (index_responses). Switching a country is one
--                            UPDATE and a refresh.
--   job_functions_published  whether its job-function rankings show.
--
-- Step 1 (this file): the table, and rebuilt copies of rankings_overview,
-- company_search_index and rankings_job_function (*_next) that read it.
-- They are filled and checked against the live ones before the swap in
-- 20261019120000_index_country_status_swap.sql.

CREATE TABLE IF NOT EXISTS public.index_country_status (
  country text PRIMARY KEY,
  overview_source text NOT NULL CHECK (overview_source IN ('legacy', 'index')),
  job_functions_published boolean NOT NULL DEFAULT false,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.index_country_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.index_country_status FROM anon, authenticated;

INSERT INTO public.index_country_status (country, overview_source, job_functions_published, note) VALUES
  ('Brazil', 'legacy', false, 'Original country'),
  ('China', 'legacy', false, 'Original country'),
  ('France', 'legacy', false, 'Original country'),
  ('Germany', 'legacy', false, 'Original country'),
  ('India', 'legacy', false, 'Original country'),
  ('United Arab Emirates', 'legacy', false, 'Original country'),
  ('United Kingdom', 'legacy', false, 'Original country'),
  ('United States', 'legacy', false, 'Original country'),
  ('Australia', 'index', true, 'Added 2026-10-18'),
  ('Canada', 'index', true, 'Added 2026-10-18'),
  ('Denmark', 'index', true, 'Added 2026-10-18'),
  ('Ireland', 'index', true, 'Added 2026-10-18'),
  ('Italy', 'index', true, 'Added 2026-10-18'),
  ('Japan', 'index', true, 'Added 2026-10-18'),
  ('Mexico', 'index', true, 'Added 2026-10-18'),
  ('Netherlands', 'index', true, 'Added 2026-10-18'),
  ('Norway', 'index', true, 'Added 2026-10-18'),
  ('Saudi Arabia', 'index', true, 'Added 2026-10-18'),
  ('Singapore', 'index', true, 'Added 2026-10-18'),
  ('South Korea', 'index', true, 'Added 2026-10-18'),
  ('Spain', 'index', true, 'Added 2026-10-18'),
  ('Sweden', 'index', true, 'Added 2026-10-18'),
  ('Switzerland', 'index', true, 'Added 2026-10-18')
ON CONFLICT (country) DO NOTHING;

-- rankings_overview as live, plus the gate on each source.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.rankings_overview_next AS
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
            AND NOT EXISTS (SELECT 1 FROM index_country_status s
                            WHERE s.country = cp.location_context AND s.overview_source = 'index')
        UNION ALL
         SELECT ir.id,
            ir.ai_model,
            ip.industry,
            ip.country,
            ip.prompt_theme,
            ir.detected_competitors
           FROM index_responses ir
             JOIN index_prompts ip ON ip.id = ir.index_prompt_id
          WHERE ip.job_function IS NULL AND ir.index_period IS NULL AND ip.prompt_version = 2 AND ip.country IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM index_country_status s
                            WHERE s.country = ip.country AND s.overview_source = 'legacy')
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
          WHERE (ca.country = 'United Arab Emirates'::text OR cet.estimated_tier IS NOT NULL AND (cet.estimated_tier <> ALL (ARRAY['<50'::text, '50-499'::text, '500-4999'::text, 'unknown'::text]))) AND (co.id IS NULL OR co.status <> 'excluded'::text) AND (co.allowed_industries IS NULL OR (ca.industry_context = ANY (co.allowed_industries)))
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
     LEFT JOIN canonical_domains cd ON cd.ck = lower(fb.canonical_name)
WITH NO DATA;

CREATE INDEX IF NOT EXISTS idx_rankings_overview_next_industry_country ON public.rankings_overview_next (industry_context, country);
CREATE INDEX IF NOT EXISTS idx_rankings_overview_next_canonical ON public.rankings_overview_next (canonical_name);

-- company_search_index as live, reading the new rankings.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.company_search_index_next AS
 WITH sized AS (
         SELECT rankings_overview_next.canonical_name,
            rankings_overview_next.industry_context,
            rankings_overview_next.country,
            rankings_overview_next.score_all,
            rankings_overview_next.mention_count,
            count(*) OVER (PARTITION BY rankings_overview_next.industry_context, rankings_overview_next.country) AS industry_size
           FROM rankings_overview_next
        ), best AS (
         SELECT DISTINCT ON (sized.canonical_name) sized.canonical_name,
            sized.industry_context AS best_industry
           FROM sized
          ORDER BY sized.canonical_name, (sized.country = 'United States'::text) DESC, sized.score_all DESC, sized.country, sized.mention_count DESC, sized.industry_size, sized.industry_context
        )
 SELECT ro.canonical_name,
    max(ro.website_domain) AS website_domain,
    array_agg(DISTINCT ro.industry_context ORDER BY ro.industry_context) AS industries,
    sum(ro.mention_count)::integer AS total_mentions,
    b.best_industry
   FROM rankings_overview_next ro
     JOIN best b ON ro.canonical_name = b.canonical_name
     LEFT JOIN company_overrides co ON lower(co.canonical_name) = lower(ro.canonical_name)
  WHERE length(TRIM(BOTH FROM ro.canonical_name)) > 0 AND (co.status IS NULL OR co.status <> 'excluded'::text)
  GROUP BY ro.canonical_name, b.best_industry
WITH NO DATA;

-- rankings_job_function as built in 20261018251000, showing only countries
-- whose job-function rankings are published.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.rankings_job_function_next AS
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
                WHERE s.country = ip.country AND s.job_functions_published)
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

CREATE INDEX IF NOT EXISTS idx_rankings_job_function_next_slice
  ON public.rankings_job_function_next (country, industry_context, job_function);

REVOKE ALL ON public.rankings_overview_next, public.company_search_index_next, public.rankings_job_function_next
  FROM anon, authenticated;
