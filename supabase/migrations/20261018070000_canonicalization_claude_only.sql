-- Canonicalization runs on Claude Haiku 5.5 for both passes, no OpenAI
-- (Karim, 2026-10-18). Review decisions are labelled 'claude-haiku-5-5/review'
-- so first-pass rows (also Haiku) whose review failed are picked up again;
-- decisions labelled with either review label are final.
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
      AND (llm_model IS NULL OR llm_model NOT IN ('gpt-4.1', 'claude-haiku-5-5/review'))
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
