-- Create user_onboarding table
CREATE TABLE IF NOT EXISTS user_onboarding (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  industry TEXT NOT NULL,
  company_size TEXT,
  role TEXT,
  goals TEXT[],
  competitors TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_onboarding_user_id 
ON user_onboarding(user_id);

-- Add trigger for updated_at
CREATE TRIGGER update_user_onboarding_updated_at
    BEFORE UPDATE ON user_onboarding
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column(); 