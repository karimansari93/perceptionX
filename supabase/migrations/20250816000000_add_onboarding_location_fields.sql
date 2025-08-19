-- Add job_function and country fields to user_onboarding table
ALTER TABLE user_onboarding 
ADD COLUMN IF NOT EXISTS job_function TEXT,
ADD COLUMN IF NOT EXISTS country TEXT,
ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Create index for location-based queries if needed
CREATE INDEX IF NOT EXISTS idx_user_onboarding_country 
ON user_onboarding(country) WHERE country IS NOT NULL;

-- Create index for job function queries if needed
CREATE INDEX IF NOT EXISTS idx_user_onboarding_job_function 
ON user_onboarding(job_function) WHERE job_function IS NOT NULL;


