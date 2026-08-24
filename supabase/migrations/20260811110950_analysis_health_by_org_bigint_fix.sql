-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260811110950; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- sum(bigint) is numeric; the RETURNS TABLE column is bigint.
CREATE OR REPLACE FUNCTION public.get_analysis_health_by_org()
RETURNS TABLE(
  organization_id uuid,
  organization_name text,
  company_count bigint,
  companies_collecting bigint,
  latest_cycle date,
  responses_in_latest_cycle bigint,
  last_response_at timestamptz,
  themes_missing bigint,
  entity_suggestions_affecting bigint,
  rollups_awaiting_refresh bigint,
  rollups_oldest_dirtied_at timestamptz,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  -- {org_id: {cycle, responses}} for orgs that have ever collected.
  v_org_cycle jsonb;
  -- The distinct set of "some org's latest cycle" — the only cycles the
  -- theme-candidate scan needs to look at.
  v_cycles date[];
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RAISE insufficient_privilege USING MESSAGE = 'get_analysis_health_by_org is admin-only';
  END IF;

  -- Pass 1: one index-only scan of (company_id, collection_cycle) gives both
  -- each org's latest cycle and its response count in that cycle.
  WITH co AS MATERIALIZED (
    SELECT pr.company_id, pr.collection_cycle, count(*) AS responses
    FROM prompt_responses pr
    WHERE pr.collection_cycle IS NOT NULL
      AND pr.company_id IS NOT NULL
    GROUP BY 1, 2
  ), per_org AS (
    SELECT oc.organization_id AS org_id,
           co.collection_cycle,
           sum(co.responses) AS responses
    FROM organization_companies oc
    JOIN co ON co.company_id = oc.company_id
    GROUP BY 1, 2
  ), latest AS (
    SELECT DISTINCT ON (p.org_id) p.org_id, p.collection_cycle, p.responses
    FROM per_org p
    ORDER BY p.org_id, p.collection_cycle DESC
  )
  SELECT jsonb_object_agg(
           l.org_id::text,
           jsonb_build_object('cycle', l.collection_cycle, 'responses', l.responses)),
         array_agg(DISTINCT l.collection_cycle)
  INTO v_org_cycle, v_cycles
  FROM latest l;

  v_org_cycle := COALESCE(v_org_cycle, '{}'::jsonb);
  v_cycles := COALESCE(v_cycles, ARRAY[]::date[]);

  RETURN QUERY
  WITH cand AS MATERIALIZED (
    SELECT pr.id, pr.company_id, pr.collection_cycle
    FROM prompt_responses pr
    WHERE pr.collection_cycle = ANY (v_cycles)
      AND pr.response_text IS NOT NULL AND length(pr.response_text) > 100
      AND COALESCE(pr.for_index, false) = false
      AND COALESCE(pr.company_mentioned, false) = true
      AND pr.themes_none_found_at IS NULL
  ), not_in_mv AS MATERIALIZED (
    SELECT c.id, c.company_id, c.collection_cycle
    FROM cand c
    WHERE NOT EXISTS (
      SELECT 1 FROM company_response_sentiment_mv m
      WHERE m.company_id = c.company_id AND m.response_id = c.id)
  ), missing AS MATERIALIZED (
    SELECT c.company_id, c.collection_cycle, count(*) AS missing
    FROM not_in_mv c
    WHERE NOT EXISTS (SELECT 1 FROM ai_themes t WHERE t.response_id = c.id)
    GROUP BY 1, 2
  ), pending_alias AS MATERIALIZED (
    SELECT s.normalized_alias
    FROM entity_alias_suggestions s
    WHERE s.status = 'pending'
  ), alias_by_company AS MATERIALIZED (
    -- entity_alias_suggestions has no company/org column, but a pending merge
    -- can still be attributed: company_competitors_mv.competitor_name is
    -- COALESCE(canonical_name, initcap(normalized_alias)) (_refresh_cm_competitors),
    -- and a *pending* suggestion is by definition not yet in entity_aliases, so
    -- its name in the MV is the initcap form and lower() inverts it exactly.
    SELECT DISTINCT cc.company_id, p.normalized_alias
    FROM company_competitors_mv cc
    JOIN pending_alias p ON p.normalized_alias = lower(cc.competitor_name)
  ), co_last AS MATERIALIZED (
    SELECT c.id AS company_id,
           (SELECT pr.tested_at
              FROM prompt_responses pr
             WHERE pr.company_id = c.id
             ORDER BY pr.tested_at DESC
             LIMIT 1) AS last_tested
    FROM companies c
  ), org_co AS MATERIALIZED (
    SELECT oc.organization_id AS org_id, oc.company_id
    FROM organization_companies oc
  ), org_companies AS (
    SELECT oc.org_id,
           count(*) AS company_count,
           count(*) FILTER (
             WHERE c.data_collection_status IN ('collecting_search_insights','collecting_llm_data')
           ) AS collecting,
           max(cl.last_tested) AS last_tested
    FROM org_co oc
    JOIN companies c ON c.id = oc.company_id
    LEFT JOIN co_last cl ON cl.company_id = c.id
    GROUP BY 1
  ), org_dirty AS (
    SELECT oc.org_id, count(*) AS dirty, min(d.dirtied_at) AS dirty_since
    FROM org_co oc
    JOIN company_metrics_dirty d ON d.company_id = oc.company_id
    GROUP BY 1
  ), org_alias AS (
    SELECT oc.org_id, count(DISTINCT a.normalized_alias) AS aliases
    FROM org_co oc
    JOIN alias_by_company a ON a.company_id = oc.company_id
    GROUP BY 1
  ), org_missing AS (
    SELECT oc.org_id, sum(m.missing)::bigint AS themes_missing
    FROM org_co oc
    JOIN missing m ON m.company_id = oc.company_id
    WHERE m.collection_cycle = (v_org_cycle -> oc.org_id::text ->> 'cycle')::date
    GROUP BY 1
  )
  SELECT o.id,
         o.name,
         COALESCE(ocm.company_count, 0),
         COALESCE(ocm.collecting, 0),
         (v_org_cycle -> o.id::text ->> 'cycle')::date,
         COALESCE((v_org_cycle -> o.id::text ->> 'responses')::bigint, 0),
         ocm.last_tested,
         COALESCE(om.themes_missing, 0),
         COALESCE(oa.aliases, 0),
         COALESCE(od.dirty, 0),
         od.dirty_since,
         CASE
           WHEN (v_org_cycle -> o.id::text) IS NULL THEN 'no_data'
           WHEN COALESCE(ocm.collecting, 0) > 0 THEN 'collecting'
           WHEN COALESCE(om.themes_missing, 0) > 0
             OR COALESCE(oa.aliases, 0) > 0
             OR COALESCE(od.dirty, 0) > 0 THEN 'pending'
           ELSE 'ready'
         END
  FROM organizations o
  LEFT JOIN org_companies ocm ON ocm.org_id = o.id
  LEFT JOIN org_dirty     od  ON od.org_id  = o.id
  LEFT JOIN org_alias     oa  ON oa.org_id  = o.id
  LEFT JOIN org_missing   om  ON om.org_id  = o.id
  ORDER BY (v_org_cycle -> o.id::text ->> 'cycle')::date DESC NULLS LAST, o.name;
END;
$function$;
