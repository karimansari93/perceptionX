-- ============================================================================
-- Monthly auto-refresh for organizations
-- ============================================================================
--
-- Goal: on the 1st of each month, create a fresh batch that re-collects
-- responses for every (company, location, industry, job_function) combo
-- belonging to an org that's opted in to auto-refresh. The team finds out
-- via Slack when it completes.
--
-- Opt-in: `organizations.auto_refresh_enabled` boolean (new column). Set
-- this to TRUE on the Netflix org row (or any other org) to have them
-- refreshed monthly.
--
-- The refresh creates ONE config per org + one queue row per distinct
-- (company_id, location, industry, job_function) combo, all starting at
-- phase='llm_collection' (prompts already exist, so we skip expand_setup).
--
-- The config carries `skip_if_collected_in_month = <current YYYY-MM>`, which
-- `process-company-batch-queue` forwards to `collect-company-responses`.
-- That means each prompt only gets re-collected if it doesn't already have
-- a response FROM THIS MONTH for each model — we get a true monthly
-- snapshot, not just gap-fills on all-time coverage.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Schema additions
-- ----------------------------------------------------------------------------

-- Opt-in flag on organizations. Nullable/false by default so existing orgs
-- don't silently start costing money.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS auto_refresh_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.auto_refresh_enabled IS
'If true, the monthly_auto_refresh cron creates a batch on the 1st of every month that re-collects every (company, location, industry, job_function) combo for this org.';

-- skip_if_collected_in_month on batch configs — read by process-company-batch-queue.
-- Nullable; when set, it's a "YYYY-MM" string and causes the llm_collection
-- phase to forward skipIfCollectedInMonth to collect-company-responses.
ALTER TABLE public.company_batch_configs
  ADD COLUMN IF NOT EXISTS skip_if_collected_in_month TEXT;

COMMENT ON COLUMN public.company_batch_configs.skip_if_collected_in_month IS
'Optional "YYYY-MM". When set, process-company-batch-queue passes this to collect-company-responses so prompts only re-run if they lack a response in that specific month.';

-- Helpful index for the monthly cron's lookup of opted-in orgs.
CREATE INDEX IF NOT EXISTS idx_organizations_auto_refresh
  ON public.organizations (auto_refresh_enabled)
  WHERE auto_refresh_enabled = true;


-- ----------------------------------------------------------------------------
-- The refresh function.
--
-- For each opted-in org:
--   1. Find the owner user (for user_id on the config).
--   2. Find every distinct (company_id, location, industry, job_function) combo
--      that has at least one active prompt.
--   3. Create ONE config with skip_if_collected_in_month = current YYYY-MM.
--   4. Insert one queue row per combo, phase=llm_collection, status=pending.
--   5. Kick the queue processor for that config.
--   6. Emit a Slack alert so the team knows the monthly refresh started.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.monthly_auto_refresh()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_project_url TEXT := current_setting('app.settings.supabase_url', true);
    v_service_key TEXT := current_setting('app.settings.service_role_key', true);
    v_current_month TEXT := to_char(NOW(), 'YYYY-MM');
    v_org RECORD;
    v_owner_id uuid;
    v_config_id uuid;
    v_jobs_created int;
    v_orgs_refreshed int := 0;
    v_total_jobs int := 0;
BEGIN
    FOR v_org IN
        SELECT id, name
        FROM public.organizations
        WHERE auto_refresh_enabled = true
    LOOP
        -- Find the org owner (prefer is_default=true, fall back to any member).
        SELECT om.user_id
        INTO v_owner_id
        FROM public.organization_members om
        WHERE om.organization_id = v_org.id
          AND om.role = 'owner'
        ORDER BY COALESCE(om.is_default, false) DESC, om.created_at ASC
        LIMIT 1;

        IF v_owner_id IS NULL THEN
            CONTINUE;  -- org has no owner, skip
        END IF;

        -- Create a fresh config for this month.
        INSERT INTO public.company_batch_configs (
            user_id, company_name, org_mode, organization_id,
            target_locations, target_industries, target_job_functions,
            skip_if_collected_in_month
        ) VALUES (
            v_owner_id,
            v_org.name || ' monthly refresh ' || v_current_month,
            'existing_org',
            v_org.id,
            '{}', '{}', '{}',
            v_current_month
        )
        RETURNING id INTO v_config_id;

        -- Create queue rows for every distinct active combo in this org.
        WITH org_companies AS (
            SELECT company_id
            FROM public.organization_companies
            WHERE organization_id = v_org.id
        ),
        combos AS (
            SELECT DISTINCT
                cp.company_id,
                c.name AS company_name,
                COALESCE(cp.location_context, 'Global (All Countries)') AS location,
                COALESCE(cp.industry_context, 'General') AS industry,
                cp.job_function_context AS job_function
            FROM public.confirmed_prompts cp
            JOIN public.companies c ON c.id = cp.company_id
            WHERE cp.company_id IN (SELECT company_id FROM org_companies)
              AND cp.is_active = true
        )
        INSERT INTO public.company_batch_queue (
            config_id, company_id, company_name, location, industry, job_function,
            phase, status
        )
        SELECT
            v_config_id, company_id, company_name, location, industry, job_function,
            'llm_collection', 'pending'
        FROM combos;

        GET DIAGNOSTICS v_jobs_created = ROW_COUNT;

        -- Kick the queue processor once for this config. Fire-and-forget; the
        -- watchdog will resume if the self-chain dies.
        IF v_project_url IS NOT NULL AND v_service_key IS NOT NULL AND v_jobs_created > 0 THEN
            PERFORM net.http_post(
                url := v_project_url || '/functions/v1/process-company-batch-queue',
                headers := jsonb_build_object(
                    'Authorization', 'Bearer ' || v_service_key,
                    'Content-Type', 'application/json'
                ),
                body := jsonb_build_object('configId', v_config_id)
            );
        END IF;

        -- Slack alert so the team knows a monthly run started.
        PERFORM public.send_batch_alert(jsonb_build_object(
            'event', 'monthly_refresh_started',
            'text', format(
                'Monthly refresh for *%s* (month: %s). %s jobs queued — will re-collect any (prompt, model) pair missing a %s response.',
                v_org.name, v_current_month, v_jobs_created, v_current_month
            ),
            'fields', jsonb_build_array(
                jsonb_build_object('label', 'Organization', 'value', v_org.name),
                jsonb_build_object('label', 'Month',        'value', v_current_month),
                jsonb_build_object('label', 'Jobs queued',  'value', v_jobs_created::text),
                jsonb_build_object('label', 'Config',       'value', v_config_id::text)
            )
        ));

        v_orgs_refreshed := v_orgs_refreshed + 1;
        v_total_jobs := v_total_jobs + v_jobs_created;
    END LOOP;

    RETURN jsonb_build_object(
        'month', v_current_month,
        'orgs_refreshed', v_orgs_refreshed,
        'total_jobs', v_total_jobs
    );
END;
$$;

COMMENT ON FUNCTION public.monthly_auto_refresh IS
'Called by pg_cron on the 1st of every month at 02:00 UTC. For each org with auto_refresh_enabled=true, creates a config + queue rows to re-collect every active combo. Uses skip_if_collected_in_month so previously-collected months stay untouched.';


-- ----------------------------------------------------------------------------
-- Schedule: 1st of each month at 02:00 UTC.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    PERFORM cron.unschedule('batch-monthly-auto-refresh');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
    'batch-monthly-auto-refresh',
    '0 2 1 * *',  -- 02:00 UTC on day 1 of every month
    $cron$ SELECT public.monthly_auto_refresh(); $cron$
);

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.monthly_auto_refresh() TO service_role;
