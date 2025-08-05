-- Create confirmed_prompts table
CREATE TABLE IF NOT EXISTS confirmed_prompts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  onboarding_id UUID REFERENCES user_onboarding(id) ON DELETE CASCADE,
  prompt_text TEXT NOT NULL,
  prompt_type TEXT NOT NULL CHECK (prompt_type IN ('sentiment', 'competitive', 'visibility', 'talentx_sentiment', 'talentx_competitive', 'talentx_visibility')),
  prompt_category TEXT DEFAULT 'general',
  is_completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_confirmed_prompts_user_id 
ON confirmed_prompts(user_id);

CREATE INDEX IF NOT EXISTS idx_confirmed_prompts_onboarding_id 
ON confirmed_prompts(onboarding_id);

CREATE INDEX IF NOT EXISTS idx_confirmed_prompts_prompt_type 
ON confirmed_prompts(prompt_type);

-- Add trigger for updated_at
CREATE TRIGGER update_confirmed_prompts_updated_at
    BEFORE UPDATE ON confirmed_prompts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column(); 