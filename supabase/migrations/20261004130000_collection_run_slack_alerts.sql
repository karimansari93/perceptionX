-- Clearer Slack alerts for client data collection runs.
--
-- Replaces the per-reset "Batch watchdog: reset stranded jobs" message (routine
-- self-healing, dozens per run, no context) and the bare completed/failed
-- message with four run-level alerts:
--   1. run_started      once, when the first job of a run is picked up
--   2. run_progress     every 2 hours while the run is in flight
--   3. run_job_failed   when a job gives up after its retries
--      provider_issue   when AI Overviews is rate-limited 100+ times in an hour
--   4. run_finished     once, with per-model completeness
--
-- All alerts go through the existing send_batch_alert() -> send-batch-alert
-- edge function -> BATCH_ALERTS_SLACK_WEBHOOK pipeline. The Visibility Index
-- queue's own watchdog/completion alerts are untouched.

-- ----------------------------------------------------------------------------
-- Alert state
-- ----------------------------------------------------------------------------
ALTER TABLE public.company_batch_configs
  ADD COLUMN IF NOT EXISTS alerted_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS alerted_progress_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS alerted_provider_issue_at TIMESTAMPTZ;

ALTER TABLE public.company_batch_queue
  ADD COLUMN IF NOT EXISTS alerted_failed_at TIMESTAMPTZ;

-- Runs that already exist were announced (or not) under the old scheme; don't
-- send them a late "started" alert, and don't re-alert jobs that already failed.
UPDATE public.company_batch_configs SET alerted_started_at = NOW()
WHERE alerted_started_at IS NULL;

UPDATE public.company_batch_queue SET alerted_failed_at = NOW()
WHERE status = 'failed' AND alerted_failed_at IS NULL;

-- ----------------------------------------------------------------------------
-- Display helpers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.collection_model_label(p_model text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_model
    WHEN 'openai' THEN 'ChatGPT'
    WHEN 'perplexity' THEN 'Perplexity'
    WHEN 'google-ai-mode' THEN 'AI Mode'
    WHEN 'google-ai-overviews' THEN 'AI Overviews'
    WHEN 'claude' THEN 'Claude'
    WHEN 'gemini' THEN 'Gemini'
    WHEN 'deepseek' THEN 'DeepSeek'
    ELSE p_model
  END;
$$;

CREATE OR REPLACE FUNCTION public.collection_fmt_int(p_n numeric)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$ SELECT to_char(COALESCE(p_n, 0), 'FM999,999,999,990'); $$;

-- ----------------------------------------------------------------------------
-- collection_run_summary(config_id, issues_since)
--   Everything an alert needs about one run, as jsonb. Read-only.
--   Collection window: the run's skip_if_collected_in_month (YYYY-MM) when
--   set, else from the run's creation onwards.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.collection_run_summary(
  p_config_id uuid,
  p_issues_since timestamptz DEFAULT NOW() - INTERVAL '2 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_cfg public.company_batch_configs;
  v_org_name text;
  v_models text[];
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_started_at timestamptz;
  v_result jsonb;
BEGIN
  SELECT * INTO v_cfg FROM public.company_batch_configs WHERE id = p_config_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT name INTO v_org_name FROM public.organizations
  WHERE id = COALESCE(v_cfg.organization_id, v_cfg.created_org_id);

  -- Mirrors DEFAULT_MODELS in process-company-batch-queue.
  v_models := COALESCE(v_cfg.models,
    ARRAY['openai', 'perplexity', 'google-ai-overviews', 'google-ai-mode', 'claude']);

  IF v_cfg.skip_if_collected_in_month ~ '^\d{4}-\d{2}$' THEN
    v_window_start := (v_cfg.skip_if_collected_in_month || '-01')::date::timestamptz;
    v_window_end := v_window_start + INTERVAL '1 month';
  ELSE
    v_window_start := v_cfg.created_at;
    v_window_end := 'infinity'::timestamptz;
  END IF;

  SELECT MIN(created_at) INTO v_started_at
  FROM public.company_batch_queue WHERE config_id = p_config_id;

  WITH companies AS (
    SELECT DISTINCT company_id FROM public.company_batch_queue
    WHERE config_id = p_config_id AND company_id IS NOT NULL
  ),
  prompts AS (
    SELECT cp.id FROM public.confirmed_prompts cp
    WHERE cp.is_active AND cp.company_id IN (SELECT company_id FROM companies)
  ),
  answered AS (
    SELECT pr.confirmed_prompt_id, pr.ai_model, MIN(pr.created_at) AS first_at
    FROM public.prompt_responses pr
    WHERE pr.confirmed_prompt_id IN (SELECT id FROM prompts)
      AND pr.ai_model = ANY (v_models)
      AND pr.created_at >= v_window_start AND pr.created_at < v_window_end
    GROUP BY 1, 2
  ),
  no_overview AS (
    -- Google showed no AI Overview for the search: expected, not a gap.
    SELECT COUNT(DISTINCT f.confirmed_prompt_id) AS n
    FROM public.prompt_response_failures f
    WHERE f.ai_model = 'google-ai-overviews'
      AND f.confirmed_prompt_id IN (SELECT id FROM prompts)
      AND f.created_at >= v_window_start AND f.created_at < v_window_end
      AND f.error_text ILIKE 'No AI overview%'
      AND NOT EXISTS (SELECT 1 FROM answered a
                      WHERE a.confirmed_prompt_id = f.confirmed_prompt_id
                        AND a.ai_model = 'google-ai-overviews')
  ),
  per_model AS (
    SELECT m.model, m.ord,
           (SELECT COUNT(*) FROM answered a WHERE a.ai_model = m.model) AS done,
           (SELECT COUNT(*) FROM answered a WHERE a.ai_model = m.model
              AND a.first_at >= v_started_at) AS new_in_run
    FROM unnest(v_models) WITH ORDINALITY AS m(model, ord)
  ),
  jobs AS (
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status = 'processing') AS processing,
      COUNT(*) FILTER (WHERE status = 'pending') AS pending,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      COUNT(*) FILTER (WHERE is_cancelled) AS cancelled,
      MAX(updated_at) AS last_activity
    FROM public.company_batch_queue WHERE config_id = p_config_id
  ),
  restarts AS (
    -- The watchdog appends "watchdog reset at <timestamp>" to error_log.
    SELECT COUNT(*) AS n
    FROM public.company_batch_queue q,
         LATERAL regexp_matches(COALESCE(q.error_log, ''),
           'watchdog reset at (\d{4}-\d{2}-\d{2} [0-9:.]+[+-]\d{2})', 'g') AS m(ts)
    WHERE q.config_id = p_config_id
      AND (m.ts[1])::timestamptz >= p_issues_since
  ),
  issues AS (
    SELECT
      COUNT(*) FILTER (WHERE f.ai_model = 'google-ai-overviews'
                         AND f.error_text ILIKE '%too many requests%') AS aio_rate_limited,
      COUNT(*) FILTER (WHERE NOT (f.ai_model = 'google-ai-overviews'
                                  AND f.error_text ILIKE 'No AI overview%')) AS failed_calls
    FROM public.prompt_response_failures f
    WHERE f.company_id IN (SELECT company_id FROM companies)
      AND f.created_at >= p_issues_since
  )
  SELECT jsonb_build_object(
    'config_id', v_cfg.id,
    'org_name', COALESCE(v_org_name, v_cfg.new_org_name, 'Unknown client'),
    'run_name', v_cfg.company_name,
    'month', v_cfg.skip_if_collected_in_month,
    'models', to_jsonb(v_models),
    'companies', (SELECT COUNT(*) FROM companies),
    'prompts', (SELECT COUNT(*) FROM prompts),
    'started_at', v_started_at,
    'per_model', (SELECT jsonb_agg(jsonb_build_object(
                    'model', model, 'label', public.collection_model_label(model),
                    'done', done, 'new_in_run', new_in_run) ORDER BY ord)
                  FROM per_model),
    'aio_no_overview', (SELECT n FROM no_overview),
    'jobs', (SELECT to_jsonb(j) FROM jobs j),
    'failed_jobs', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                      'company', q.company_name, 'job_id', q.id,
                      'progress', q.batch_index, 'total', q.total_prompts,
                      'error', left(regexp_replace(COALESCE(q.error_log, ''),
                                 ' \| watchdog reset at [^|]+', '', 'g'), 200),
                      'alerted', q.alerted_failed_at IS NOT NULL)
                      ORDER BY q.updated_at), '[]'::jsonb)
                    FROM public.company_batch_queue q
                    WHERE q.config_id = p_config_id AND q.status = 'failed'),
    'issues', (SELECT jsonb_build_object(
                 'since', p_issues_since,
                 'aio_rate_limited', i.aio_rate_limited,
                 'failed_calls', i.failed_calls,
                 'restarts', (SELECT n FROM restarts))
               FROM issues i)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.collection_run_summary IS
'Read-only summary of one company_batch_configs run (per-model completeness, jobs, failures, issues since p_issues_since) for Slack alerts.';

-- ----------------------------------------------------------------------------
-- collection_run_message(summary, kind) -> send_batch_alert payload
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.collection_run_message(p_summary jsonb, p_kind text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_title_prefix text := (p_summary->>'org_name') || ': ' || (p_summary->>'run_name');
  v_prompts numeric := (p_summary->>'prompts')::numeric;
  v_models_text text;
  v_lines text[] := ARRAY[]::text[];
  v_cover text;
  v_total_slots numeric := 0;
  v_done_slots numeric := 0;
  v_new_slots numeric := 0;
  v_remaining numeric;
  v_elapsed_h numeric;
  v_eta text := 'calculating';
  v_pct numeric;
  v_jobs jsonb := p_summary->'jobs';
  v_issues jsonb := p_summary->'issues';
  v_issue_line text;
  v_failed text;
  v_m jsonb;
  v_duration interval;
BEGIN
  SELECT string_agg(public.collection_model_label(m), ', ')
  INTO v_models_text
  FROM jsonb_array_elements_text(p_summary->'models') AS m;

  -- Per-model completeness line, e.g. "ChatGPT 6,398 of 7,004 (91%)".
  SELECT string_agg(
           format('%s %s of %s (%s%%)',
             e->>'label',
             public.collection_fmt_int((e->>'done')::numeric),
             public.collection_fmt_int(v_prompts),
             CASE WHEN v_prompts > 0
                  THEN round(100.0 * (e->>'done')::numeric / v_prompts)
                  ELSE 0 END),
           ' · ')
  INTO v_cover
  FROM jsonb_array_elements(p_summary->'per_model') AS e;

  FOR v_m IN SELECT * FROM jsonb_array_elements(p_summary->'per_model') LOOP
    v_total_slots := v_total_slots + v_prompts;
    v_done_slots := v_done_slots + (v_m->>'done')::numeric;
    v_new_slots := v_new_slots + (v_m->>'new_in_run')::numeric;
  END LOOP;
  v_remaining := GREATEST(v_total_slots - v_done_slots
                          - COALESCE((p_summary->>'aio_no_overview')::numeric, 0), 0);
  v_pct := CASE WHEN v_total_slots > 0 THEN round(100.0 * v_done_slots / v_total_slots) ELSE 0 END;

  v_elapsed_h := EXTRACT(EPOCH FROM (NOW() - (p_summary->>'started_at')::timestamptz)) / 3600.0;
  IF v_elapsed_h >= 0.25 AND v_new_slots > 0 THEN
    v_eta := to_char((NOW() + make_interval(secs => (v_remaining / (v_new_slots / v_elapsed_h)) * 3600))
                     AT TIME ZONE 'UTC',
                     CASE WHEN v_remaining / (v_new_slots / v_elapsed_h) > 18
                          THEN 'Dy DD Mon HH24:MI "UTC"' ELSE 'HH24:MI "UTC"' END);
  END IF;
  IF v_remaining = 0 THEN
    v_eta := 'any minute';
  END IF;

  v_issue_line := format('AI Overviews rate-limited %s times · %s other failed calls · %s jobs restarted automatically',
    public.collection_fmt_int((v_issues->>'aio_rate_limited')::numeric),
    public.collection_fmt_int((v_issues->>'failed_calls')::numeric),
    public.collection_fmt_int((v_issues->>'restarts')::numeric));

  IF p_kind = 'run_started' THEN
    v_lines := ARRAY[
      format('%s companies · %s prompts · %s',
        public.collection_fmt_int((p_summary->>'companies')::numeric),
        public.collection_fmt_int(v_prompts), v_models_text),
      CASE WHEN p_summary->>'month' ~ '^\d{4}-\d{2}$'
           THEN format('Only prompts with no answer in %s will run. Already collected: %s.',
                  to_char((p_summary->>'month' || '-01')::date, 'FMMonth YYYY'), v_cover)
           ELSE 'Collecting every active prompt.' END
    ];
    RETURN jsonb_build_object('event', 'run_started',
      'title', '🚀 ' || v_title_prefix || ' started',
      'text', array_to_string(v_lines, E'\n'));

  ELSIF p_kind = 'run_progress' THEN
    v_lines := ARRAY[
      v_cover,
      format('%s of %s jobs done · %s running · %s waiting · %s failed · Estimated finish: %s',
        v_jobs->>'completed', v_jobs->>'total', v_jobs->>'processing',
        v_jobs->>'pending', v_jobs->>'failed', v_eta),
      'Last 2 hours: ' || v_issue_line
    ];
    RETURN jsonb_build_object('event', 'run_progress',
      'title', format('⏳ %s, %s%% done', v_title_prefix, v_pct),
      'text', array_to_string(v_lines, E'\n'));

  ELSIF p_kind = 'run_job_failed' THEN
    SELECT string_agg(
             format('• *%s* stopped at %s of %s prompts. Last error: %s',
               f->>'company', COALESCE(f->>'progress', '?'), COALESCE(f->>'total', '?'),
               COALESCE(NULLIF(trim(f->>'error'), ''), 'none recorded')),
             E'\n')
    INTO v_failed
    FROM jsonb_array_elements(p_summary->'failed_jobs') AS f
    WHERE NOT (f->>'alerted')::boolean;
    v_lines := ARRAY[
      COALESCE(v_failed, ''),
      'These jobs gave up after 3 attempts. Answers already collected are kept.',
      'To fill the gaps, re-run the month from Admin → Recollect once the run ends.'
    ];
    RETURN jsonb_build_object('event', 'run_job_failed',
      'title', '🔴 ' || v_title_prefix || ': job failed and won''t retry',
      'text', array_to_string(v_lines, E'\n'));

  ELSIF p_kind = 'provider_issue' THEN
    v_lines := ARRAY[
      format('Scrapingdog rate-limited AI Overviews %s times in the last hour.',
        public.collection_fmt_int((v_issues->>'aio_rate_limited')::numeric)),
      'Collection keeps going and retries with longer waits, but some prompts will be left without an AI Overview.',
      'Check the Scrapingdog plan''s concurrency, or run fewer jobs at once.'
    ];
    RETURN jsonb_build_object('event', 'provider_issue',
      'title', '🟠 ' || v_title_prefix || ': AI Overviews being rate-limited',
      'text', array_to_string(v_lines, E'\n'));

  ELSIF p_kind = 'run_finished' THEN
    v_duration := COALESCE((v_jobs->>'last_activity')::timestamptz, NOW())
                  - (p_summary->>'started_at')::timestamptz;
    v_lines := ARRAY[
      v_cover,
      CASE WHEN COALESCE((p_summary->>'aio_no_overview')::numeric, 0) > 0
           THEN format('AI Overviews: Google showed no overview for %s prompts, which is normal and not a gap.',
                  public.collection_fmt_int((p_summary->>'aio_no_overview')::numeric))
      END,
      format('Took %s · %s of %s jobs completed · %s failed%s',
        CASE WHEN v_duration >= INTERVAL '1 hour'
             THEN format('%sh %sm', floor(EXTRACT(EPOCH FROM v_duration) / 3600),
                         floor(mod(EXTRACT(EPOCH FROM v_duration)::numeric, 3600) / 60))
             ELSE format('%sm', ceil(EXTRACT(EPOCH FROM v_duration) / 60)) END,
        v_jobs->>'completed', v_jobs->>'total', v_jobs->>'failed',
        CASE WHEN (v_jobs->>'cancelled')::int > 0
             THEN format(' · %s cancelled', v_jobs->>'cancelled') ELSE '' END),
      CASE WHEN (v_jobs->>'failed')::int > 0
           THEN 'Some jobs failed, so there are gaps. Re-run the month from Admin → Recollect to fill them.'
      END
    ];
    RETURN jsonb_build_object('event', 'run_finished',
      'title', CASE WHEN (v_jobs->>'failed')::int > 0
                    THEN '⚠️ ' || v_title_prefix || ' finished with gaps'
                    ELSE '✅ ' || v_title_prefix || ' complete' END,
      'text', array_to_string(v_lines, E'\n'));
  END IF;

  RETURN NULL;
END;
$$;

-- ----------------------------------------------------------------------------
-- collection_alerts_tick(): decides which alerts are due and sends them.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.collection_alerts_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_run RECORD;
  v_summary jsonb;
  v_sent integer := 0;
  v_rate_limited integer;
BEGIN
  FOR v_run IN
    SELECT cfg.id, cfg.alerted_started_at, cfg.alerted_progress_at,
           cfg.alerted_provider_issue_at,
           MIN(q.created_at) AS started_at,
           COUNT(*) FILTER (WHERE q.status IN ('pending', 'processing')
                              AND NOT COALESCE(q.is_cancelled, false)) AS in_flight,
           COUNT(*) FILTER (WHERE q.status <> 'pending') AS picked_up,
           COUNT(*) FILTER (WHERE q.status = 'failed' AND q.alerted_failed_at IS NULL) AS new_failed
    FROM public.company_batch_configs cfg
    JOIN public.company_batch_queue q ON q.config_id = cfg.id
    WHERE cfg.alerted_final_at IS NULL
    GROUP BY cfg.id
    ORDER BY MIN(q.created_at)
    LIMIT 20
  LOOP
    v_summary := NULL;

    -- 1. Started: once the first job has been picked up.
    IF v_run.alerted_started_at IS NULL AND v_run.picked_up > 0 THEN
      v_summary := public.collection_run_summary(v_run.id);
      PERFORM public.send_batch_alert(public.collection_run_message(v_summary, 'run_started'));
      UPDATE public.company_batch_configs SET alerted_started_at = NOW() WHERE id = v_run.id;
      v_sent := v_sent + 1;
    END IF;

    -- 3a. Jobs that gave up after their retries.
    IF v_run.new_failed > 0 THEN
      v_summary := public.collection_run_summary(v_run.id);
      PERFORM public.send_batch_alert(public.collection_run_message(v_summary, 'run_job_failed'));
      UPDATE public.company_batch_queue SET alerted_failed_at = NOW()
      WHERE config_id = v_run.id AND status = 'failed' AND alerted_failed_at IS NULL;
      v_sent := v_sent + 1;
    END IF;

    IF v_run.in_flight = 0 THEN
      -- 4. Finished.
      v_summary := public.collection_run_summary(v_run.id);
      PERFORM public.send_batch_alert(public.collection_run_message(v_summary, 'run_finished'));
      UPDATE public.company_batch_configs SET alerted_final_at = NOW() WHERE id = v_run.id;
      v_sent := v_sent + 1;
      CONTINUE;
    END IF;

    -- 3b. Provider trouble: AI Overviews rate-limited 100+ times in the last
    -- hour for this run's companies, at most one alert an hour.
    IF v_run.alerted_provider_issue_at IS NULL
       OR v_run.alerted_provider_issue_at < NOW() - INTERVAL '1 hour' THEN
      SELECT COUNT(*) INTO v_rate_limited
      FROM public.prompt_response_failures f
      WHERE f.ai_model = 'google-ai-overviews'
        AND f.created_at >= NOW() - INTERVAL '1 hour'
        AND f.error_text ILIKE '%too many requests%'
        AND f.company_id IN (SELECT company_id FROM public.company_batch_queue
                             WHERE config_id = v_run.id);
      IF v_rate_limited >= 100 THEN
        v_summary := public.collection_run_summary(v_run.id, NOW() - INTERVAL '1 hour');
        PERFORM public.send_batch_alert(public.collection_run_message(v_summary, 'provider_issue'));
        UPDATE public.company_batch_configs SET alerted_provider_issue_at = NOW() WHERE id = v_run.id;
        v_sent := v_sent + 1;
      END IF;
    END IF;

    -- 2. Progress every 2 hours, first one 2 hours after the run started.
    IF COALESCE(v_run.alerted_progress_at, v_run.started_at) < NOW() - INTERVAL '2 hours' THEN
      v_summary := public.collection_run_summary(v_run.id, NOW() - INTERVAL '2 hours');
      PERFORM public.send_batch_alert(public.collection_run_message(v_summary, 'run_progress'));
      UPDATE public.company_batch_configs SET alerted_progress_at = NOW() WHERE id = v_run.id;
      v_sent := v_sent + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('alerts_sent', v_sent);
END;
$$;

COMMENT ON FUNCTION public.collection_alerts_tick IS
'Run-level Slack alerts for company_batch_configs: started, progress every 2h, failed jobs, AI Overviews rate-limiting, finished. Called by the batch-queue-completion-sweep cron via batch_queue_completion_tick().';

-- The existing cron job (batch-queue-completion-sweep, every 2 minutes) calls
-- batch_queue_completion_tick(); route it to the new alerts.
CREATE OR REPLACE FUNCTION public.batch_queue_completion_tick()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$ SELECT public.collection_alerts_tick(); $$;

-- ----------------------------------------------------------------------------
-- Watchdog: same self-healing as before (20260602000000), minus the Slack
-- message on every reset. Resets now show up as "jobs restarted
-- automatically" in the progress alert.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.batch_queue_watchdog_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
    v_project_url TEXT;
    v_service_key TEXT;
    v_stranded_count integer;
    v_reset_count integer;
    v_config_ids uuid[];
    v_config_id uuid;
    v_by_company jsonb;
BEGIN
    SELECT decrypted_secret INTO v_project_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url';
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

    SELECT COUNT(*)
    INTO v_stranded_count
    FROM public.company_batch_queue
    WHERE status IN ('pending', 'processing')
      AND (is_cancelled IS NULL OR is_cancelled = false)
      AND updated_at < NOW() - INTERVAL '5 minutes'
      AND COALESCE(retry_count, 0) < 3;

    IF v_stranded_count = 0 THEN
        RETURN jsonb_build_object('stranded', 0, 'reset', 0);
    END IF;

    WITH updated AS (
        UPDATE public.company_batch_queue
        SET status = 'pending',
            retry_count = COALESCE(retry_count, 0) + 1,
            error_log = COALESCE(error_log, '') ||
                        ' | watchdog reset at ' || NOW()::text,
            updated_at = NOW()
        WHERE status IN ('pending', 'processing')
          AND (is_cancelled IS NULL OR is_cancelled = false)
          AND updated_at < NOW() - INTERVAL '5 minutes'
          AND COALESCE(retry_count, 0) < 3
        RETURNING id, config_id, company_name, job_function
    ),
    by_company AS (
        SELECT COALESCE(company_name, '(unknown)') AS company_name, COUNT(*) AS cnt
        FROM updated
        GROUP BY COALESCE(company_name, '(unknown)')
    )
    SELECT
        (SELECT COUNT(*) FROM updated),
        (SELECT array_agg(DISTINCT config_id) FROM updated),
        (SELECT jsonb_object_agg(company_name, cnt) FROM by_company)
    INTO v_reset_count, v_config_ids, v_by_company;

    IF v_project_url IS NOT NULL AND v_service_key IS NOT NULL THEN
        FOREACH v_config_id IN ARRAY v_config_ids
        LOOP
            PERFORM net.http_post(
                url := v_project_url || '/functions/v1/process-company-batch-queue',
                headers := jsonb_build_object(
                    'Authorization', 'Bearer ' || v_service_key,
                    'Content-Type', 'application/json'
                ),
                body := jsonb_build_object('configId', v_config_id)
            );
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'stranded', v_stranded_count,
        'reset', v_reset_count,
        'configs_kicked', COALESCE(array_length(v_config_ids, 1), 0),
        'by_company', v_by_company
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.collection_run_summary(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.collection_run_message(jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.collection_alerts_tick() TO service_role;
