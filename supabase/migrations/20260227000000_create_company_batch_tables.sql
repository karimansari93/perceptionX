-- Create tables for Admin: Company Batch Collection feature
-- Mirrors the visibility_configurations / visibility_queue pattern

-- 1. Batch configuration table (one row per batch definition)
CREATE TABLE IF NOT EXISTS public.company_batch_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    company_name TEXT NOT NULL,
    target_locations TEXT[] DEFAULT '{}', -- free-text: country, state, or city e.g. 'United States', 'California', 'Dubai'
    target_industries TEXT[] DEFAULT '{}',
    target_job_functions TEXT[] DEFAULT '{}',
    org_mode TEXT NOT NULL DEFAULT 'existing_org' CHECK (org_mode IN ('new_org', 'existing_org')),
    organization_id UUID REFERENCES organizations(id),
    new_org_name TEXT,
    created_org_id UUID REFERENCES organizations(id),
    is_active BOOLEAN DEFAULT false,
    schedule_day INT CHECK (schedule_day BETWEEN 1 AND 28),
    schedule_hour INT CHECK (schedule_hour BETWEEN 0 AND 23),
    last_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Batch queue table (one row per location × industry × job_function combination)
CREATE TABLE IF NOT EXISTS public.company_batch_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id UUID NOT NULL REFERENCES public.company_batch_configs(id) ON DELETE CASCADE,
    company_name TEXT NOT NULL,
    location TEXT NOT NULL, -- free-text: country, state, or city (matches target_locations values)
    industry TEXT NOT NULL,
    job_function TEXT,
    company_id UUID REFERENCES companies(id),
    onboarding_id UUID REFERENCES user_onboarding(id),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    phase TEXT DEFAULT 'setup' CHECK (phase IN ('setup', 'search_insights', 'llm_collection', 'done')),
    batch_index INT DEFAULT 0,
    total_prompts INT DEFAULT 0,
    retry_count INT DEFAULT 0,
    error_log TEXT,
    is_cancelled BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_batch_configs_user ON public.company_batch_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_batch_queue_config ON public.company_batch_queue(config_id);
CREATE INDEX IF NOT EXISTS idx_batch_queue_status ON public.company_batch_queue(status, created_at);

-- 4. Enable RLS
ALTER TABLE public.company_batch_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_batch_queue ENABLE ROW LEVEL SECURITY;

-- 5. RLS policies for company_batch_configs (admin-only write, authenticated read)
CREATE POLICY "Admins can do everything with batch configs"
    ON public.company_batch_configs FOR ALL
    USING (is_admin());

CREATE POLICY "Users can view batch configs"
    ON public.company_batch_configs FOR SELECT
    USING (auth.uid() = user_id);

-- 6. RLS policies for company_batch_queue
CREATE POLICY "Admins can do everything with batch queue"
    ON public.company_batch_queue FOR ALL
    USING (is_admin());

CREATE POLICY "Users can view their batch queue items"
    ON public.company_batch_queue FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.company_batch_configs
        WHERE public.company_batch_configs.id = public.company_batch_queue.config_id
        AND public.company_batch_configs.user_id = auth.uid()
    ));

-- 7. updated_at triggers (reuse existing function from visibility migration)
CREATE TRIGGER update_company_batch_configs_updated_at
    BEFORE UPDATE ON public.company_batch_configs
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_company_batch_queue_updated_at
    BEFORE UPDATE ON public.company_batch_queue
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

-- 8. Also add is_cancelled to existing visibility_queue for 12.5 (stop/cancel mechanism)
ALTER TABLE public.visibility_queue ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN DEFAULT false;
