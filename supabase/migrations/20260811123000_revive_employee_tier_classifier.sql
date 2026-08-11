-- Revive the employee tier classifier pipeline.
--
-- company_employee_tiers was last populated by the classify-company-size edge
-- function on 2026-03-30 (plus a manual top-up on 2026-04-08). Everything
-- discovered since — ~14.9k canonical names including Petrofac, Sobha Realty,
-- Wood, Meraas, Metropolitan Group, Provident Real Estate, Technip Energies,
-- Azizi Developments, Worley — has no tier row, and rankings_overview /
-- rankings_historical require a tier row (estimated_tier filter), so those
-- companies silently vanish from the public index.
--
-- Root causes, all fixed here:
--
-- 1. get_unclassified_companies() referenced ro.company_name, a column
--    renamed to canonical_name in 20260312130450
--    (rankings_overview_aggregate_by_canonical). Every classifier run since
--    then failed with 42703 at the RPC step.
--
-- 2. Even with the column fixed, the RPC sourced FROM rankings_overview —
--    which drops unclassified companies via its tier filter
--    (20260307075053 filter_small_companies_from_rankings_overview, applied
--    the day after the RPC was created). The companies most in need of
--    classification were invisible to it by construction.
--
-- 3. Recomputing candidates from the raw response pipeline is too slow for a
--    PostgREST call (the edge function's RPC hits the API statement timeout).
--    The heavy scan therefore lives in refresh_tier_classification_queue(),
--    run from pg_cron (no statement timeout), and the RPC is a trivial read
--    of the precomputed queue.
--
-- Also adds a trigger preventing any update from clobbering
-- classified_by='manual' rows (the candidate queue already excludes
-- classified names, but this makes the invariant structural), and a daily
-- pg_cron job so classification can't silently drift again.

-- ---------------------------------------------------------------------------
-- 1. Candidate queue, precomputed from the raw response pipeline
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.company_tier_classification_queue (
  company_name     text PRIMARY KEY,
  primary_industry text,
  total_mentions   bigint NOT NULL DEFAULT 0,
  enqueued_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_tier_classification_queue ENABLE ROW LEVEL SECURITY;
-- service_role bypasses RLS; no policies: the queue is internal to the
-- classifier pipeline.

CREATE OR REPLACE FUNCTION public.refresh_tier_classification_queue()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_count bigint;
BEGIN
  -- Same tokenisation + canonicalisation as the rankings MVs, minus their
  -- tier filter (which is exactly what hides unclassified companies).
  -- Source entities are NOT filtered out here: classifying one wastes a
  -- cheap LLM call but is harmless (the rankings MVs exclude sources
  -- independently via is_source_entity), and the check is far too slow to
  -- run over the whole backlog.
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
    AND co.id IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.refresh_tier_classification_queue() IS
  'Rebuilds company_tier_classification_queue: canonical names seen in '
  'current-cycle for_index responses with no company_employee_tiers row. '
  'Heavy scan — call from pg_cron / direct SQL, not through the API.';

-- ---------------------------------------------------------------------------
-- 2. RPC the classify-company-size edge function calls (must be fast:
--    PostgREST calls run under the API statement timeout)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_unclassified_companies(batch_limit integer DEFAULT 400)
RETURNS TABLE(company_name text, primary_industry text, total_mentions bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $$
  -- Re-check tiers so names classified since the last queue refresh (or by a
  -- concurrent run) drop out immediately.
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

-- ---------------------------------------------------------------------------
-- 3. Manual tier rows are never overwritten
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_manual_tier_rows()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Editorially-set rows win over any automated reclassification. Skip the
  -- update silently so classifier upserts don't error.
  IF OLD.classified_by = 'manual' AND NEW.classified_by IS DISTINCT FROM 'manual' THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_manual_tier_rows ON public.company_employee_tiers;
CREATE TRIGGER protect_manual_tier_rows
  BEFORE UPDATE ON public.company_employee_tiers
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_manual_tier_rows();

-- ---------------------------------------------------------------------------
-- 4. Scheduled classification so this can't drift again
-- ---------------------------------------------------------------------------

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

SELECT cron.schedule(
  'classify-company-sizes-daily',
  '40 3 * * *',
  $$ SELECT public.classify_company_size_tick(1000); $$
);
