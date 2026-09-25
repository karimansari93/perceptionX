-- get_company_readiness(): also return what the org workspace's single
-- company table needs, so the page no longer pulls raw prompt/response rows
-- to the browser (PostgREST caps those at 1,000 rows, which made most of a
-- large client's companies read "No prompts").
--   markets          distinct location_context of the active prompts
--   active_prompts   active prompts for the company
--   prompts_complete active prompts with a response, in the latest month,
--                    from every model collected that month
--   models           the models collected in the latest month
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
    SELECT pr.id, pr.confirmed_prompt_id, pr.ai_model, pr.citations,
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
  ), models AS (
    SELECT COALESCE(array_agg(DISTINCT ai_model ORDER BY ai_model), '{}') AS list,
           count(DISTINCT ai_model) AS n
    FROM r
  ), p AS (
    SELECT cp.id, cp.location_context
    FROM confirmed_prompts cp
    WHERE cp.company_id = p_company AND cp.is_active
  ), per_prompt AS (
    SELECT r.confirmed_prompt_id, count(DISTINCT r.ai_model) AS n
    FROM r GROUP BY r.confirmed_prompt_id
  )
  SELECT jsonb_build_object(
    'company_id', p_company,
    'latest_month', v_month,
    'markets', (SELECT COALESCE(jsonb_agg(DISTINCT location_context ORDER BY location_context), '[]'::jsonb)
                FROM p WHERE location_context IS NOT NULL),
    'active_prompts', (SELECT count(*) FROM p),
    'prompts_complete', (SELECT count(*) FROM p JOIN per_prompt pp ON pp.confirmed_prompt_id = p.id
                         WHERE (SELECT n FROM models) > 0 AND pp.n = (SELECT n FROM models)),
    'models', (SELECT to_jsonb(list) FROM models),
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
