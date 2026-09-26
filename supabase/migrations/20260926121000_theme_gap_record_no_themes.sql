-- theme_gap_tick: record "No themes identified" results.
--
-- ai-thematic-analysis-bulk answers each response with success and a
-- themes_count; zero means the answer genuinely has no themes. Nothing stamped
-- themes_none_found_at for those, so they looked like gaps forever and were
-- re-sent. The tick now keeps each pg_net request id and, on the next run,
-- stamps themes_none_found_at on responses the bulk call analysed without
-- finding themes (only where no ai_themes row exists).

CREATE TABLE IF NOT EXISTS public.theme_gap_calls (
  net_request_id bigint PRIMARY KEY,
  gap_request_id uuid REFERENCES public.theme_gap_requests(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
ALTER TABLE public.theme_gap_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.theme_gap_calls FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._theme_gap_record_results()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_call record;
  v_body jsonb;
  v_stamped int := 0;
  v_n int;
BEGIN
  FOR v_call IN
    SELECT c.net_request_id, h.status_code, h.content
    FROM theme_gap_calls c
    JOIN net._http_response h ON h.id = c.net_request_id
    WHERE c.processed_at IS NULL
  LOOP
    IF v_call.status_code = 200 THEN
      BEGIN
        v_body := v_call.content::jsonb;
      EXCEPTION WHEN others THEN
        v_body := NULL;
      END;
      IF v_body IS NOT NULL THEN
        UPDATE prompt_responses pr
        SET themes_none_found_at = now()
        FROM jsonb_array_elements(COALESCE(v_body->'results', '[]'::jsonb)) res
        WHERE pr.id = (res->>'response_id')::uuid
          AND (res->>'success')::boolean IS TRUE
          AND COALESCE((res->>'themes_count')::int, 0) = 0
          AND pr.themes_none_found_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM ai_themes t WHERE t.response_id = pr.id);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_stamped := v_stamped + v_n;
      END IF;
    END IF;
    UPDATE theme_gap_calls SET processed_at = now() WHERE net_request_id = v_call.net_request_id;
  END LOOP;

  -- pg_net keeps responses for a few hours; drop calls that will never resolve.
  UPDATE theme_gap_calls SET processed_at = now()
  WHERE processed_at IS NULL AND created_at < now() - interval '1 hour';

  RETURN v_stamped;
END;
$$;

REVOKE ALL ON FUNCTION public._theme_gap_record_results() FROM PUBLIC, anon, authenticated;

-- Same tick as before, plus: record results first, and keep the request id.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.theme_gap_tick'::regproc) INTO v_def;
  IF strpos(v_def, '_theme_gap_record_results') > 0 THEN RETURN; END IF;

  v_def := replace(v_def,
    $o$  v_sent int := 0;
BEGIN$o$,
    $n$  v_sent int := 0;
  v_net_id bigint;
BEGIN
  PERFORM public._theme_gap_record_results();$n$);

  v_def := replace(v_def,
    $o$    PERFORM net.http_post($o$,
    $n$    SELECT net.http_post($n$);

  v_def := replace(v_def,
    $o$      timeout_milliseconds := 150000
    );$o$,
    $n$      timeout_milliseconds := 150000
    ) INTO v_net_id;

    INSERT INTO theme_gap_calls (net_request_id, gap_request_id) VALUES (v_net_id, v_req.id);$n$);

  IF strpos(v_def, 'INTO v_net_id') = 0 OR strpos(v_def, 'PERFORM public._theme_gap_record_results()') = 0 THEN
    RAISE EXCEPTION 'theme_gap_tick body did not match; update this migration';
  END IF;
  EXECUTE v_def;
END $$;

