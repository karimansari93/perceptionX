-- ============================================================================
-- Claude back in client-facing figures from September 2026 (part 2: matviews)
-- ============================================================================
-- Swaps the v2 literal model filter in the by-location / benchmark matviews
-- for public.is_published_model() (see 20260925130000).
--
-- A matview's definition can't be altered in place, so each one is rebuilt
-- under a temporary name from its LIVE definition, given the same indexes and
-- grants, then swapped in. The old view is only locked for the DROP + RENAME
-- at the very end (lock_timeout 5s, so a busy view fails the swap instead of
-- wedging dashboard reads the way the 2026-07-21 one-transaction rebuild did).
--
-- APPLY ONE SELECT PER TRANSACTION (each is its own statement below); running
-- them all in one transaction would hold every swapped view's exclusive lock
-- until the last rebuild finishes.

CREATE OR REPLACE FUNCTION public._swap_mv_published_filter(p_mv text)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_def text;
  v_new text;
  v_tmp text := p_mv || '_pubnew';
  v_rows bigint;
  r record;
BEGIN
  SELECT definition INTO v_def FROM pg_matviews WHERE schemaname = 'public' AND matviewname = p_mv;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'matview % not found', p_mv;
  END IF;

  v_new := regexp_replace(
    v_def,
    '\(pr\.ai_model <> ALL \(ARRAY\[''claude''::text, ''gemini''::text, ''deepseek''::text\]\)\)',
    'public.is_published_model(pr.ai_model, pr.response_month)',
    'g');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'model filter not found in %', p_mv;
  END IF;
  v_new := rtrim(v_new, E'; \n');

  EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS public.%I', v_tmp);
  EXECUTE format('CREATE MATERIALIZED VIEW public.%I AS %s', v_tmp, v_new);

  FOR r IN
    SELECT c.relname AS iname, pg_get_indexdef(i.indexrelid) AS idef
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = format('public.%I', p_mv)::regclass
  LOOP
    EXECUTE replace(
      replace(r.idef, 'INDEX ' || r.iname || ' ON', 'INDEX ' || r.iname || '_pubnew ON'),
      'ON public.' || p_mv || ' USING', 'ON public.' || v_tmp || ' USING');
  END LOOP;

  FOR r IN
    SELECT a.privilege_type, a.grantee
    FROM pg_class c, aclexplode(c.relacl) a
    WHERE c.oid = format('public.%I', p_mv)::regclass
      AND a.grantee <> c.relowner AND a.grantee <> 0
  LOOP
    EXECUTE format('GRANT %s ON public.%I TO %I', r.privilege_type, v_tmp, pg_get_userbyid(r.grantee));
  END LOOP;

  PERFORM set_config('lock_timeout', '5s', true);
  EXECUTE format('DROP MATERIALIZED VIEW public.%I', p_mv);
  EXECUTE format('ALTER MATERIALIZED VIEW public.%I RENAME TO %I', v_tmp, p_mv);
  FOR r IN
    SELECT c.relname AS iname
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = format('public.%I', p_mv)::regclass AND c.relname LIKE '%\_pubnew'
  LOOP
    EXECUTE format('ALTER INDEX public.%I RENAME TO %I', r.iname, left(r.iname, length(r.iname) - 7));
  END LOOP;

  EXECUTE format('SELECT count(*) FROM public.%I', p_mv) INTO v_rows;
  RETURN p_mv || ': ' || v_rows || ' rows';
END;
$$;

REVOKE ALL ON FUNCTION public._swap_mv_published_filter(text) FROM PUBLIC, anon, authenticated;

-- One per transaction, smallest first:
SELECT public._swap_mv_published_filter('company_llm_rankings_by_location_mv');
SELECT public._swap_mv_published_filter('company_visibility_by_location_mv');
SELECT public._swap_mv_published_filter('competitor_benchmarks_mv');
SELECT public._swap_mv_published_filter('company_sentiment_scores_by_location_mv');
SELECT public._swap_mv_published_filter('company_competitors_by_location_mv');
SELECT public._swap_mv_published_filter('company_attribute_themes_by_location_mv');
SELECT public._swap_mv_published_filter('company_relevance_scores_by_location_mv');
SELECT public._swap_mv_published_filter('company_top_sources_by_location_mv');

-- company_sentiment_scores_by_location_mv_v2tmp is a leftover from the July
-- rebuild, is read by nothing, and is deliberately left untouched.
