-- Add data collection tracking to companies table
-- This allows us to track and resume data collection if user navigates away

-- Add collection status enum
DO $$ BEGIN
  CREATE TYPE data_collection_status AS ENUM ('pending', 'collecting_search_insights', 'collecting_llm_data', 'completed', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add columns to companies table
ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS data_collection_status data_collection_status DEFAULT 'completed',
ADD COLUMN IF NOT EXISTS data_collection_progress JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS data_collection_started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS data_collection_completed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS onboarding_id UUID REFERENCES user_onboarding(id) ON DELETE SET NULL;

-- Create index for finding companies with incomplete collection
CREATE INDEX IF NOT EXISTS idx_companies_collection_status 
ON companies(data_collection_status) 
WHERE data_collection_status IN ('pending', 'collecting_search_insights', 'collecting_llm_data');

-- Create index for onboarding_id lookups
CREATE INDEX IF NOT EXISTS idx_companies_onboarding_id 
ON companies(onboarding_id) 
WHERE onboarding_id IS NOT NULL;

-- Add comment
COMMENT ON COLUMN companies.data_collection_status IS 'Tracks the current status of data collection for this company';
COMMENT ON COLUMN companies.data_collection_progress IS 'JSON object storing collection progress: {completed: number, total: number, currentPrompt: string, currentModel: string}';
COMMENT ON COLUMN companies.onboarding_id IS 'Links to the user_onboarding record that triggered this company creation';

