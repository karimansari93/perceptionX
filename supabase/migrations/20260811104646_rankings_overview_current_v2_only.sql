-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260811104646; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Restrict rankings_overview's current branch to methodology v2 responses.
--
-- The current pool (for_index = true, index_period IS NULL) still contains
-- 7,292 responses from the 6-11 May methodology v1 run alongside the 7,670
-- v2 responses collected since 4 Aug. 168 of 204 current slices mix both:
-- the v1 rows contribute retired theme names (e.g. 'Mission & Purpose') as
-- extra ai_model::theme combinations, inflating every company's score
-- denominator in those slices and splitting theme rollups.
--
-- Fix: raw_data in rankings_overview now requires cp.prompt_version = 2.
-- rankings_historical is deliberately NOT changed — periods 2026-01..04 were
-- legitimately collected under methodology v1 and remain internally
-- consistent.
--
-- Effect on v1-only slices: the 6 Automotive slices (BR/CN/FR/DE/GB/US) have
-- no v2 collection yet, so they leave the current branch and are served by
-- the existing per-slice historical fallback (all six have periods through
-- 2026-04, and the fallback labels rows with data_period instead of passing
-- May data off as current). The May v1 rows themselves are left untouched in
-- prompt_responses; they are simply inert for the current index. If a
-- 2026-05 historical period is ever wanted, they can still be index_period
-- tagged later.
--
-- company_search_index depends on rankings_overview and is rebuilt
-- unchanged. Indexes, SELECT-only grants and PUBLIC BY DESIGN comments are
-- restored as in fix_index_scores_null_family_zero.

DROP MATERIALIZED VIEW IF EXISTS public.company_search_index;
DROP MATERIALIZED VIEW IF EXISTS public.rankings_overview;

CREATE MATERIALIZED VIEW public.rankings_overview AS
WITH raw_data AS (
  SELECT pr.id AS response_id,
         pr.ai_model,
         cp.industry_context,
         cp.location_context AS country,
         cp.prompt_theme,
         pr.detected_competitors
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  WHERE pr.for_index = true
    AND pr.index_period IS NULL
    AND cp.prompt_version = 2  -- current branch is methodology v2 only
    AND cp.industry_context IS NOT NULL
    AND cp.location_context IS NOT NULL
), industry_stats AS (
  SELECT industry_context,
         country,
         array_agg(DISTINCT (ai_model || '::' || COALESCE(prompt_theme, 'null'))) AS all_industry_combinations
  FROM raw_data
  GROUP BY industry_context, country
), raw_split AS (
  SELECT rd.response_id,
         rd.ai_model,
         rd.industry_context,
         rd.country,
         rd.prompt_theme,
         clean_company_name(token.token) AS company_name
  FROM raw_data rd
  CROSS JOIN LATERAL regexp_split_to_table(rd.detected_competitors, '[,;\n]+') token(token)
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
  SELECT DISTINCT rs.response_id,
         rs.ai_model,
         rs.industry_context,
         rs.country,
         rs.prompt_theme,
         cm.canonical_name
  FROM raw_split rs
  JOIN canonical_map cm ON cm.raw_name = rs.company_name
), canonical_domains AS (
  SELECT lower(canonical_name) AS ck,
         COALESCE(
           max(website_domain) FILTER (WHERE lower(variant_name) = lower(canonical_name) AND website_domain <> ''),
           max(website_domain) FILTER (WHERE website_domain <> '')
         ) AS website_domain
  FROM company_canonical_names
  WHERE website_domain IS NOT NULL
    AND website_domain <> ''
  GROUP BY lower(canonical_name)
), canonical_aggregated AS (
  SELECT canonical_name,
         industry_context,
         country,
         count(DISTINCT response_id) AS mention_count,
         array_agg(DISTINCT (ai_model || '::' || COALESCE(prompt_theme, 'null'))) AS combinations
  FROM mapped
  GROUP BY canonical_name, industry_context, country
), current_scored AS (
  SELECT ca.canonical_name,
         ca.industry_context,
         ca.country,
         NULL::text AS data_period,
         ca.mention_count,
         ca.combinations,
         ist.all_industry_combinations,
         index_family_score(ca.combinations, ist.all_industry_combinations, NULL) AS score_all,
         index_family_score(ca.combinations, ist.all_industry_combinations, ARRAY['%gpt%']) AS score_chatgpt,
         index_family_score(ca.combinations, ist.all_industry_combinations, ARRAY['%google%', '%gemini%', '%bard%']) AS score_google,
         index_family_score(ca.combinations, ist.all_industry_combinations, ARRAY['%perplexity%']) AS score_perplexity
  FROM canonical_aggregated ca
  JOIN industry_stats ist USING (industry_context, country)
  LEFT JOIN company_employee_tiers cet ON lower(ca.canonical_name) = lower(cet.company_name)
  LEFT JOIN company_overrides co ON lower(ca.canonical_name) = lower(co.canonical_name)
  WHERE cet.estimated_tier IS NOT NULL
    AND cet.estimated_tier <> ALL (ARRAY['<50', '50-499', '500-4999', 'unknown'])
    AND (co.id IS NULL OR co.status <> 'excluded')
    AND (co.allowed_industries IS NULL OR ca.industry_context = ANY (co.allowed_industries))
), covered AS (
  SELECT DISTINCT industry_context, country FROM current_scored
), slice_latest_historical AS (
  SELECT industry_context, country, max(index_period) AS latest_period
  FROM rankings_historical
  GROUP BY industry_context, country
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
  JOIN slice_latest_historical sl
    ON sl.industry_context = h.industry_context
   AND sl.country = h.country
   AND sl.latest_period = h.index_period
  WHERE NOT EXISTS (
          SELECT 1 FROM covered c
          WHERE c.industry_context = h.industry_context
            AND c.country = h.country)
)
SELECT cs.canonical_name,
       COALESCE(cd.website_domain, '') AS website_domain,
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
       COALESCE(cd.website_domain, '') AS website_domain,
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

CREATE UNIQUE INDEX rankings_overview_uk
  ON public.rankings_overview (canonical_name, industry_context, country);

CREATE MATERIALIZED VIEW public.company_search_index AS
WITH best AS (
  SELECT DISTINCT ON (canonical_name) canonical_name,
         industry_context AS best_industry
  FROM rankings_overview
  ORDER BY canonical_name, score_all DESC
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

CREATE UNIQUE INDEX company_search_index_uk
  ON public.company_search_index (canonical_name);

REVOKE ALL ON public.rankings_overview,
              public.company_search_index
  FROM anon, authenticated;
GRANT SELECT ON public.rankings_overview,
                public.company_search_index
  TO anon, authenticated, service_role;

COMMENT ON MATERIALIZED VIEW public.rankings_overview IS
  'PUBLIC BY DESIGN: read anonymously (anon SELECT via PostgREST) by employers.perceptionx.ai. Revoking anon SELECT breaks the public site with 401s - see 20260721000000_restore_public_index_anon_grants.';
COMMENT ON MATERIALIZED VIEW public.company_search_index IS
  'PUBLIC BY DESIGN: read anonymously (anon SELECT via PostgREST) by the employers.perceptionx.ai company search. Revoking anon SELECT breaks the public site with 401s - see 20260721000000_restore_public_index_anon_grants.';
