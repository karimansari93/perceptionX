-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260311081946; this file was
-- back-filled afterwards and therefore post-dates the deployment.


CREATE OR REPLACE VIEW company_visibility_resolved
WITH (security_invoker = true)
AS
SELECT
  cvh.id,
  COALESCE(ccn.canonical_name, cvh.canonical_name) AS canonical_name,
  cvh.canonical_name                               AS raw_canonical_name,
  cvh.country,
  cvh.industry_context,
  cvh.index_period,
  cvh.percentile,
  cvh.visibility_score,
  cvh.mention_count,
  cvh.rank_position,
  cvh.total_in_industry,
  cvh.recorded_at
FROM company_visibility_history cvh
LEFT JOIN company_canonical_names ccn
  ON LOWER(cvh.canonical_name) = LOWER(ccn.variant_name)
  AND LOWER(ccn.canonical_name) != LOWER(cvh.canonical_name);

COMMENT ON VIEW company_visibility_resolved IS
  'company_visibility_history with canonical_name resolved through company_canonical_names.
   Use this view instead of the raw table for all ranking, profile, and scoring queries.
   Divisions (e.g. Renault Ampere, Honda of America) are merged into their parent canonical.
   raw_canonical_name preserves the original value for debugging.';

