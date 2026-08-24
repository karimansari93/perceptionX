-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260811124700; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Make the tier-classification anti-joins trim-insensitive.
--
-- 14 canonical names truncated at a trailing ampersand ("Levi Strauss & ",
-- "Rothschild & ", ...) kept the catch-up loop alive forever: the
-- classify-company-size edge function trims names before upserting into
-- company_employee_tiers ("levi strauss &"), but the queue refresh and RPC
-- compared lower() without trimming, so the queue names (with trailing
-- space) never matched their tier rows and were re-fetched and re-classified
-- on every tick — and the tick never saw an empty queue, so the temporary
-- catch-up job could not unschedule itself.
--
-- btrim both sides of the anti-joins in refresh_tier_classification_queue()
-- and get_unclassified_companies().

CREATE OR REPLACE FUNCTION public.refresh_tier_classification_queue()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_count bigint;
BEGIN
  TRUNCATE public.company_tier_classification_queue;

  INSERT INTO public.company_tier_classification_queue
    (company_name, primary_industry, total_mentions)
  WITH raw_split AS (
    SELECT pr.id AS response_id,
           cp.industry_context,
           clean_company_name(token.token) AS cleaned_name
    FROM prompt_responses pr
    JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
    CROSS JOIN LATERAL regexp_split_to_table(pr.detected_competitors, '[,;\n]+') token(token)
    WHERE pr.for_index = true
      AND pr.index_period IS NULL
      AND cp.industry_context IS NOT NULL
      AND cp.location_context IS NOT NULL
      AND length(TRIM(BOTH FROM token.token)) > 1
  ), distinct_names AS (
    SELECT DISTINCT cleaned_name FROM raw_split
  ), canonical_map AS (
    SELECT dn.cleaned_name AS raw_name,
           COALESCE(ccn.canonical_name, initcap(dn.cleaned_name)) AS canonical_name
    FROM distinct_names dn
    LEFT JOIN company_canonical_names ccn ON lower(dn.cleaned_name) = lower(ccn.variant_name)
    WHERE length(TRIM(BOTH FROM COALESCE(ccn.canonical_name, initcap(dn.cleaned_name)))) > 0
  ), mentions AS (
    SELECT cm.canonical_name,
           rs.industry_context,
           count(DISTINCT rs.response_id) AS mention_count
    FROM raw_split rs
    JOIN canonical_map cm ON cm.raw_name = rs.cleaned_name
    GROUP BY 1, 2
  ), totals AS (
    SELECT canonical_name,
           sum(mention_count)::bigint AS total_mentions,
           (array_agg(industry_context ORDER BY mention_count DESC))[1] AS primary_industry
    FROM mentions
    GROUP BY 1
  )
  SELECT t.canonical_name, t.primary_industry, t.total_mentions
  FROM totals t
  LEFT JOIN company_employee_tiers cet
    ON lower(btrim(t.canonical_name)) = lower(btrim(cet.company_name))
  LEFT JOIN company_overrides co
    ON lower(btrim(t.canonical_name)) = lower(btrim(co.canonical_name)) AND co.status = 'excluded'
  WHERE cet.company_name IS NULL
    AND co.id IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_unclassified_companies(batch_limit integer DEFAULT 400)
RETURNS TABLE(company_name text, primary_industry text, total_mentions bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $$
  SELECT q.company_name, q.primary_industry, q.total_mentions
  FROM company_tier_classification_queue q
  LEFT JOIN company_employee_tiers cet
    ON lower(btrim(q.company_name)) = lower(btrim(cet.company_name))
  WHERE cet.company_name IS NULL
  ORDER BY q.total_mentions DESC
  LIMIT batch_limit;
$$;
