-- ============================================================================
-- company_visibility_by_location_mv: precomputed visibility rollup
-- ============================================================================
--
-- Visibility (the % of responses where the company is mentioned) is the last
-- headline metric still computed in the browser from raw prompt_responses
-- rows — the dashboard must download every eager response before it can show
-- a single scorecard, and re-scoping by location/function re-scans them all
-- client-side. This MV precomputes mentioned/total counts per
-- (company, location bucket, snapshot month, job function), so:
--
--   * the scorecards / EPS / trends can paint from a few hundred tiny rows,
--   * every (location x function x month) combination — including the merged
--     brand scope, which sums rows across same-name sibling companies — is a
--     client-side filter over already-loaded rows, no refetch,
--   * raw responses only need to load for drilldown tables.
--
-- Conventions mirror the existing rollups and the frontend exactly:
--   * location bucket:  COALESCE(NULLIF(btrim(location_context), ''), '')
--                       (same as every *_by_location_mv; '' = untagged)
--   * month bucket:     COALESCE(response_month, date_trunc(month, tested_at))
--                       (same as the frontend's responseMonthKey: the tagged
--                        collection month wins over the physical write time)
--   * job function:     COALESCE(NULLIF(btrim(job_function_context), ''), '')
--   * excludes the deprecated "Overall Candidate Experience" prompt set,
--     mirroring isOverallCandidateExperience() which hides those responses
--     from every dashboard view.
--
-- Refresh: registering the MV in mv_refresh_state is all that's needed — the
-- staleness tick (20260628000001) is data-driven and will pick it up on its
-- next pass (NULL last_refresh sorts first).
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS public.company_visibility_by_location_mv AS
SELECT pr.company_id,
       COALESCE(NULLIF(btrim(cp.location_context), ''::text), ''::text) AS location_context,
       COALESCE(pr.response_month, date_trunc('month'::text, pr.tested_at)::date) AS response_month,
       COALESCE(NULLIF(btrim(cp.job_function_context), ''::text), ''::text) AS job_function_context,
       count(*) AS total_responses,
       count(*) FILTER (WHERE pr.company_mentioned = true) AS mentioned_responses,
       now() AS calculated_at
FROM prompt_responses pr
  JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
WHERE pr.company_id IS NOT NULL
  AND pr.tested_at IS NOT NULL
  AND lower(COALESCE(btrim(cp.attribute_id), ''::text)) <> 'overall-candidate-experience'
  AND lower(COALESCE(btrim(cp.prompt_theme), ''::text)) <> 'overall candidate experience'
GROUP BY pr.company_id,
         COALESCE(NULLIF(btrim(cp.location_context), ''::text), ''::text),
         COALESCE(pr.response_month, date_trunc('month'::text, pr.tested_at)::date),
         COALESCE(NULLIF(btrim(cp.job_function_context), ''::text), ''::text);

-- REFRESH MATERIALIZED VIEW CONCURRENTLY requires a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS company_visibility_by_location_mv_uniq
  ON public.company_visibility_by_location_mv
  USING btree (company_id, location_context, response_month, job_function_context);
CREATE INDEX IF NOT EXISTS company_visibility_by_location_mv_lookup
  ON public.company_visibility_by_location_mv
  USING btree (company_id, response_month DESC);

-- Same read access as the sibling rollup MVs.
GRANT SELECT ON public.company_visibility_by_location_mv TO authenticated, service_role;

-- Register with the staleness-driven refresh tick (NULL last_refresh -> the
-- tick performs its first clean refresh on the next pass).
INSERT INTO public.mv_refresh_state (mv_name)
VALUES ('company_visibility_by_location_mv')
ON CONFLICT (mv_name) DO NOTHING;
