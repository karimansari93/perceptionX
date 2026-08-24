-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260811101729; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Follow-up to revive_employee_tier_classifier /
-- get_unclassified_companies_lazy_source_check: recomputing candidates from
-- the raw pipeline inside the RPC hits the API statement timeout when the
-- edge function calls it through PostgREST. Move the heavy scan into a
-- precomputed queue refreshed by the tick (pg_cron context, no timeout) and
-- make the RPC a trivial read. The is_source_entity check is dropped from
-- this path: classifying a source entity wastes one cheap LLM call and is
-- otherwise harmless (the rankings MVs filter sources independently).

CREATE TABLE IF NOT EXISTS public.company_tier_classification_queue (
  company_name     text PRIMARY KEY,
  primary_industry text,
  total_mentions   bigint NOT NULL DEFAULT 0,
  enqueued_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_tier_classification_queue ENABLE ROW LEVEL SECURITY;

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
    ON lower(t.canonical_name) = lower(cet.company_name)
  LEFT JOIN company_overrides co
    ON lower(t.canonical_name) = lower(co.canonical_name) AND co.status = 'excluded'
  WHERE cet.company_name IS NULL
    AND co.id IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.refresh_tier_classification_queue() IS
  'Rebuilds company_tier_classification_queue: canonical names seen in '
  'current-cycle for_index responses with no company_employee_tiers row. '
  'Heavy scan - call from pg_cron / direct SQL, not through the API.';

CREATE OR REPLACE FUNCTION public.get_unclassified_companies(batch_limit integer DEFAULT 400)
RETURNS TABLE(company_name text, primary_industry text, total_mentions bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $$
  SELECT q.company_name, q.primary_industry, q.total_mentions
  FROM company_tier_classification_queue q
  LEFT JOIN company_employee_tiers cet
    ON lower(q.company_name) = lower(cet.company_name)
  WHERE cet.company_name IS NULL
  ORDER BY q.total_mentions DESC
  LIMIT batch_limit;
$$;

COMMENT ON FUNCTION public.get_unclassified_companies(integer) IS
  'Unclassified canonical company names, most-mentioned first, from the '
  'precomputed company_tier_classification_queue. Feeds the '
  'classify-company-size edge function.';

CREATE OR REPLACE FUNCTION public.classify_company_size_tick(p_limit integer DEFAULT 1000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
    v_project_url TEXT;
    v_service_key TEXT;
    v_request_id  BIGINT;
    v_queued      BIGINT;
BEGIN
    SELECT decrypted_secret INTO v_project_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url';
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

    IF v_project_url IS NULL OR v_service_key IS NULL THEN
        RAISE NOTICE 'classify_company_size_tick: missing supabase_url or service_role_key in vault, skipping';
        RETURN jsonb_build_object('kicked', false, 'reason', 'missing_vault_secret');
    END IF;

    v_queued := public.refresh_tier_classification_queue();

    IF v_queued = 0 THEN
        RETURN jsonb_build_object('kicked', false, 'reason', 'queue_empty', 'queued', 0);
    END IF;

    SELECT net.http_post(
        url := v_project_url || '/functions/v1/classify-company-size',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || v_service_key,
            'Content-Type',  'application/json'
        ),
        body := jsonb_build_object('limit', p_limit),
        timeout_milliseconds := 300000
    ) INTO v_request_id;

    RETURN jsonb_build_object('kicked', true, 'request_id', v_request_id, 'queued', v_queued);
END;
$$;

COMMENT ON FUNCTION public.classify_company_size_tick(integer) IS
  'Refreshes the tier classification queue, then kicks the '
  'classify-company-size edge function over it. Scheduled daily; safe to '
  'call ad hoc for catch-up runs.';
