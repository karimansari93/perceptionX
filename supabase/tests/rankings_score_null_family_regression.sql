-- Regression test: model-family scores must be 0, not 100, for a slice with
-- no responses from that family.
--
-- Guards against the COALESCE/LEAST bug fixed in
-- 20260811120000_fix_index_scores_null_family_zero.sql: LEAST(100.0, NULL)
-- returns 100.0 (Postgres LEAST ignores NULLs), so a NULLIF'd zero
-- denominator scored every company in the slice at a perfect 100.
--
-- Run with: psql "$DATABASE_URL" -f supabase/tests/rankings_score_null_family_regression.sql
-- Each block raises an exception on failure; silent output means pass.

-- 1. Unit tests of index_family_score(), the expression both rankings MVs use.
DO $$
DECLARE
  company_combos text[] := ARRAY['perplexity::Culture', 'gpt-5-nano::Culture'];
  slice_combos   text[] := ARRAY['perplexity::Culture', 'perplexity::Salary',
                                 'gpt-5-nano::Culture', 'gpt-5-nano::Salary'];
  got numeric;
BEGIN
  -- THE regression: family with zero responses in the slice scores 0, not 100.
  got := public.index_family_score(company_combos, slice_combos,
                                   ARRAY['%google%', '%gemini%', '%bard%']);
  IF got <> 0 THEN
    RAISE EXCEPTION 'family absent from slice: expected 0, got % (COALESCE/LEAST null bug is back)', got;
  END IF;

  -- Same shape, empty slice entirely.
  got := public.index_family_score(ARRAY[]::text[], ARRAY[]::text[], NULL);
  IF got <> 0 THEN
    RAISE EXCEPTION 'empty slice: expected 0, got %', got;
  END IF;

  -- Normal ratio still computes: company has 1 of 2 perplexity combos -> 50.
  got := public.index_family_score(ARRAY['perplexity::Culture'], slice_combos,
                                   ARRAY['%perplexity%']);
  IF got <> 50.0 THEN
    RAISE EXCEPTION 'partial coverage: expected 50.0, got %', got;
  END IF;

  -- Full coverage of a present family -> 100 (cap still works).
  got := public.index_family_score(company_combos, slice_combos, ARRAY['%gpt%']);
  IF got <> 50.0 THEN
    RAISE EXCEPTION 'gpt family: expected 50.0, got %', got;
  END IF;

  got := public.index_family_score(slice_combos, slice_combos, NULL);
  IF got <> 100.0 THEN
    RAISE EXCEPTION 'full coverage: expected 100.0, got %', got;
  END IF;

  -- Rounding to 1dp: 1 of 3 combos -> 33.3.
  got := public.index_family_score(ARRAY['perplexity::Culture'],
                                   ARRAY['perplexity::Culture', 'perplexity::Salary', 'perplexity::Benefits'],
                                   ARRAY['%perplexity%']);
  IF got <> 33.3 THEN
    RAISE EXCEPTION 'rounding: expected 33.3, got %', got;
  END IF;
END $$;

-- 2. Both MVs must actually use the helper (a rewrite back to the inline
--    buggy expression would silently bypass test 1).
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(matviewname, ', ') INTO bad
  FROM pg_matviews
  WHERE matviewname IN ('rankings_overview', 'rankings_historical')
    AND definition NOT ILIKE '%index_family_score%';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'MV(s) no longer use index_family_score(): %', bad;
  END IF;
END $$;

-- 3. Current branch must be methodology v2 only (see
--    20260811150000_rankings_overview_current_v2_only): the definition keeps
--    its prompt_version filter, and no current-branch slice carries a
--    retired v1 theme in its combinations.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_matviews
    WHERE matviewname = 'rankings_overview'
      AND definition ILIKE '%prompt_version = 2%'
  ) THEN
    RAISE EXCEPTION 'rankings_overview no longer filters raw_data to prompt_version = 2';
  END IF;

  IF EXISTS (
    SELECT 1 FROM rankings_overview
    WHERE data_period IS NULL
      AND EXISTS (SELECT 1 FROM unnest(all_industry_combinations) c(c)
                  WHERE c ILIKE '%Mission & Purpose%')
  ) THEN
    RAISE EXCEPTION 'retired v1 theme found in a current-branch slice of rankings_overview';
  END IF;
END $$;

-- 4. Live-data invariant: no row may score > 0 for a family that has zero
--    combinations in its slice.
DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n
  FROM (
    SELECT canonical_name, industry_context, country FROM rankings_overview
    WHERE (score_google > 0 AND NOT EXISTS (
             SELECT 1 FROM unnest(all_industry_combinations) c(c)
             WHERE c ILIKE '%google%' OR c ILIKE '%gemini%' OR c ILIKE '%bard%'))
       OR (score_chatgpt > 0 AND NOT EXISTS (
             SELECT 1 FROM unnest(all_industry_combinations) c(c)
             WHERE c ILIKE '%gpt%'))
       OR (score_perplexity > 0 AND NOT EXISTS (
             SELECT 1 FROM unnest(all_industry_combinations) c(c)
             WHERE c ILIKE '%perplexity%'))
    UNION ALL
    SELECT canonical_name, industry_context, country FROM rankings_historical
    WHERE (score_google > 0 AND NOT EXISTS (
             SELECT 1 FROM unnest(all_period_combinations) c(c)
             WHERE c ILIKE '%google%' OR c ILIKE '%gemini%' OR c ILIKE '%bard%'))
       OR (score_chatgpt > 0 AND NOT EXISTS (
             SELECT 1 FROM unnest(all_period_combinations) c(c)
             WHERE c ILIKE '%gpt%'))
       OR (score_perplexity > 0 AND NOT EXISTS (
             SELECT 1 FROM unnest(all_period_combinations) c(c)
             WHERE c ILIKE '%perplexity%'))
  ) bad;
  IF n > 0 THEN
    RAISE EXCEPTION '% ranking rows score > 0 for a model family with no responses in their slice', n;
  END IF;
END $$;

SELECT 'rankings_score_null_family_regression: all checks passed' AS result;
