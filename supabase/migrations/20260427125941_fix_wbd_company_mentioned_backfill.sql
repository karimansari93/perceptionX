-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260427125941; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Backfill company_mentioned for Warner Bros Discovery responses where AI used
-- "Warner Bros." (with period), "WBD", "HBO", "HBO Max", "Discovery+", "Discovery Channel",
-- "Discovery, Inc", or "TVN" (WBD's Polish subsidiary).
-- The current value (false) was set at ingestion time because exact-match against
-- "Warner Bros Discovery" missed all these variants.

UPDATE prompt_responses pr
SET company_mentioned = true,
    updated_at = NOW()
FROM confirmed_prompts cp, companies c, organization_companies oc, organizations o
WHERE pr.confirmed_prompt_id = cp.id
  AND cp.company_id = c.id
  AND oc.company_id = c.id
  AND oc.organization_id = o.id
  AND o.name = 'Percentiles'
  AND c.name = 'Warner Bros Discovery'
  AND pr.company_mentioned = false
  AND pr.response_text ~* '\mWarner Bros\.?\M|\mWBD\M|\mHBO\M|\mDiscovery\+|\mDiscovery Channel\M|\mDiscovery, Inc|\mTVN\M|\mMax \(';
