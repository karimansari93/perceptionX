-- Fix: model-family scores report 100 for slices where the family never ran.
--
-- All four score expressions in rankings_overview and rankings_historical had
-- the shape:
--
--   COALESCE(round(LEAST(100.0, num / NULLIF(den, 0) * 100), 1), 0)
--
-- Postgres LEAST() ignores NULL arguments, so when a model family collected
-- zero responses for a slice (den = 0 -> NULLIF -> NULL ratio) the LEAST
-- returned 100.0 instead of NULL, and the outer COALESCE never fired. Every
-- company in such a slice reported a perfect 100 for that family (e.g.
-- UAE Real Estate / Oil & Gas and 8 India industries with no google-family
-- collections all showed score_google = 100).
--
-- The fix moves the COALESCE inside the LEAST via a shared helper function,
-- index_family_score(), now used for all eight score expressions across both
-- MVs. A missing family scores 0. The helper is unit-tested in
-- supabase/tests/rankings_score_null_family_regression.sql.
--
-- rankings_overview's fallback branch copies stored scores from
-- rankings_historical, so both MVs are rebuilt (historical first: overview
-- depends on it). company_search_index depends on rankings_overview and is
-- rebuilt unchanged. Indexes, anon/authenticated grants and the
-- PUBLIC BY DESIGN comments are restored (see
-- 20260721000000_restore_public_index_anon_grants).

-- ---------------------------------------------------------------------------
-- 1. Shared score helper
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.index_family_score(
  company_combos  text[],
  slice_combos    text[],
  family_patterns text[] DEFAULT NULL  -- NULL = all models (score_all)
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT COALESCE(
    round(
      LEAST(
        100.0,
        -- COALESCE must sit INSIDE the LEAST: LEAST(100.0, NULL) = 100.0
        COALESCE(
          (SELECT count(*)::numeric
             FROM unnest(company_combos) AS c(combo)
            WHERE family_patterns IS NULL
               OR EXISTS (SELECT 1 FROM unnest(family_patterns) AS p(pat)
                           WHERE c.combo ILIKE p.pat))
          / NULLIF(
              (SELECT count(*)::numeric
                 FROM unnest(slice_combos) AS s(combo)
                WHERE family_patterns IS NULL
                   OR EXISTS (SELECT 1 FROM unnest(family_patterns) AS p(pat)
                               WHERE s.combo ILIKE p.pat)),
              0)
          * 100,
          0)
      ),
      1),
    0)
$$;

COMMENT ON FUNCTION public.index_family_score(text[], text[], text[]) IS
  'Share-of-slice visibility score (0-100, 1dp) for a model family. '
  'family_patterns are ILIKE patterns (NULL = all models). Returns 0, not '
  '100, when the slice has no combinations for the family.';

-- ---------------------------------------------------------------------------
-- 2. Drop dependents in order (search index -> overview -> historical)
-- ---------------------------------------------------------------------------

DROP MATERIALIZED VIEW IF EXISTS public.company_search_index;
DROP MATERIALIZED VIEW IF EXISTS public.rankings_overview;
DROP MATERIALIZED VIEW IF EXISTS public.rankings_historical;

-- ---------------------------------------------------------------------------
-- 3. rankings_historical (definition unchanged except score expressions)
-- ---------------------------------------------------------------------------

CREATE MATERIALIZED VIEW public.rankings_historical AS
WITH raw_data AS (
  SELECT pr.id AS response_id,
         pr.index_period,
         pr.ai_model,
         cp.industry_context,
         cp.location_context AS country,
         cp.prompt_theme,
         pr.detected_competitors
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  WHERE pr.for_index = true
    AND cp.industry_context IS NOT NULL
    AND cp.location_context IS NOT NULL
    AND pr.index_period IS NOT NULL
), period_industry_stats AS (
  SELECT index_period,
         industry_context,
         country,
         array_agg(DISTINCT (ai_model || '::' || COALESCE(prompt_theme, 'null'))) AS all_combinations
  FROM raw_data
  GROUP BY index_period, industry_context, country
), raw_split AS (
  SELECT rd.response_id,
         rd.index_period,
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
         COALESCE(ccn.canonical_name, initcap(dn.company_name)) AS canonical_name,
         COALESCE(ccn.website_domain, '') AS website_domain
  FROM distinct_names dn
  LEFT JOIN company_canonical_names ccn ON lower(dn.company_name) = lower(ccn.variant_name)
  WHERE NOT is_source_entity(dn.company_name, COALESCE(ccn.canonical_name, dn.company_name))
    AND length(TRIM(BOTH FROM COALESCE(ccn.canonical_name, initcap(dn.company_name)))) > 0
), mapped AS (
  SELECT DISTINCT rs.response_id,
         rs.index_period,
         rs.ai_model,
         rs.industry_context,
         rs.country,
         rs.prompt_theme,
         cm.canonical_name,
         cm.website_domain
  FROM raw_split rs
  JOIN canonical_map cm ON cm.raw_name = rs.company_name
), canonical_aggregated AS (
  SELECT index_period,
         canonical_name,
         industry_context,
         country,
         max(website_domain) AS website_domain,
         count(DISTINCT response_id) AS mention_count,
         array_agg(DISTINCT (ai_model || '::' || COALESCE(prompt_theme, 'null'))) AS combinations
  FROM mapped
  GROUP BY index_period, canonical_name, industry_context, country
), scored AS (
  SELECT ca.index_period,
         ca.canonical_name,
         ca.website_domain,
         ca.industry_context,
         ca.country,
         ca.mention_count,
         ca.combinations,
         pis.all_combinations AS all_period_combinations,
         index_family_score(ca.combinations, pis.all_combinations, NULL) AS score_all,
         index_family_score(ca.combinations, pis.all_combinations, ARRAY['%gpt%']) AS score_chatgpt,
         index_family_score(ca.combinations, pis.all_combinations, ARRAY['%google%', '%gemini%', '%bard%']) AS score_google,
         index_family_score(ca.combinations, pis.all_combinations, ARRAY['%perplexity%']) AS score_perplexity
  FROM canonical_aggregated ca
  JOIN period_industry_stats pis USING (index_period, industry_context, country)
  WHERE EXISTS (
          SELECT 1 FROM company_employee_tiers cet
          WHERE lower(cet.company_name) = lower(ca.canonical_name)
            AND cet.estimated_tier IS NOT NULL
            AND cet.estimated_tier <> ALL (ARRAY['<50', '50-499', '500-4999']))
    AND NOT EXISTS (
          SELECT 1 FROM company_overrides co
          WHERE lower(co.canonical_name) = lower(ca.canonical_name)
            AND co.status = 'excluded')
    AND NOT EXISTS (
          SELECT 1 FROM company_overrides co
          WHERE lower(co.canonical_name) = lower(ca.canonical_name)
            AND co.allowed_industries IS NOT NULL
            AND ca.industry_context <> ALL (co.allowed_industries))
)
SELECT index_period,
       canonical_name,
       website_domain,
       industry_context,
       country,
       mention_count,
       combinations,
       all_period_combinations,
       score_all,
       score_chatgpt,
       score_google,
       score_perplexity
FROM scored;

CREATE UNIQUE INDEX rankings_historical_uk
  ON public.rankings_historical (index_period, canonical_name, industry_context, country);
CREATE INDEX idx_rankings_historical_canonical
  ON public.rankings_historical (canonical_name);
CREATE INDEX idx_rankings_historical_industry_country_period
  ON public.rankings_historical (industry_context, country, index_period);

-- ---------------------------------------------------------------------------
-- 4. rankings_overview (definition unchanged except score expressions)
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 5. company_search_index (recreated unchanged)
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 6. Restore grants and PUBLIC BY DESIGN comments
-- ---------------------------------------------------------------------------

-- Freshly created MVs inherit ALL from default privileges; trim anon and
-- authenticated back to SELECT-only as the lock-down migrations left them.
REVOKE ALL ON public.rankings_historical,
              public.rankings_overview,
              public.company_search_index
  FROM anon, authenticated;
GRANT SELECT ON public.rankings_historical,
                public.rankings_overview,
                public.company_search_index
  TO anon, authenticated, service_role;

COMMENT ON MATERIALIZED VIEW public.rankings_overview IS
  'PUBLIC BY DESIGN: read anonymously (anon SELECT via PostgREST) by employers.perceptionx.ai. Revoking anon SELECT breaks the public site with 401s - see 20260721000000_restore_public_index_anon_grants.';
COMMENT ON MATERIALIZED VIEW public.rankings_historical IS
  'PUBLIC BY DESIGN: read anonymously (anon SELECT via PostgREST) by employers.perceptionx.ai. Revoking anon SELECT breaks the public site with 401s - see 20260721000000_restore_public_index_anon_grants.';
COMMENT ON MATERIALIZED VIEW public.company_search_index IS
  'PUBLIC BY DESIGN: read anonymously (anon SELECT via PostgREST) by the employers.perceptionx.ai company search. Revoking anon SELECT breaks the public site with 401s - see 20260721000000_restore_public_index_anon_grants.';
