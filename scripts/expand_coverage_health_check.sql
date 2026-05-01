-- =============================================================================
-- Expand Coverage — Health Check
-- =============================================================================
-- Run before and after an expand-coverage operation to catch:
--   1. Stranded queue jobs (pre-fix leftovers or in-flight work)
--   2. Duplicate company rows created by the onboarding trigger
--   3. Cross-organization prompt leaks
--   4. prompt_responses whose company_id doesn't match their prompt's company_id
--   5. Confirmed prompts with NULL company_id (detached)
--   6. Companies that have more than one distinct country (violates the
--      "one country per company" rule)
--
-- Usage: paste each query into the Supabase SQL editor, or:
--   psql "$DATABASE_URL" -f scripts/expand_coverage_health_check.sql
-- =============================================================================


-- 1. Queue backlog by status/phase -------------------------------------------
-- Anything stuck in 'pending' or 'processing' for more than a few minutes is a
-- candidate for sweep/cancel. After a successful run, expect 0 stranded.
SELECT
    q.status,
    q.phase,
    COUNT(*)               AS jobs,
    MIN(q.created_at)      AS oldest,
    MAX(q.updated_at)      AS latest_update
FROM public.company_batch_queue q
GROUP BY q.status, q.phase
ORDER BY q.status, q.phase;


-- 2. Jobs referencing configs from organizations other than the one that
-- invoked them (sanity: should only return rows if someone hand-crafted bad
-- data). After the fix, cross-config self-chaining is impossible, but this
-- still catches stale rows from before the fix.
SELECT
    q.id          AS queue_id,
    q.config_id,
    q.company_id,
    q.company_name,
    q.phase,
    q.status,
    c.organization_id     AS config_org_id,
    oc.organization_id    AS company_linked_org_id,
    q.created_at
FROM public.company_batch_queue q
JOIN public.company_batch_configs c ON c.id = q.config_id
LEFT JOIN public.organization_companies oc ON oc.company_id = q.company_id
WHERE q.company_id IS NOT NULL
  AND c.organization_id IS NOT NULL
  AND oc.organization_id IS NOT NULL
  AND c.organization_id <> oc.organization_id
ORDER BY q.created_at DESC;


-- 3. Duplicate companies (same name inside the same organization) ------------
-- The auto_create_company_from_onboarding trigger ALWAYS creates a new
-- companies row. Pre-fix, expand_coverage went through that trigger and forked
-- the target company. Anything returned here is likely a pre-fix duplicate.
SELECT
    oc.organization_id,
    o.name AS organization_name,
    lower(c.name) AS company_name_lower,
    COUNT(*)                                   AS dup_count,
    array_agg(c.id ORDER BY c.created_at)      AS company_ids,
    array_agg(c.created_at ORDER BY c.created_at) AS created_ats
FROM public.companies c
JOIN public.organization_companies oc ON oc.company_id = c.id
JOIN public.organizations o ON o.id = oc.organization_id
GROUP BY oc.organization_id, o.name, lower(c.name)
HAVING COUNT(*) > 1
ORDER BY dup_count DESC, o.name;


-- 4. prompt_responses where response.company_id ≠ prompt.company_id ---------
-- Cross-contamination. Defense-in-depth `companyId` filter added to
-- collect-company-responses should make new rows of this kind impossible.
SELECT
    pr.id                  AS response_id,
    pr.company_id          AS response_company_id,
    cp.company_id          AS prompt_company_id,
    pr.ai_model,
    pr.confirmed_prompt_id,
    pr.tested_at
FROM public.prompt_responses pr
JOIN public.confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
WHERE pr.company_id IS DISTINCT FROM cp.company_id
ORDER BY pr.tested_at DESC
LIMIT 200;


-- 5. Active confirmed_prompts with NULL company_id --------------------------
-- Expected: 0 for company-scoped prompts. A non-zero count with
-- prompt_type <> 'discovery' and no onboarding_id is a leak or orphan.
SELECT
    cp.id,
    cp.prompt_type,
    cp.industry_context,
    cp.location_context,
    cp.job_function_context,
    cp.onboarding_id,
    cp.created_at
FROM public.confirmed_prompts cp
WHERE cp.company_id IS NULL
  AND cp.is_active = true
  AND cp.prompt_type <> 'discovery'
ORDER BY cp.created_at DESC
LIMIT 50;


-- 6. Companies that violate "one country per company" ------------------------
-- The new Expand Coverage UI enforces this on input, but existing data may
-- still have multiple countries on a single company from previous batch runs.
-- Review these before using Expand Coverage on them.
SELECT
    cp.company_id,
    c.name,
    COUNT(DISTINCT cp.location_context) AS distinct_countries,
    array_agg(DISTINCT cp.location_context) AS countries
FROM public.confirmed_prompts cp
JOIN public.companies c ON c.id = cp.company_id
WHERE cp.is_active = true
  AND cp.location_context IS NOT NULL
GROUP BY cp.company_id, c.name
HAVING COUNT(DISTINCT cp.location_context) > 1
ORDER BY distinct_countries DESC, c.name;


-- 7. Batch configs created for Expand Coverage with no queue rows ------------
-- Indicates a run where the admin hit Expand but every combo was already
-- covered (or an aborted run). Harmless — useful for reconciliation.
SELECT
    cfg.id,
    cfg.user_id,
    cfg.company_name,
    cfg.organization_id,
    cfg.target_locations,
    cfg.target_job_functions,
    cfg.created_at
FROM public.company_batch_configs cfg
LEFT JOIN public.company_batch_queue q ON q.config_id = cfg.id
WHERE cfg.org_mode = 'existing_org'
  AND q.id IS NULL
ORDER BY cfg.created_at DESC
LIMIT 50;


-- 8. Most-recently-written prompts by company -------------------------------
-- Quick eyeball after a run: did the new prompts attach to the RIGHT company?
-- Filter by company_id to verify your Netflix run landed on the right row.
-- Example: replace <COMPANY_UUID> with Netflix's real id.
-- SELECT prompt_text, location_context, industry_context, job_function_context, created_at
-- FROM public.confirmed_prompts
-- WHERE company_id = '<COMPANY_UUID>'
-- ORDER BY created_at DESC
-- LIMIT 20;
