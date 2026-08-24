-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260316083348; this file was
-- back-filled afterwards and therefore post-dates the deployment.


CREATE OR REPLACE VIEW company_visibility_resolved AS
SELECT 
    cvh.id,
    COALESCE(ccn.canonical_name, cvh.canonical_name) AS canonical_name,
    cvh.canonical_name AS raw_canonical_name,
    cvh.country,
    cvh.industry_context,
    cvh.index_period,
    cvh.percentile,
    cvh.visibility_score,
    cvh.mention_count,
    cvh.rank_position,
    cvh.total_in_industry,
    cvh.recorded_at
FROM (company_visibility_history cvh
    LEFT JOIN company_canonical_names ccn 
        ON ((lower(cvh.canonical_name) = lower(ccn.variant_name)) 
        AND (lower(ccn.canonical_name) <> lower(cvh.canonical_name))))
    LEFT JOIN company_overrides co 
        ON (lower(COALESCE(ccn.canonical_name, cvh.canonical_name)) = lower(co.canonical_name))
WHERE (co.id IS NULL OR co.status <> 'excluded');

