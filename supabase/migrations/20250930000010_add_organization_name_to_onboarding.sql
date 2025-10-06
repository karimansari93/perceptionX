-- Add organization_name field to user_onboarding table
-- This field will store the umbrella organization name that contains all companies

-- Add the organization_name column
ALTER TABLE user_onboarding 
ADD COLUMN IF NOT EXISTS organization_name TEXT;

-- Add an index for better performance
CREATE INDEX IF NOT EXISTS idx_user_onboarding_organization_name 
ON user_onboarding(organization_name);

-- Add a comment
COMMENT ON COLUMN user_onboarding.organization_name IS 'The umbrella organization name that contains all companies for this user';


