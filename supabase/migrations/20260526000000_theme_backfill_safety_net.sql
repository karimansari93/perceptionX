-- Architectural fix for the chronic "responses without themes" gap.
--
-- The per-response trigger in analyze-response is fire-and-forget
-- (supabase.functions.invoke(...).catch(log)), so any failure of the
-- ai-thematic-analysis function — OpenAI rate limit, function cold-start
-- timeout, JSON parse failure, transient network blip — silently leaves
-- the response with no themes forever. As of 2026-05-26 ~7,000 responses
-- across many companies (Netflix PH at 77%, Ford at 12-40% per country)
-- are missing themes because of this.
--
-- This migration introduces a safety-net cron that finds those responses
-- and re-themes them via ai-thematic-analysis-bulk:
--
--   pg_cron (every 5 min)
--     -> public.theme_backfill_tick()        [this file]
--        -> net.http_post                    [pg_net]
--           -> /functions/v1/theme-backfill-tick  [edge function]
--              -> public.find_responses_missing_themes()  [this file]
--              -> /functions/v1/ai-thematic-analysis-bulk
--
-- Most ticks will be no-ops once the historical backlog drains. The
-- ai-thematic-analysis-bulk function already skips responses that already
-- have themes, so racing with the real-time trigger is safe.

-- 1. Picker function used by the edge function. RPC instead of PostgREST
--    so the planner can use NOT EXISTS + idx_ai_themes_response_id for the
--    anti-join (PostgREST has no native NOT EXISTS).
CREATE OR REPLACE FUNCTION public.find_responses_missing_themes(
    p_limit int DEFAULT 100,
    p_days  int DEFAULT 90
)
RETURNS TABLE (id uuid, company_id uuid, response_text text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT pr.id, pr.company_id, pr.response_text
    FROM public.prompt_responses pr
    WHERE pr.tested_at >= now() - (p_days || ' days')::interval
      AND pr.response_text IS NOT NULL
      AND length(pr.response_text) > 100
      AND COALESCE(pr.for_index, false) = false
      AND NOT EXISTS (
          SELECT 1 FROM public.ai_themes t WHERE t.response_id = pr.id
      )
    ORDER BY pr.tested_at DESC
    LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.find_responses_missing_themes(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_responses_missing_themes(int, int) TO service_role;

-- 2. Cron-side tick: fires the edge function via pg_net. Mirrors the
--    recency_rescore_tick / visibility_queue_watchdog_tick pattern so
--    secrets stay in the vault rather than embedded in cron command text.
CREATE OR REPLACE FUNCTION public.theme_backfill_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_project_url TEXT;
    v_service_key TEXT;
BEGIN
    SELECT decrypted_secret INTO v_project_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url';
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

    IF v_project_url IS NULL OR v_service_key IS NULL THEN
        RAISE NOTICE 'theme_backfill_tick: missing vault secrets, skipping';
        RETURN jsonb_build_object('kicked', false, 'reason', 'missing_vault_secret');
    END IF;

    PERFORM net.http_post(
        url := v_project_url || '/functions/v1/theme-backfill-tick',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || v_service_key,
            'Content-Type',  'application/json'
        ),
        body := '{}'::jsonb
    );

    RETURN jsonb_build_object('kicked', true);
END;
$$;

-- 3. Schedule. Every 5 min. Real-time gap window = at most 5 min in steady
--    state; historical backlog drains at ~100 responses / tick = ~1200/hr
--    = ~6 hr to clear the current ~7k backlog. Tunable by changing the
--    MAX_RESPONSES_PER_TICK constant in the edge function.
DO $$
BEGIN
    -- Unschedule any previous version so re-applying this migration is safe.
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'theme-backfill-tick';

    PERFORM cron.schedule(
        'theme-backfill-tick',
        '*/5 * * * *',
        $cron$SELECT public.theme_backfill_tick();$cron$
    );
END
$$;
