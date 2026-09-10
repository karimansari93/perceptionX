-- PepsiCo Sep-2026: supersede the Scrapingdog AI Mode wave and the 6 stored
-- AI Overview failures so both can be re-collected like-for-like.
--
-- Why: the July baseline's AI Mode answers were collected through SerpAPI.
-- September's ran through Scrapingdog, which (measured 2026-09-10 on the same
-- 12 prompts, same day) captures ~half the references and ~40% of the distinct
-- source domains SerpAPI does. The comparison is provider-confounded; the fix
-- is to re-collect September's 156 AI Mode answers through SerpAPI. The six
-- AI Overview rows are provider failure strings, not answers (see
-- 20260910120000_prompt_response_failures.sql).
--
-- Nothing is discarded: full copies of the response rows and their dependent
-- ai_themes / competitor_themes rows (both cascade on delete) are kept in
-- *_superseded tables, and the six failures land in prompt_response_failures
-- with their original ids. The per-month unique index then admits the fresh
-- rows.

CREATE TABLE IF NOT EXISTS public.prompt_responses_superseded AS
  SELECT r.*, ''::text AS superseded_reason, now() AS superseded_at
  FROM public.prompt_responses r WHERE false;
CREATE TABLE IF NOT EXISTS public.ai_themes_superseded AS
  SELECT t.*, now() AS superseded_at FROM public.ai_themes t WHERE false;
CREATE TABLE IF NOT EXISTS public.competitor_themes_superseded AS
  SELECT t.*, now() AS superseded_at FROM public.competitor_themes t WHERE false;
ALTER TABLE public.prompt_responses_superseded ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_themes_superseded ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_themes_superseded ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_company constant uuid := '19a134db-bdd1-466f-ba15-0f825a06e748';
  v_failed  constant uuid[] := ARRAY[
    'b61277e8-47a6-4ff0-bce0-debbff09d5f4','d2d5ea2f-6248-4750-8e94-f711db3e1f9e',
    '3804aaa8-0098-4322-a064-ec98157792da','ee659cae-9310-485a-b707-3dc22fdd9eb6',
    '8515d7d1-bf5d-45de-bc0a-b00557a29577','d19ce6b3-f23d-4058-8376-b4e43947c086'];
  v_ids uuid[];
  n_resp int; n_themes int; n_comp int; n_fail int;
BEGIN
  -- 1) The September AI Mode wave (Scrapingdog) — superseded by the SerpAPI re-collection.
  SELECT array_agg(id) INTO v_ids FROM public.prompt_responses
   WHERE company_id = v_company AND ai_model = 'google-ai-mode' AND response_month = DATE '2026-09-01';
  IF coalesce(array_length(v_ids, 1), 0) <> 156 THEN
    RAISE EXCEPTION 'expected 156 Sep-2026 AI Mode rows for PepsiCo, found %', coalesce(array_length(v_ids, 1), 0);
  END IF;

  INSERT INTO public.prompt_responses_superseded
    SELECT r.*, 'sep-2026 ai-mode via scrapingdog; re-collected via serpapi for like-for-like with july baseline', now()
    FROM public.prompt_responses r WHERE r.id = ANY (v_ids);
  INSERT INTO public.ai_themes_superseded SELECT t.*, now() FROM public.ai_themes t WHERE t.response_id = ANY (v_ids);
  INSERT INTO public.competitor_themes_superseded SELECT t.*, now() FROM public.competitor_themes t WHERE t.response_id = ANY (v_ids);
  GET DIAGNOSTICS n_comp = ROW_COUNT;
  SELECT count(*) INTO n_themes FROM public.ai_themes_superseded WHERE response_id = ANY (v_ids);

  -- 2) The six stored AI Overview failures → failures table, original ids kept.
  INSERT INTO public.prompt_response_failures (company_id, confirmed_prompt_id, ai_model, error_text, collection_cycle, source_response_id, created_at)
    SELECT r.company_id, r.confirmed_prompt_id, r.ai_model, r.response_text, r.response_month, r.id, r.created_at
    FROM public.prompt_responses r WHERE r.id = ANY (v_failed) AND r.company_id = v_company;
  GET DIAGNOSTICS n_fail = ROW_COUNT;
  IF n_fail <> 6 THEN RAISE EXCEPTION 'expected 6 failed AIO rows, matched %', n_fail; END IF;

  -- 3) Remove both sets from prompt_responses (themes cascade; copies are above).
  DELETE FROM public.prompt_responses WHERE id = ANY (v_ids) OR id = ANY (v_failed);
  GET DIAGNOSTICS n_resp = ROW_COUNT;

  RAISE NOTICE 'superseded % responses (% themes, % competitor themes), moved % failures', n_resp, n_themes, n_comp, n_fail;
END $$;
