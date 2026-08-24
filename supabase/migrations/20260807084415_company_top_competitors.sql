-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260807084415; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Add topCompetitors (name + slug + rank + score) to api_company, for both
-- current and historical profiles. The crawler-rendered company pages link
-- these as related profiles — previously each company page had only two
-- internal links, leaving ~4,900 pages as near-orphans in the link graph —
-- and API consumers get ready-made slugs for follow-up /api/company calls.

CREATE OR REPLACE FUNCTION public.api_company(p_slug text, p_country text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_canonical text;
  v_country   text;
  v_industry  text;
  v_row       rankings_overview%ROWTYPE;
  v_hrow      rankings_historical%ROWTYPE;
  v_industry_rank int;
  v_total_in_industry int;
  v_overall_rank int;
  v_total_in_country int;
  v_themes    jsonb;
  v_history   jsonb;
  v_other     jsonb;
  v_competitors jsonb;
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
    -- Not in the current index: fall back to the company's most recent
    -- historical slice so retired profiles stay resolvable.
    SELECT h.index_period INTO v_month
    FROM rankings_historical h
    WHERE lower(h.canonical_name) = lower(v_canonical)
    ORDER BY h.index_period DESC
    LIMIT 1;

    IF v_month IS NULL THEN
      RETURN jsonb_build_object(
        'error', 'not_found',
        'message', format('"%s" is not currently in the PerceptionX Employer Visibility Index.', v_canonical)
      );
    END IF;

    SELECT * INTO v_hrow
    FROM rankings_historical
    WHERE lower(canonical_name) = lower(v_canonical) AND index_period = v_month
    ORDER BY
      (country = coalesce(api_db_country(p_country), 'United States')) DESC,
      (country = 'United States') DESC,
      score_all DESC, mention_count DESC
    LIMIT 1;

    v_country := v_hrow.country;
    v_industry := v_hrow.industry_context;

    SELECT r.rnk, r.total INTO v_industry_rank, v_total_in_industry
    FROM (
      SELECT canonical_name,
             rank() OVER (ORDER BY score_all DESC, mention_count DESC, canonical_name ASC) AS rnk,
             count(*) OVER () AS total
      FROM rankings_historical
      WHERE industry_context = v_industry AND country = v_country AND index_period = v_month
    ) r
    WHERE lower(r.canonical_name) = lower(v_canonical);

    SELECT r.rnk, r.total INTO v_overall_rank, v_total_in_country
    FROM (
      SELECT canonical_name,
             rank() OVER (ORDER BY best_score DESC, best_mentions DESC, canonical_name ASC) AS rnk,
             count(*) OVER () AS total
      FROM (
        SELECT canonical_name, max(score_all) AS best_score, max(mention_count) AS best_mentions
        FROM rankings_historical
        WHERE country = v_country AND index_period = v_month
        GROUP BY canonical_name
      ) b
    ) r
    WHERE lower(r.canonical_name) = lower(v_canonical);

    -- Best-ranked peers in the same historical slice.
    WITH comp AS (
      SELECT canonical_name, score_all,
             rank() OVER (ORDER BY score_all DESC, mention_count DESC, canonical_name ASC) AS rnk
      FROM rankings_historical
      WHERE industry_context = v_industry AND country = v_country AND index_period = v_month
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'company', canonical_name,
             'slug', slugify_name(canonical_name),
             'rank', rnk,
             'visibilityScore', score_all
           ) ORDER BY rnk), '[]'::jsonb)
    INTO v_competitors
    FROM (
      SELECT * FROM comp
      WHERE lower(canonical_name) <> lower(v_canonical)
      ORDER BY rnk LIMIT 5
    ) t;

    WITH slice AS (
      SELECT canonical_name, combinations, all_period_combinations AS all_industry_combinations
      FROM rankings_historical
      WHERE industry_context = v_industry AND country = v_country AND index_period = v_month
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

    WITH ranked AS (
      SELECT industry_context, canonical_name, score_all,
             rank() OVER (PARTITION BY industry_context ORDER BY score_all DESC, mention_count DESC, canonical_name ASC) AS rnk
      FROM rankings_historical
      WHERE country = v_country AND index_period = v_month
        AND industry_context IN (
          SELECT industry_context FROM rankings_historical
          WHERE lower(canonical_name) = lower(v_canonical)
            AND country = v_country AND index_period = v_month
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

    RETURN jsonb_build_object(
      'company', v_hrow.canonical_name,
      'slug', slugify_name(v_hrow.canonical_name),
      'website', nullif(v_hrow.website_domain, ''),
      'industry', v_industry,
      'country', v_country,
      'month', v_month,
      'status', 'historical',
      'lastRanked', v_month,
      'note', format('%s is not in the current index; this profile reflects its last ranked period (%s).', v_hrow.canonical_name, v_month),
      'visibilityScore', v_hrow.score_all,
      'overallRank', v_overall_rank,
      'totalCompaniesInCountry', v_total_in_country,
      'industryRank', v_industry_rank,
      'totalCompaniesInIndustry', v_total_in_industry,
      'mentionCount', v_hrow.mention_count,
      'modelScores', jsonb_build_object(
        'chatgpt', v_hrow.score_chatgpt,
        'googleAi', v_hrow.score_google,
        'perplexity', v_hrow.score_perplexity
      ),
      'themes', v_themes,
      'topCompetitors', coalesce(v_competitors, '[]'::jsonb),
      'otherIndustries', v_other,
      'history', v_history,
      'summary', NULL,
      'lastUpdated', v_month,
      'profileUrl', 'https://employers.perceptionx.ai/company/' || slugify_name(v_hrow.canonical_name)
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

  -- Best-ranked peers in the same slice.
  WITH comp AS (
    SELECT canonical_name, score_all,
           rank() OVER (ORDER BY score_all DESC, mention_count DESC, canonical_name ASC) AS rnk
    FROM rankings_overview
    WHERE industry_context = v_industry AND country = v_country
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'company', canonical_name,
           'slug', slugify_name(canonical_name),
           'rank', rnk,
           'visibilityScore', score_all
         ) ORDER BY rnk), '[]'::jsonb)
  INTO v_competitors
  FROM (
    SELECT * FROM comp
    WHERE lower(canonical_name) <> lower(v_canonical)
    ORDER BY rnk LIMIT 5
  ) t;

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
    'status', 'current',
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
    'topCompetitors', coalesce(v_competitors, '[]'::jsonb),
    'otherIndustries', v_other,
    'history', v_history,
    'summary', v_snapshot.snapshot_text,
    'lastUpdated', coalesce(to_char(v_snapshot.updated, 'YYYY-MM-DD'), to_char(now(), 'YYYY-MM-DD')),
    'profileUrl', 'https://employers.perceptionx.ai/company/' || slugify_name(v_row.canonical_name)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.api_company(text, text) TO anon, authenticated, service_role;
