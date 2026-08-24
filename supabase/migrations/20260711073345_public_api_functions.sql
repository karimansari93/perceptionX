-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260711073345; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- ---------------------------------------------------------------------------
-- Public read-only API functions for AI assistants (ChatGPT, Claude, Gemini,
-- Copilot, Perplexity) and other programmatic consumers.
--
-- These back the Netlify edge function that serves:
--   GET /api/search?q=...
--   GET /api/company/:slug
--   GET /api/rankings?industry=&country=&month=&limit=&page=&sort=
--   GET /api/compare?companies=a,b,c
--
-- All functions are read-only, return jsonb, and are granted to anon.
-- Ranks are computed deterministically: score_all DESC, mention_count DESC,
-- canonical_name ASC — so ties (e.g. Google/Microsoft both 77.8 in
-- Technology/US) always resolve the same way.
-- ---------------------------------------------------------------------------

-- Map a country query value (code or name) to the value stored in the MVs.
-- Returns NULL for unrecognised/absent input (callers treat NULL as "default").
CREATE OR REPLACE FUNCTION public.api_db_country(p_country text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(trim(coalesce(p_country, '')))
    WHEN 'us'  THEN 'United States'
    WHEN 'usa' THEN 'United States'
    WHEN 'united states' THEN 'United States'
    WHEN 'gb'  THEN 'United Kingdom'
    WHEN 'uk'  THEN 'United Kingdom'
    WHEN 'united kingdom' THEN 'United Kingdom'
    WHEN 'fr'  THEN 'France'
    WHEN 'france' THEN 'France'
    WHEN 'de'  THEN 'Germany'
    WHEN 'germany' THEN 'Germany'
    WHEN 'br'  THEN 'Brazil'
    WHEN 'brazil' THEN 'Brazil'
    WHEN 'cn'  THEN 'China'
    WHEN 'china' THEN 'China'
    WHEN 'in'  THEN 'India'
    WHEN 'india' THEN 'India'
    ELSE NULL
  END;
$$;

-- Resolve a URL slug to a canonical company name.
-- Order: retired-slug aliases -> pre-generated snapshots -> live slugify match.
CREATE OR REPLACE FUNCTION public.api_resolve_slug(p_slug text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $$
  SELECT coalesce(
    (SELECT canonical_name FROM company_slug_aliases WHERE old_slug = lower(trim(p_slug)) LIMIT 1),
    (SELECT canonical_name FROM company_snapshots WHERE slug = lower(trim(p_slug)) LIMIT 1),
    get_canonical_name_from_slug(lower(trim(p_slug)))
  );
$$;

-- ---------------------------------------------------------------------------
-- api_company: full profile for one company.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_company(p_slug text, p_country text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_canonical text;
  v_country   text;
  v_industry  text;
  v_row       rankings_overview%ROWTYPE;
  v_industry_rank int;
  v_total_in_industry int;
  v_overall_rank int;
  v_total_in_country int;
  v_themes    jsonb;
  v_history   jsonb;
  v_other     jsonb;
  v_snapshot  record;
  v_month     text;
BEGIN
  v_canonical := api_resolve_slug(p_slug);
  IF v_canonical IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'not_found',
      'message', format('No company found for slug "%s". Use /api/search?q=<name> to find tracked companies.', p_slug)
    );
  END IF;

  -- Pick country: requested -> United States -> best available.
  SELECT country INTO v_country
  FROM rankings_overview
  WHERE lower(canonical_name) = lower(v_canonical)
  ORDER BY
    (country = coalesce(api_db_country(p_country), 'United States')) DESC,
    (country = 'United States') DESC,
    score_all DESC
  LIMIT 1;

  IF v_country IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'not_found',
      'message', format('"%s" is not currently in the PerceptionX Employer Visibility Index.', v_canonical)
    );
  END IF;

  -- Primary industry = best-scoring slice in that country.
  SELECT * INTO v_row
  FROM rankings_overview
  WHERE lower(canonical_name) = lower(v_canonical) AND country = v_country
  ORDER BY score_all DESC, mention_count DESC
  LIMIT 1;

  v_industry := v_row.industry_context;
  v_month := coalesce(v_row.data_period, to_char(now(), 'YYYY-MM'));

  -- Industry rank (within industry + country).
  SELECT r.rnk, r.total INTO v_industry_rank, v_total_in_industry
  FROM (
    SELECT canonical_name,
           rank() OVER (ORDER BY score_all DESC, mention_count DESC, canonical_name ASC) AS rnk,
           count(*) OVER () AS total
    FROM rankings_overview
    WHERE industry_context = v_industry AND country = v_country
  ) r
  WHERE lower(r.canonical_name) = lower(v_canonical);

  -- Overall rank (each company counted once per country, by its best score).
  SELECT r.rnk, r.total INTO v_overall_rank, v_total_in_country
  FROM (
    SELECT canonical_name,
           rank() OVER (ORDER BY best_score DESC, best_mentions DESC, canonical_name ASC) AS rnk,
           count(*) OVER () AS total
    FROM (
      SELECT canonical_name, max(score_all) AS best_score, max(mention_count) AS best_mentions
      FROM rankings_overview
      WHERE country = v_country
      GROUP BY canonical_name
    ) b
  ) r
  WHERE lower(r.canonical_name) = lower(v_canonical);

  -- Theme scores & ranks within the primary industry slice.
  WITH slice AS (
    SELECT canonical_name, combinations, all_industry_combinations, mention_count
    FROM rankings_overview
    WHERE industry_context = v_industry AND country = v_country
  ),
  industry_theme_totals AS (
    SELECT split_part(c, '::', 2) AS theme, count(DISTINCT c) AS total_combos
    FROM (SELECT DISTINCT unnest(all_industry_combinations) AS c FROM slice) t
    WHERE split_part(c, '::', 2) NOT IN ('null', 'Overall Candidate Experience')
    GROUP BY 1
  ),
  company_theme_counts AS (
    SELECT s.canonical_name, split_part(c, '::', 2) AS theme, count(DISTINCT c) AS combos
    FROM slice s, unnest(s.combinations) AS c
    WHERE split_part(c, '::', 2) NOT IN ('null', 'Overall Candidate Experience')
    GROUP BY 1, 2
  ),
  scored AS (
    SELECT ctc.canonical_name, ctc.theme,
           round(least(100.0, ctc.combos::numeric / nullif(itt.total_combos, 0) * 100), 1) AS score
    FROM company_theme_counts ctc
    JOIN industry_theme_totals itt USING (theme)
  ),
  ranked AS (
    SELECT theme, canonical_name, score,
           rank() OVER (PARTITION BY theme ORDER BY score DESC, canonical_name ASC) AS rnk
    FROM scored
  )
  SELECT coalesce(jsonb_object_agg(theme, jsonb_build_object('rank', rnk, 'score', score) ORDER BY theme), '{}'::jsonb)
  INTO v_themes
  FROM ranked
  WHERE lower(canonical_name) = lower(v_canonical);

  -- Monthly history within the primary industry slice.
  WITH hist AS (
    SELECT index_period, canonical_name, score_all, mention_count,
           rank() OVER (PARTITION BY index_period ORDER BY score_all DESC, mention_count DESC, canonical_name ASC) AS rnk
    FROM rankings_historical
    WHERE industry_context = v_industry AND country = v_country
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'month', index_period,
           'rank', rnk,
           'visibilityScore', score_all
         ) ORDER BY index_period), '[]'::jsonb)
  INTO v_history
  FROM hist
  WHERE lower(canonical_name) = lower(v_canonical);

  -- Other industries the company ranks in (same country).
  WITH ranked AS (
    SELECT industry_context, canonical_name, score_all,
           rank() OVER (PARTITION BY industry_context ORDER BY score_all DESC, mention_count DESC, canonical_name ASC) AS rnk
    FROM rankings_overview
    WHERE country = v_country
      AND industry_context IN (
        SELECT industry_context FROM rankings_overview
        WHERE lower(canonical_name) = lower(v_canonical) AND country = v_country
      )
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'industry', industry_context,
           'industryRank', rnk,
           'visibilityScore', score_all
         ) ORDER BY score_all DESC), '[]'::jsonb)
  INTO v_other
  FROM ranked
  WHERE lower(canonical_name) = lower(v_canonical) AND industry_context <> v_industry;

  SELECT updated_at::date AS updated, snapshot_text INTO v_snapshot
  FROM company_snapshots WHERE lower(canonical_name) = lower(v_canonical) LIMIT 1;

  RETURN jsonb_build_object(
    'company', v_row.canonical_name,
    'slug', slugify_name(v_row.canonical_name),
    'website', nullif(v_row.website_domain, ''),
    'industry', v_industry,
    'country', v_country,
    'month', v_month,
    'visibilityScore', v_row.score_all,
    'overallRank', v_overall_rank,
    'totalCompaniesInCountry', v_total_in_country,
    'industryRank', v_industry_rank,
    'totalCompaniesInIndustry', v_total_in_industry,
    'mentionCount', v_row.mention_count,
    'modelScores', jsonb_build_object(
      'chatgpt', v_row.score_chatgpt,
      'googleAi', v_row.score_google,
      'perplexity', v_row.score_perplexity
    ),
    'themes', v_themes,
    'otherIndustries', v_other,
    'history', v_history,
    'summary', v_snapshot.snapshot_text,
    'lastUpdated', coalesce(to_char(v_snapshot.updated, 'YYYY-MM-DD'), to_char(now(), 'YYYY-MM-DD')),
    'profileUrl', 'https://employers.perceptionx.ai/company/' || slugify_name(v_row.canonical_name)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- api_search: fuzzy company search with latest-ranking enrichment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_search(q text, p_country text DEFAULT NULL, max_results integer DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_results jsonb;
  v_limit int := least(greatest(coalesce(max_results, 5), 1), 20);
BEGIN
  IF q IS NULL OR length(trim(q)) = 0 THEN
    RETURN jsonb_build_object('error', 'bad_request', 'message', 'Provide a search term via ?q=');
  END IF;

  WITH matches AS (
    SELECT s.canonical_name, s.website_domain, s.industries, s.total_mentions, s.best_industry,
           s.matched_variant, row_number() OVER () AS pos
    FROM search_companies(trim(q), v_limit) s
  ),
  best_slice AS (
    SELECT DISTINCT ON (m.canonical_name)
           m.canonical_name, m.website_domain, m.industries, m.matched_variant, m.pos,
           ro.industry_context, ro.country, ro.score_all, ro.mention_count,
           coalesce(ro.data_period, to_char(now(), 'YYYY-MM')) AS month
    FROM matches m
    JOIN rankings_overview ro ON lower(ro.canonical_name) = lower(m.canonical_name)
    ORDER BY m.canonical_name,
             (ro.country = coalesce(api_db_country(p_country), 'United States')) DESC,
             (ro.country = 'United States') DESC,
             ro.score_all DESC
  ),
  industry_ranks AS (
    SELECT ro.industry_context, ro.country, ro.canonical_name,
           rank() OVER (PARTITION BY ro.industry_context, ro.country
                        ORDER BY ro.score_all DESC, ro.mention_count DESC, ro.canonical_name ASC) AS industry_rank,
           count(*) OVER (PARTITION BY ro.industry_context, ro.country) AS total_in_industry
    FROM rankings_overview ro
    WHERE (ro.industry_context, ro.country) IN (SELECT industry_context, country FROM best_slice)
  ),
  overall_ranks AS (
    SELECT country, canonical_name,
           rank() OVER (PARTITION BY country ORDER BY best_score DESC, best_mentions DESC, canonical_name ASC) AS overall_rank
    FROM (
      SELECT country, canonical_name, max(score_all) AS best_score, max(mention_count) AS best_mentions
      FROM rankings_overview
      WHERE country IN (SELECT country FROM best_slice)
      GROUP BY country, canonical_name
    ) b
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'company', bs.canonical_name,
    'slug', slugify_name(bs.canonical_name),
    'website', nullif(bs.website_domain, ''),
    'industry', bs.industry_context,
    'industries', to_jsonb(bs.industries),
    'country', bs.country,
    'matchedVariant', bs.matched_variant,
    'latestRanking', jsonb_build_object(
      'rank', o.overall_rank,
      'industryRank', ir.industry_rank,
      'totalCompaniesInIndustry', ir.total_in_industry,
      'visibilityScore', bs.score_all,
      'month', bs.month
    ),
    'profileUrl', 'https://employers.perceptionx.ai/company/' || slugify_name(bs.canonical_name),
    'apiUrl', 'https://employers.perceptionx.ai/api/company/' || slugify_name(bs.canonical_name)
  ) ORDER BY bs.pos), '[]'::jsonb)
  INTO v_results
  FROM best_slice bs
  JOIN industry_ranks ir
    ON ir.industry_context = bs.industry_context AND ir.country = bs.country
   AND lower(ir.canonical_name) = lower(bs.canonical_name)
  JOIN overall_ranks o
    ON o.country = bs.country AND lower(o.canonical_name) = lower(bs.canonical_name);

  RETURN jsonb_build_object('query', trim(q), 'results', v_results);
END;
$$;

-- ---------------------------------------------------------------------------
-- api_rankings: leaderboards.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_rankings(
  p_industry text DEFAULT NULL,
  p_country  text DEFAULT NULL,
  p_month    text DEFAULT NULL,
  p_limit    integer DEFAULT 25,
  p_page     integer DEFAULT 1,
  p_sort     text DEFAULT 'rank'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_country text := coalesce(api_db_country(p_country), 'United States');
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_sort text := lower(coalesce(p_sort, 'rank'));
  v_industry text;
  v_prev_period text;
  v_total int;
  v_items jsonb;
  v_month text;
BEGIN
  IF v_sort NOT IN ('rank', 'score', 'mentions', 'name', 'change') THEN
    RETURN jsonb_build_object('error', 'bad_request',
      'message', 'sort must be one of: rank, score, mentions, name, change');
  END IF;

  IF p_industry IS NOT NULL AND length(trim(p_industry)) > 0 THEN
    SELECT industry_context INTO v_industry
    FROM rankings_overview
    WHERE lower(industry_context) = lower(trim(p_industry))
       OR slugify_name(industry_context) = lower(trim(p_industry))
    LIMIT 1;
    IF v_industry IS NULL THEN
      RETURN jsonb_build_object('error', 'not_found',
        'message', format('Unknown industry "%s". See /api/rankings without an industry filter, or /api for the list of industries.', p_industry),
        'availableIndustries', (SELECT jsonb_agg(DISTINCT industry_context ORDER BY industry_context) FROM rankings_overview));
    END IF;
  END IF;

  IF p_month IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM rankings_historical WHERE index_period = p_month
  ) THEN
    RETURN jsonb_build_object('error', 'not_found',
      'message', format('No data for month "%s".', p_month),
      'availableMonths', (SELECT jsonb_agg(DISTINCT index_period ORDER BY index_period) FROM rankings_historical));
  END IF;

  SELECT max(index_period) INTO v_prev_period
  FROM rankings_historical
  WHERE (p_month IS NULL OR index_period < p_month)
    AND country = v_country
    AND (v_industry IS NULL OR industry_context = v_industry);

  WITH src AS (
    SELECT canonical_name, website_domain, industry_context, score_all, mention_count,
           coalesce(data_period, to_char(now(), 'YYYY-MM')) AS month
    FROM rankings_overview
    WHERE country = v_country AND p_month IS NULL
      AND (v_industry IS NULL OR industry_context = v_industry)
    UNION ALL
    SELECT canonical_name, website_domain, industry_context, score_all, mention_count, index_period
    FROM rankings_historical
    WHERE country = v_country AND index_period = p_month
      AND (v_industry IS NULL OR industry_context = v_industry)
  ),
  cur AS (
    SELECT DISTINCT ON (canonical_name)
           canonical_name, website_domain, industry_context AS industry,
           score_all AS score, mention_count AS mentions, month
    FROM src
    ORDER BY canonical_name, score_all DESC, mention_count DESC
  ),
  ranked AS (
    SELECT *, rank() OVER (ORDER BY score DESC, mentions DESC, canonical_name ASC) AS rnk
    FROM cur
  ),
  prev AS (
    SELECT canonical_name,
           rank() OVER (ORDER BY best_score DESC, best_mentions DESC, canonical_name ASC) AS prev_rnk
    FROM (
      SELECT canonical_name, max(score_all) AS best_score, max(mention_count) AS best_mentions
      FROM rankings_historical
      WHERE country = v_country AND index_period = v_prev_period
        AND (v_industry IS NULL OR industry_context = v_industry)
      GROUP BY canonical_name
    ) b
  ),
  rows_all AS (
    SELECT r.canonical_name, r.website_domain, r.industry, r.score, r.mentions, r.month, r.rnk, p.prev_rnk
    FROM ranked r LEFT JOIN prev p ON lower(p.canonical_name) = lower(r.canonical_name)
  ),
  ordered AS (
    SELECT *, row_number() OVER (
             ORDER BY
               CASE WHEN v_sort = 'change' THEN coalesce(prev_rnk - rnk, -100000) END DESC,
               CASE WHEN v_sort = 'mentions' THEN mentions END DESC,
               CASE WHEN v_sort = 'name' THEN canonical_name END ASC,
               rnk ASC
           ) AS ord
    FROM rows_all
  )
  SELECT
    (SELECT count(*) FROM rows_all),
    (SELECT max(month) FROM rows_all),
    coalesce(jsonb_agg(jsonb_build_object(
      'rank', rnk,
      'company', canonical_name,
      'slug', slugify_name(canonical_name),
      'website', nullif(website_domain, ''),
      'industry', industry,
      'visibilityScore', score,
      'mentionCount', mentions,
      'previousRank', prev_rnk,
      'rankChange', CASE WHEN prev_rnk IS NOT NULL THEN prev_rnk - rnk ELSE NULL END,
      'profileUrl', 'https://employers.perceptionx.ai/company/' || slugify_name(canonical_name)
    ) ORDER BY ord), '[]'::jsonb)
  INTO v_total, v_month, v_items
  FROM ordered
  WHERE ord > (v_page - 1) * v_limit AND ord <= v_page * v_limit;

  RETURN jsonb_build_object(
    'industry', v_industry,
    'country', v_country,
    'month', coalesce(p_month, v_month),
    'previousMonth', v_prev_period,
    'sort', v_sort,
    'page', v_page,
    'limit', v_limit,
    'totalCompanies', v_total,
    'rankings', v_items
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- api_compare: side-by-side profiles for 2-5 companies.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_compare(p_slugs text[], p_country text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_slug text;
  v_companies jsonb := '[]'::jsonb;
  v_count int := 0;
BEGIN
  IF p_slugs IS NULL OR array_length(p_slugs, 1) IS NULL OR array_length(p_slugs, 1) < 2 THEN
    RETURN jsonb_build_object('error', 'bad_request',
      'message', 'Provide 2-5 company slugs, e.g. /api/compare?companies=microsoft,google');
  END IF;

  FOREACH v_slug IN ARRAY p_slugs LOOP
    EXIT WHEN v_count >= 5;
    CONTINUE WHEN length(trim(v_slug)) = 0;
    v_companies := v_companies || jsonb_build_array(api_company(trim(v_slug), p_country));
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('companies', v_companies);
END;
$$;

-- ---------------------------------------------------------------------------
-- api_meta: index metadata for the API root (industries, countries, months).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_meta()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT jsonb_build_object(
    'industries', (SELECT jsonb_agg(DISTINCT industry_context ORDER BY industry_context) FROM rankings_overview),
    'countries', (SELECT jsonb_agg(DISTINCT country ORDER BY country) FROM rankings_overview),
    'months', (SELECT jsonb_agg(DISTINCT index_period ORDER BY index_period) FROM rankings_historical),
    'totalCompanies', (SELECT count(DISTINCT canonical_name) FROM rankings_overview)
  );
$$;

-- Grants: public, read-only.
GRANT EXECUTE ON FUNCTION public.api_db_country(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_resolve_slug(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_company(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_search(text, text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_rankings(text, text, text, integer, integer, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_compare(text[], text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_meta() TO anon, authenticated, service_role;
