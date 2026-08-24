-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260711074814; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Follow-up: expose data freshness on every API response.
CREATE OR REPLACE FUNCTION public.api_last_refreshed()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT to_char(
    coalesce(
      (SELECT max(refreshed_at) FROM pipeline_freshness WHERE object = 'rankings_overview'),
      now()
    ),
    'YYYY-MM-DD'
  );
$$;

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
    'totalCompanies', (SELECT count(DISTINCT canonical_name) FROM rankings_overview),
    'lastUpdated', api_last_refreshed()
  );
$$;

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
    'lastUpdated', api_last_refreshed(),
    'rankings', v_items
  );
END;
$$;

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

  RETURN jsonb_build_object('query', trim(q), 'results', v_results, 'lastUpdated', api_last_refreshed());
END;
$$;

GRANT EXECUTE ON FUNCTION public.api_last_refreshed() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_meta() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_rankings(text, text, text, integer, integer, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_search(text, text, integer) TO anon, authenticated, service_role;
