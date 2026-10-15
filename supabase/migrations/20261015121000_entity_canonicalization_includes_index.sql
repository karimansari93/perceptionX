-- Entity canonicalization now covers visibility-index company names
-- (2026-10-15, approved by Karim).
--
-- find_unmapped_competitor_variants skipped for_index responses, so names that
-- only appear on the public Index ("Thermo Fisher Scientific France") never
-- reached the rules / LLM / review pipeline. The unscoped call (the SQL tick)
-- now also reads index answers: legacy rows in prompt_responses (for_index)
-- and the index_responses table. Organization / company scoped calls are
-- unchanged (index rows have no company).
--
-- index_responses also marks new competitor data, like prompt_responses, so
-- entity_canonicalization_tick scans after index runs.

CREATE OR REPLACE FUNCTION public.find_unmapped_competitor_variants(
  p_limit integer DEFAULT 50,
  p_organization_id uuid DEFAULT NULL::uuid,
  p_company_id uuid DEFAULT NULL::uuid,
  p_min_mentions integer DEFAULT 2
)
RETURNS TABLE(raw_alias text, normalized_alias text, mention_count integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_ids uuid[];
  v_scoped boolean := (p_company_id IS NOT NULL OR p_organization_id IS NOT NULL);
BEGIN
  IF p_company_id IS NOT NULL THEN
    v_company_ids := ARRAY[p_company_id];
  ELSIF p_organization_id IS NOT NULL THEN
    SELECT array_agg(company_id) INTO v_company_ids
    FROM public.organization_companies
    WHERE organization_id = p_organization_id;
    IF v_company_ids IS NULL OR cardinality(v_company_ids) = 0 THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  WITH lists AS (
    -- Client answers (scoped or not) and, when unscoped, legacy index answers.
    SELECT pr.detected_competitors AS list
    FROM public.prompt_responses pr
    WHERE pr.detected_competitors IS NOT NULL
      AND pr.detected_competitors <> ''
      AND (
        (v_scoped AND pr.for_index IS NOT TRUE AND pr.company_id = ANY (v_company_ids))
        OR NOT v_scoped
      )
    UNION ALL
    -- Index answers stored apart from client data (unscoped only).
    SELECT ir.detected_competitors
    FROM public.index_responses ir
    WHERE NOT v_scoped
      AND ir.detected_competitors IS NOT NULL
      AND ir.detected_competitors <> ''
  ),
  exploded AS (
    SELECT TRIM(BOTH FROM part) AS raw,
           public.normalize_entity_name(TRIM(BOTH FROM part)) AS norm
    FROM lists CROSS JOIN LATERAL UNNEST(STRING_TO_ARRAY(lists.list, ',')) AS part
  ),
  counted AS (
    SELECT raw, norm, COUNT(*)::int AS cnt
    FROM exploded
    WHERE norm IS NOT NULL AND norm <> ''
    GROUP BY raw, norm
  ),
  deduped AS (
    SELECT DISTINCT ON (c.norm) c.raw, c.norm,
           SUM(c.cnt) OVER (PARTITION BY c.norm) AS total
    FROM counted c
    ORDER BY c.norm, c.cnt DESC
  )
  SELECT d.raw AS raw_alias, d.norm AS normalized_alias, d.total::int AS mention_count
  FROM deduped d
  LEFT JOIN public.entity_aliases ea ON ea.normalized_alias = d.norm
  LEFT JOIN public.entity_alias_suggestions sug ON sug.normalized_alias = d.norm
  WHERE ea.id IS NULL
    AND sug.id IS NULL
    AND d.total >= GREATEST(p_min_mentions, 1)
  ORDER BY d.total DESC, d.raw
  LIMIT GREATEST(p_limit, 1);
END;
$function$;

-- CREATE OR REPLACE rather than DROP + CREATE: the Supabase MCP holds DROP
-- statements for a confirmation that never reaches cloud sessions.
CREATE OR REPLACE TRIGGER trg_index_responses_competitors_new_data
  AFTER INSERT OR UPDATE OF detected_competitors ON public.index_responses
  FOR EACH STATEMENT EXECUTE FUNCTION public.mark_competitor_data_new();

-- No manual review queue (Karim, 2026-10-15): the tick also kicks the edge
-- function while suggestions are still waiting for a person, so its review
-- model (gpt-4.1) decides them. Suggestions that model already decided are
-- final and don't keep the backlog open.
CREATE OR REPLACE FUNCTION public.suggest_entity_canonicalization_tick(p_batch integer DEFAULT 300)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_project_url TEXT;
  v_service_key TEXT;
  v_request_id BIGINT;
  v_variants jsonb;
  v_count int;
  v_pending_manual boolean;
BEGIN
  SELECT decrypted_secret INTO v_project_url FROM vault.decrypted_secrets WHERE name = 'supabase_url';
  SELECT decrypted_secret INTO v_service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  IF v_project_url IS NULL OR v_service_key IS NULL THEN
    RAISE NOTICE 'suggest_entity_canonicalization_tick: missing supabase_url or service_role_key in vault, skipping';
    RETURN jsonb_build_object('kicked', false, 'reason', 'missing_vault_secret');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(v)), '[]'::jsonb) INTO v_variants
  FROM public.find_unmapped_competitor_variants(p_batch, NULL, NULL) v;
  v_count := jsonb_array_length(v_variants);

  v_pending_manual := EXISTS (
    SELECT 1 FROM public.entity_alias_suggestions
    WHERE status = 'pending' AND auto_method IS NULL
      AND llm_model IS DISTINCT FROM 'gpt-4.1'
  );

  UPDATE public.entity_canonicalization_state
  SET backlog_remaining = (v_count >= p_batch) OR v_pending_manual
  WHERE id;

  IF v_count = 0 AND NOT v_pending_manual THEN
    RETURN jsonb_build_object('kicked', false, 'reason', 'nothing_unmapped');
  END IF;

  SELECT net.http_post(
    url := v_project_url || '/functions/v1/suggest-entity-canonicalization',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_service_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('variants', v_variants, 'autoQueue', true),
    timeout_milliseconds := 300000
  ) INTO v_request_id;

  RETURN jsonb_build_object('kicked', true, 'variants', v_count, 'pending_manual', v_pending_manual, 'request_id', v_request_id);
END;
$function$;
