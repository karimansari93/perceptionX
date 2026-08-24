-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260811101122; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Follow-up to revive_employee_tier_classifier: the set-based rewrite of
-- get_unclassified_companies evaluated is_source_entity() for the entire
-- backlog below the sort (minutes over ~15k names). Switch to a plpgsql
-- cursor loop so the check only runs down the mentions-ranked list until the
-- batch is filled, and scope to current-cycle responses (index_period IS
-- NULL), which is what feeds rankings_overview.

CREATE OR REPLACE FUNCTION public.get_unclassified_companies(batch_limit integer DEFAULT 400)
RETURNS TABLE(company_name text, primary_industry text, total_mentions bigint)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  rec record;
  emitted integer := 0;
BEGIN
  FOR rec IN
    WITH raw_split AS (
      SELECT pr.id AS response_id,
             cp.industry_context,
             clean_company_name(token.token) AS cleaned_name
      FROM prompt_responses pr
      JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
      CROSS JOIN LATERAL regexp_split_to_table(pr.detected_competitors, '[,;\n]+') token(token)
      WHERE pr.for_index = true
        AND pr.index_period IS NULL  -- current cycle: what feeds rankings_overview
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
      ON lower(t.canonical_name) = lower(cet.company_name)
    LEFT JOIN company_overrides co
      ON lower(t.canonical_name) = lower(co.canonical_name) AND co.status = 'excluded'
    WHERE cet.company_name IS NULL
      AND co.id IS NULL
    ORDER BY t.total_mentions DESC
  LOOP
    EXIT WHEN emitted >= batch_limit;
    IF NOT is_source_entity(rec.canonical_name, rec.canonical_name) THEN
      company_name := rec.canonical_name;
      primary_industry := rec.primary_industry;
      total_mentions := rec.total_mentions;
      emitted := emitted + 1;
      RETURN NEXT;
    END IF;
  END LOOP;
  RETURN;
END;
$$;
