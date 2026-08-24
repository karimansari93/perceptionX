-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260521063952; this file was
-- back-filled afterwards and therefore post-dates the deployment.

DROP MATERIALIZED VIEW IF EXISTS public.company_search_index;
DROP MATERIALIZED VIEW IF EXISTS public.rankings_overview;

CREATE MATERIALIZED VIEW public.rankings_overview AS
WITH
raw_data AS (
  SELECT pr.id AS response_id, pr.ai_model,
         cp.industry_context, cp.location_context AS country, cp.prompt_theme,
         pr.detected_competitors
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  WHERE pr.for_index = true
    AND pr.index_period IS NULL
    AND cp.industry_context IS NOT NULL
    AND cp.location_context IS NOT NULL
),
industry_stats AS (
  SELECT industry_context, country,
         array_agg(DISTINCT (ai_model || '::' || COALESCE(prompt_theme,'null'))) AS all_industry_combinations
  FROM raw_data
  GROUP BY industry_context, country
),
raw_split AS (
  SELECT rd.response_id, rd.ai_model, rd.industry_context, rd.country, rd.prompt_theme,
         clean_company_name(token.token) AS company_name
  FROM raw_data rd
  CROSS JOIN LATERAL regexp_split_to_table(rd.detected_competitors, '[,;\n]+') token(token)
  WHERE length(TRIM(BOTH FROM token.token)) > 1
),
distinct_names AS (SELECT DISTINCT company_name FROM raw_split),
canonical_map AS (
  SELECT dn.company_name AS raw_name,
         COALESCE(ccn.canonical_name, initcap(dn.company_name)) AS canonical_name,
         COALESCE(ccn.website_domain, '') AS website_domain
  FROM distinct_names dn
  LEFT JOIN company_canonical_names ccn ON lower(dn.company_name) = lower(ccn.variant_name)
  WHERE NOT is_source_entity(dn.company_name, COALESCE(ccn.canonical_name, dn.company_name))
    AND length(TRIM(BOTH FROM COALESCE(ccn.canonical_name, initcap(dn.company_name)))) > 0
),
mapped AS (
  SELECT DISTINCT
         rs.response_id, rs.ai_model, rs.industry_context, rs.country, rs.prompt_theme,
         cm.canonical_name, cm.website_domain
  FROM raw_split rs
  JOIN canonical_map cm ON cm.raw_name = rs.company_name
),
canonical_aggregated AS (
  SELECT canonical_name, industry_context, country,
         max(website_domain) AS website_domain,
         count(DISTINCT response_id) AS mention_count,
         array_agg(DISTINCT (ai_model || '::' || COALESCE(prompt_theme,'null'))) AS combinations
  FROM mapped
  GROUP BY canonical_name, industry_context, country
),
current_scored AS (
  SELECT ca.canonical_name, ca.website_domain, ca.industry_context, ca.country,
         NULL::text AS data_period,
         ca.mention_count, ca.combinations, ist.all_industry_combinations,
         COALESCE(round(LEAST(100.0,
           (SELECT count(*)::numeric FROM unnest(ca.combinations) c(c))
           / NULLIF((SELECT count(*)::numeric FROM unnest(ist.all_industry_combinations) c(c)), 0::numeric)
           * 100::numeric), 1), 0::numeric) AS score_all,
         COALESCE(round(LEAST(100.0,
           (SELECT count(*)::numeric FROM unnest(ca.combinations) c(c) WHERE c.c ILIKE '%gpt%')
           / NULLIF((SELECT count(*)::numeric FROM unnest(ist.all_industry_combinations) c(c) WHERE c.c ILIKE '%gpt%'), 0::numeric)
           * 100::numeric), 1), 0::numeric) AS score_chatgpt,
         COALESCE(round(LEAST(100.0,
           (SELECT count(*)::numeric FROM unnest(ca.combinations) c(c) WHERE c.c ILIKE '%google%' OR c.c ILIKE '%gemini%' OR c.c ILIKE '%bard%')
           / NULLIF((SELECT count(*)::numeric FROM unnest(ist.all_industry_combinations) c(c) WHERE c.c ILIKE '%google%' OR c.c ILIKE '%gemini%' OR c.c ILIKE '%bard%'), 0::numeric)
           * 100::numeric), 1), 0::numeric) AS score_google,
         COALESCE(round(LEAST(100.0,
           (SELECT count(*)::numeric FROM unnest(ca.combinations) c(c) WHERE c.c ILIKE '%perplexity%')
           / NULLIF((SELECT count(*)::numeric FROM unnest(ist.all_industry_combinations) c(c) WHERE c.c ILIKE '%perplexity%'), 0::numeric)
           * 100::numeric), 1), 0::numeric) AS score_perplexity
  FROM canonical_aggregated ca
  JOIN industry_stats ist USING (industry_context, country)
  LEFT JOIN company_employee_tiers cet ON lower(ca.canonical_name) = lower(cet.company_name)
  LEFT JOIN company_overrides       co ON lower(ca.canonical_name) = lower(co.canonical_name)
  WHERE cet.estimated_tier IS NOT NULL
    AND cet.estimated_tier <> ALL (ARRAY['<50','50-499','500-4999','unknown'])
    AND (co.id IS NULL OR co.status <> 'excluded')
    AND (co.allowed_industries IS NULL OR ca.industry_context = ANY (co.allowed_industries))
),
covered AS (
  SELECT DISTINCT industry_context, country FROM current_scored
),
slice_latest_historical AS (
  SELECT industry_context, country, max(index_period) AS latest_period
  FROM rankings_historical
  GROUP BY industry_context, country
),
fallback AS (
  SELECT h.canonical_name, h.website_domain, h.industry_context, h.country,
         h.index_period AS data_period,
         h.mention_count, h.combinations,
         h.all_period_combinations AS all_industry_combinations,
         h.score_all, h.score_chatgpt, h.score_google, h.score_perplexity
  FROM rankings_historical h
  JOIN slice_latest_historical sl
    ON sl.industry_context = h.industry_context
   AND sl.country          = h.country
   AND sl.latest_period    = h.index_period
  WHERE NOT EXISTS (
    SELECT 1 FROM covered c
    WHERE c.industry_context = h.industry_context AND c.country = h.country
  )
)
SELECT canonical_name, website_domain, industry_context, country, data_period,
       mention_count, combinations, all_industry_combinations,
       score_all, score_chatgpt, score_google, score_perplexity
FROM current_scored
UNION ALL
SELECT canonical_name, website_domain, industry_context, country, data_period,
       mention_count, combinations, all_industry_combinations,
       score_all, score_chatgpt, score_google, score_perplexity
FROM fallback;

CREATE UNIQUE INDEX rankings_overview_uk ON public.rankings_overview (canonical_name, industry_context, country);
GRANT SELECT ON public.rankings_overview TO anon, authenticated, service_role;

CREATE MATERIALIZED VIEW public.company_search_index AS
WITH best AS (
  SELECT DISTINCT ON (rankings_overview.canonical_name)
         rankings_overview.canonical_name,
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
WHERE length(TRIM(BOTH FROM ro.canonical_name)) > 0
  AND (co.status IS NULL OR co.status <> 'excluded')
GROUP BY ro.canonical_name, b.best_industry;

CREATE UNIQUE INDEX company_search_index_uk ON public.company_search_index (canonical_name);
GRANT SELECT ON public.company_search_index TO anon, authenticated, service_role;
