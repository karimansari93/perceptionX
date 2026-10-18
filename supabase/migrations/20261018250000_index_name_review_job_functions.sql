-- Size labels for the companies named in the job-function answers of the 15
-- new countries, so the Index can rank them per job function (Karim,
-- 2026-10-18: "yes go ahead with the $0.12"). Only names that could reach a
-- top 15 in some country x industry x job function are queued (about 1,800 of
-- the 12,000 unlabelled names): the rest cannot reach a top 10 whatever their
-- size. Same review flow as 20261018180000_index_name_review.sql.

-- The duplicate shortlist, shared by both queue functions.
CREATE OR REPLACE FUNCTION public.index_name_review_shortlist()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '900000'
AS $function$
DECLARE
  v_n int;
BEGIN
  PERFORM set_config('pg_trgm.similarity_threshold', '0.45', true);

  INSERT INTO index_name_review_entries (name)
  SELECT canonical_name FROM company_search_index
  ON CONFLICT (name) DO NOTHING;

  -- Similar spellings (trigram index) plus entries the name starts with
  -- ("Samsung Electronics Korea" -> Samsung): every leading run of words.
  UPDATE index_name_review r
  SET candidates = c.cands
  FROM (
    SELECT q.name, (array_agg(e.f ORDER BY e.score DESC))[1:5] AS cands
    FROM index_name_review q
    CROSS JOIN LATERAL (
      SELECT x.f, max(x.score) AS score
      FROM (
        SELECT s.name AS f, similarity(lower(s.name), lower(q.name)) AS score
        FROM index_name_review_entries s
        WHERE lower(s.name) % lower(q.name)
        UNION ALL
        SELECT s.name, 1 + length(p.prefix)
        FROM generate_series(1, 4) AS w(n)
        CROSS JOIN LATERAL (
          SELECT array_to_string((regexp_split_to_array(lower(q.name), '\s+'))[1:w.n], ' ') AS prefix
        ) p
        JOIN index_name_review_entries s ON lower(s.name) = p.prefix
        WHERE p.prefix <> lower(q.name)
      ) x
      WHERE lower(x.f) <> lower(q.name)
      GROUP BY x.f
      ORDER BY 2 DESC
      LIMIT 5
    ) e
    WHERE q.status = 'queued'
    GROUP BY q.name
  ) c
  WHERE c.name = r.name;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.queue_index_name_review(p_min_mentions integer DEFAULT 2)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '900000'
AS $function$
DECLARE
  v_n int;
BEGIN
  WITH raw AS (
    SELECT clean_company_name(t) AS n, ip.country, ip.industry, ir.id AS rid
    FROM index_responses ir
    JOIN index_prompts ip ON ip.id = ir.index_prompt_id
    CROSS JOIN LATERAL regexp_split_to_table(ir.detected_competitors, '[,;\n]+') AS t
    WHERE ip.job_function IS NULL AND ir.index_period IS NULL
      AND ir.detected_competitors IS NOT NULL AND length(btrim(t)) > 1
  ), named AS (
    SELECT coalesce(c.canonical_name, initcap(r.n)) AS name, r.country, r.industry, r.rid
    FROM raw r
    LEFT JOIN company_canonical_names c ON lower(c.variant_name) = r.n
  ), agg AS (
    SELECT name, count(DISTINCT rid)::int AS mentions,
           array_agg(DISTINCT country) AS countries, array_agg(DISTINCT industry) AS industries
    FROM named
    WHERE length(btrim(name)) > 1
    GROUP BY name
  )
  INSERT INTO index_name_review (name, mentions, countries, industries)
  SELECT a.name, a.mentions, a.countries, a.industries
  FROM agg a
  WHERE a.mentions >= p_min_mentions
    AND NOT EXISTS (SELECT 1 FROM company_employee_tiers t WHERE lower(t.company_name) = lower(a.name))
    AND NOT EXISTS (SELECT 1 FROM company_overrides o
                    WHERE lower(o.canonical_name) = lower(a.name) AND o.status = 'excluded')
  ON CONFLICT (name) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  PERFORM index_name_review_shortlist();
  RETURN v_n;
END;
$function$;

-- Unlabelled names within the top p_top of some country x industry x job
-- function, counting only companies that could show (labelled 5,000+ or not
-- labelled yet, and not excluded). Answers per slice, as the rankings count.
CREATE OR REPLACE FUNCTION public.queue_index_name_review_job_functions(p_top integer DEFAULT 15)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '900000'
AS $function$
DECLARE
  v_n int;
BEGIN
  WITH raw AS (
    SELECT DISTINCT ip.country, ip.industry, ip.job_function, ir.id AS rid, clean_company_name(t) AS n
    FROM index_responses ir
    JOIN index_prompts ip ON ip.id = ir.index_prompt_id
    CROSS JOIN LATERAL regexp_split_to_table(ir.detected_competitors, '[,;\n]+') AS t
    WHERE ip.job_function IS NOT NULL AND ir.index_period IS NULL
      AND ir.detected_competitors IS NOT NULL AND length(btrim(t)) > 1
  ), named AS (
    SELECT r.country, r.industry, r.job_function, r.rid, coalesce(c.canonical_name, initcap(r.n)) AS name
    FROM raw r
    LEFT JOIN company_canonical_names c ON lower(c.variant_name) = r.n
  ), slice AS (
    SELECT country, industry, job_function, name, count(DISTINCT rid)::int AS m
    FROM named
    WHERE length(btrim(name)) > 1
    GROUP BY 1, 2, 3, 4
  ), eligible AS (
    SELECT s.*, t.estimated_tier
    FROM slice s
    LEFT JOIN company_employee_tiers t ON lower(t.company_name) = lower(s.name)
    WHERE (t.estimated_tier IS NULL OR t.estimated_tier IN ('5000-49999', '50000+'))
      AND NOT EXISTS (SELECT 1 FROM company_overrides o
                      WHERE lower(o.canonical_name) = lower(s.name) AND o.status = 'excluded')
  ), ranked AS (
    SELECT *, row_number() OVER (PARTITION BY country, industry, job_function ORDER BY m DESC, name) AS r
    FROM eligible
  )
  INSERT INTO index_name_review (name, mentions, countries, industries)
  SELECT name, sum(m)::int, array_agg(DISTINCT country), array_agg(DISTINCT industry)
  FROM ranked
  WHERE estimated_tier IS NULL AND r <= p_top
  GROUP BY name
  ON CONFLICT (name) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  PERFORM index_name_review_shortlist();
  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.index_name_review_shortlist() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.queue_index_name_review(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.queue_index_name_review_job_functions(integer) FROM PUBLIC, anon, authenticated;
