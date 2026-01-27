
-- Create table for storing user configurations and schedules
CREATE TABLE IF NOT EXISTS public.visibility_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    target_industries TEXT[] DEFAULT '{}',
    target_countries TEXT[] DEFAULT '{}',
    schedule_day INT CHECK (schedule_day BETWEEN 1 AND 28), -- Day of month
    schedule_hour INT CHECK (schedule_hour BETWEEN 0 AND 23), -- Hour of day (UTC)
    is_active BOOLEAN DEFAULT false,
    last_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Create table for the processing queue
CREATE TABLE IF NOT EXISTS public.visibility_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id UUID REFERENCES public.visibility_configurations(id),
    industry TEXT NOT NULL,
    country TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    batch_index INT DEFAULT 0, -- Current prompt index
    total_prompts INT DEFAULT 16, -- Total prompts to process
    retry_count INT DEFAULT 0,
    error_log TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add RLS policies
ALTER TABLE public.visibility_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visibility_queue ENABLE ROW LEVEL SECURITY;

-- Policies for visibility_configurations
CREATE POLICY "Users can view their own config" 
ON public.visibility_configurations FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own config" 
ON public.visibility_configurations FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own config" 
ON public.visibility_configurations FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Policies for visibility_queue (View only for users, system manages inserts/updates)
CREATE POLICY "Users can view their own queue" 
ON public.visibility_queue FOR SELECT 
USING (EXISTS (
    SELECT 1 FROM public.visibility_configurations 
    WHERE public.visibility_configurations.id = public.visibility_queue.config_id 
    AND public.visibility_configurations.user_id = auth.uid()
));

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_visibility_configurations_updated_at
    BEFORE UPDATE ON public.visibility_configurations
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_visibility_queue_updated_at
    BEFORE UPDATE ON public.visibility_queue
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();
