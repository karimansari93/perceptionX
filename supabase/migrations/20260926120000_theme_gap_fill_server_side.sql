-- Analyze themes runs on the server, not in the admin's browser tab.
--
-- The admin panel used to page responses into the browser and call
-- ai-thematic-analysis-bulk chunk by chunk, so closing the tab stopped it.
-- Now the panel queues a request; theme_gap_tick (pg_cron, every minute while
-- a request is open) sends up to 40 un-themed responses per call straight to
-- ai-thematic-analysis-bulk via pg_net until the gaps are filled.
--
-- Eligible responses match find_responses_missing_themes: company mentioned,
-- over 100 characters, not index rows, no themes yet. A response is not
-- re-sent while a call for it is in flight (5 minutes) and is given up after
-- 3 attempts (some answers genuinely yield no themes, and nothing stamps
-- themes_none_found_at any more).

CREATE TABLE IF NOT EXISTS public.theme_gap_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_ids uuid[] NOT NULL,
  response_month date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'cancelled')),
  sent_count int NOT NULL DEFAULT 0,
  requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  last_error text
);

CREATE TABLE IF NOT EXISTS public.theme_gap_sent (
  response_id uuid PRIMARY KEY,
  request_id uuid REFERENCES public.theme_gap_requests(id) ON DELETE CASCADE,
  attempts int NOT NULL DEFAULT 0,
  last_sent_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.theme_gap_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.theme_gap_sent ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS theme_gap_requests_admin_read ON public.theme_gap_requests;
CREATE POLICY theme_gap_requests_admin_read ON public.theme_gap_requests FOR SELECT USING (public.is_admin());
REVOKE ALL ON public.theme_gap_requests, public.theme_gap_sent FROM anon;

-- Responses of a request still needing themes. p_skip_blocked leaves out those
-- in flight or given up, which is what the tick sends; without it, it counts
-- what is still outstanding.
CREATE OR REPLACE FUNCTION public._theme_gap_candidates(p_request_id uuid, p_skip_blocked boolean, p_limit int)
RETURNS TABLE (id uuid, company_id uuid, response_text text)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT pr.id, pr.company_id, pr.response_text
  FROM theme_gap_requests r
  JOIN prompt_responses pr ON pr.company_id = ANY (r.company_ids)
  WHERE r.id = p_request_id
    AND (r.response_month IS NULL OR pr.response_month = r.response_month)
    AND pr.response_text IS NOT NULL
    AND length(pr.response_text) > 100
    AND COALESCE(pr.for_index, false) = false
    AND COALESCE(pr.company_mentioned, false) = true
    AND pr.themes_none_found_at IS NULL
    AND pr.themes_found_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM ai_themes t WHERE t.response_id = pr.id)
    AND (NOT p_skip_blocked OR NOT EXISTS (
      SELECT 1 FROM theme_gap_sent s
      WHERE s.response_id = pr.id
        AND (s.attempts >= 3 OR s.last_sent_at > now() - interval '5 minutes')))
  ORDER BY pr.company_id, pr.id
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public._theme_gap_candidates(uuid, boolean, int) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_theme_gap_fill(p_org uuid, p_company_ids uuid[], p_month date DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE insufficient_privilege USING MESSAGE = 'request_theme_gap_fill is admin-only';
  END IF;
  IF p_company_ids IS NULL OR cardinality(p_company_ids) = 0 THEN
    RAISE EXCEPTION 'select at least one company';
  END IF;
  -- Only companies that belong to the org.
  IF EXISTS (
    SELECT 1 FROM unnest(p_company_ids) cid
    WHERE NOT EXISTS (SELECT 1 FROM organization_companies oc WHERE oc.organization_id = p_org AND oc.company_id = cid)
  ) THEN
    RAISE EXCEPTION 'every company must belong to this organization';
  END IF;

  INSERT INTO theme_gap_requests (organization_id, company_ids, response_month, requested_by)
  VALUES (p_org, p_company_ids, date_trunc('month', p_month)::date, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_theme_gap_fill(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE insufficient_privilege USING MESSAGE = 'cancel_theme_gap_fill is admin-only';
  END IF;
  UPDATE theme_gap_requests
  SET status = 'cancelled', finished_at = now(), updated_at = now()
  WHERE id = p_request_id AND status IN ('pending', 'running');
END;
$$;

-- The org's requests from the last 7 days with what is still outstanding.
CREATE OR REPLACE FUNCTION public.get_theme_gap_requests(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE insufficient_privilege USING MESSAGE = 'get_theme_gap_requests is admin-only';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', r.id,
      'company_ids', r.company_ids,
      'response_month', r.response_month,
      'status', r.status,
      'sent_count', r.sent_count,
      'created_at', r.created_at,
      'finished_at', r.finished_at,
      'last_error', r.last_error,
      'remaining', CASE WHEN r.status IN ('pending', 'running')
        THEN (SELECT count(*) FROM public._theme_gap_candidates(r.id, false, 100000)) END
    ) ORDER BY r.created_at DESC)
    FROM theme_gap_requests r
    WHERE r.organization_id = p_org
      AND r.created_at > now() - interval '7 days'
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.request_theme_gap_fill(uuid, uuid[], date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_theme_gap_fill(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_theme_gap_requests(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_theme_gap_fill(uuid, uuid[], date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_theme_gap_fill(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_theme_gap_requests(uuid) TO authenticated;

-- One call per open request per tick (up to 3 requests), 40 responses from a
-- single company per call (the bulk function prompts with one company name).
CREATE OR REPLACE FUNCTION public.theme_gap_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  c_chunk constant int := 40;
  v_url text;
  v_key text;
  v_req record;
  v_company uuid;
  v_name text;
  v_payload jsonb;
  v_ids uuid[];
  v_sent int := 0;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_url';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RETURN jsonb_build_object('sent', 0, 'reason', 'missing_vault_secret');
  END IF;

  FOR v_req IN
    SELECT * FROM theme_gap_requests
    WHERE status IN ('pending', 'running')
    ORDER BY created_at
    LIMIT 3
  LOOP
    v_company := NULL;
    SELECT c.company_id INTO v_company
    FROM public._theme_gap_candidates(v_req.id, true, 1) c;

    IF v_company IS NULL THEN
      -- Nothing sendable. Done once nothing is still in flight.
      IF NOT EXISTS (
        SELECT 1 FROM theme_gap_sent s
        WHERE s.request_id = v_req.id AND s.last_sent_at > now() - interval '5 minutes'
      ) THEN
        UPDATE theme_gap_requests
        SET status = 'done', finished_at = now(), updated_at = now()
        WHERE id = v_req.id;
      END IF;
      CONTINUE;
    END IF;

    SELECT name INTO v_name FROM companies WHERE id = v_company;

    WITH pick AS (
      SELECT c.id, c.response_text
      FROM public._theme_gap_candidates(v_req.id, true, 100000) c
      WHERE c.company_id = v_company
      LIMIT c_chunk
    )
    SELECT array_agg(id),
           jsonb_agg(jsonb_build_object('response_id', id, 'response_text', response_text))
    INTO v_ids, v_payload
    FROM pick;

    PERFORM net.http_post(
      url := v_url || '/functions/v1/ai-thematic-analysis-bulk',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object('responses', v_payload, 'company_name', v_name, 'clear_existing', false),
      timeout_milliseconds := 150000
    );

    INSERT INTO theme_gap_sent (response_id, request_id, attempts, last_sent_at)
    SELECT unnest(v_ids), v_req.id, 1, now()
    ON CONFLICT (response_id) DO UPDATE
      SET attempts = theme_gap_sent.attempts + 1, last_sent_at = now(), request_id = EXCLUDED.request_id;

    UPDATE theme_gap_requests
    SET status = 'running', sent_count = sent_count + cardinality(v_ids), updated_at = now()
    WHERE id = v_req.id;

    v_sent := v_sent + cardinality(v_ids);
  END LOOP;

  RETURN jsonb_build_object('sent', v_sent);
END;
$$;

REVOKE ALL ON FUNCTION public.theme_gap_tick() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'theme-gap-tick';
SELECT cron.schedule(
  'theme-gap-tick',
  '* * * * *',
  $cron$SELECT public.theme_gap_tick() WHERE EXISTS (SELECT 1 FROM public.theme_gap_requests WHERE status IN ('pending', 'running'));$cron$
);

NOTIFY pgrst, 'reload schema';
