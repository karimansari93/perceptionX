-- ============================================================================
-- 1. Per-company readiness for the admin org workspace
-- ============================================================================
-- get_analysis_health() is platform-wide and keys on collection_cycle, which
-- most responses since August don't carry. This answers "is THIS company ready
-- for a report?" for its latest response_month (collection_cycle, falling back
-- to the created month), one company per call so large orgs stay well under
-- the 8s authenticated statement timeout (~0.3s for the largest Ford company).
CREATE OR REPLACE FUNCTION public.get_company_readiness(p_company uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_month date;
  v_result jsonb;
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RAISE insufficient_privilege USING MESSAGE = 'get_company_readiness is admin-only';
  END IF;

  SELECT max(pr.response_month) INTO v_month
  FROM prompt_responses pr
  WHERE pr.company_id = p_company AND NOT COALESCE(pr.for_index, false);

  WITH r AS MATERIALIZED (
    SELECT pr.id, pr.citations,
           (COALESCE(pr.company_mentioned, false) AND length(COALESCE(pr.response_text, '')) > 100) AS eligible,
           (pr.themes_found_at IS NOT NULL OR pr.themes_none_found_at IS NOT NULL) AS theme_flag
    FROM prompt_responses pr
    WHERE pr.company_id = p_company
      AND pr.response_month = v_month
      AND NOT COALESCE(pr.for_index, false)
  ), u AS (
    SELECT DISTINCT COALESCE(c->>'url', c->>'link') AS url
    FROM r CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.citations) = 'array' THEN r.citations ELSE '[]'::jsonb END) c
  )
  SELECT jsonb_build_object(
    'company_id', p_company,
    'latest_month', v_month,
    'responses', (SELECT count(*) FROM r),
    'theme_eligible', (SELECT count(*) FROM r WHERE eligible),
    'themed', (SELECT count(*) FROM r WHERE eligible
                 AND (theme_flag OR EXISTS (SELECT 1 FROM ai_themes t WHERE t.response_id = r.id))),
    'urls', (SELECT count(*) FROM u WHERE url LIKE 'http%'),
    'urls_scored', (SELECT count(*) FROM u JOIN url_recency_cache x ON x.url = u.url),
    'active_jobs', (SELECT count(*) FROM company_batch_queue q
                    WHERE q.company_id = p_company
                      AND q.status IN ('pending', 'processing')
                      AND NOT COALESCE(q.is_cancelled, false)),
    'metrics_pending', EXISTS (SELECT 1 FROM company_metrics_dirty d WHERE d.company_id = p_company)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_readiness(uuid) TO authenticated;

-- ============================================================================
-- 2. Recency Coverage list rebuilt in the background
-- ============================================================================
-- The admin "Refresh" button called refresh_organization_recency_coverage()
-- directly. That takes over a minute and the authenticated role has an 8s
-- statement timeout, and each refresh step swallows its own error, so it
-- failed every time while reporting success. The list now rebuilds from
-- pg_cron (no timeout): hourly, and within ~5 minutes of an admin request.
--
-- Requests live in their own row so an admin clicking Refresh never waits on
-- the row the running tick holds locked for the whole (minute-plus) rebuild.
CREATE TABLE IF NOT EXISTS public.recency_coverage_refresh_state (
  id             int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_started   timestamptz,
  last_finished  timestamptz,
  last_error     text
);
INSERT INTO public.recency_coverage_refresh_state (id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE public.recency_coverage_refresh_state ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.recency_coverage_refresh_request (
  id             int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  requested_at   timestamptz
);
INSERT INTO public.recency_coverage_refresh_request (id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE public.recency_coverage_refresh_request ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.recency_coverage_refresh_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  s public.recency_coverage_refresh_state;
  v_requested timestamptz;
  v_errors text;
BEGIN
  SELECT * INTO s FROM public.recency_coverage_refresh_state WHERE id = 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;  -- another tick is already refreshing

  SELECT requested_at INTO v_requested FROM public.recency_coverage_refresh_request WHERE id = 1;

  IF NOT (
    s.last_finished IS NULL
    OR s.last_finished < now() - interval '1 hour'
    OR (v_requested IS NOT NULL AND v_requested > COALESCE(s.last_started, '-infinity'))
  ) THEN
    RETURN;
  END IF;

  UPDATE public.recency_coverage_refresh_state SET last_started = now() WHERE id = 1;

  SELECT string_agg(view_name || ': ' || error_message, '; ')
  INTO v_errors
  FROM public.refresh_organization_recency_coverage()
  WHERE NOT success;

  UPDATE public.recency_coverage_refresh_state
  SET last_finished = now(), last_error = v_errors
  WHERE id = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_recency_coverage_refresh()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RAISE insufficient_privilege USING MESSAGE = 'request_recency_coverage_refresh is admin-only';
  END IF;
  UPDATE public.recency_coverage_refresh_request SET requested_at = now() WHERE id = 1;
  RETURN public.get_recency_coverage_refresh_state();
END;
$$;

CREATE OR REPLACE FUNCTION public.get_recency_coverage_refresh_state()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE WHEN public.is_admin() THEN to_jsonb(s) || jsonb_build_object('requested_at', q.requested_at) END
  FROM public.recency_coverage_refresh_state s, public.recency_coverage_refresh_request q
  WHERE s.id = 1 AND q.id = 1;
$$;

REVOKE ALL ON FUNCTION public.recency_coverage_refresh_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_recency_coverage_refresh() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recency_coverage_refresh_state() TO authenticated;

SELECT cron.schedule(
  'recency-coverage-refresh-tick',
  '*/5 * * * *',
  $cron$SELECT public.recency_coverage_refresh_tick();$cron$
);

NOTIFY pgrst, 'reload schema';
