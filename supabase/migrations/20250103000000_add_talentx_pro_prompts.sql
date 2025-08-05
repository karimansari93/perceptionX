-- Add TalentX Pro prompts support
-- This migration adds support for the 30 specialized TalentX prompts for Pro users

-- Add TalentX prompt types to confirmed_prompts
ALTER TYPE prompt_type ADD VALUE IF NOT EXISTS 'talentx_sentiment';
ALTER TYPE prompt_type ADD VALUE IF NOT EXISTS 'talentx_competitive';
ALTER TYPE prompt_type ADD VALUE IF NOT EXISTS 'talentx_visibility';

-- Add columns to track TalentX prompt metadata
ALTER TABLE confirmed_prompts 
  ADD COLUMN IF NOT EXISTS talentx_prompt_type TEXT CHECK (talentx_prompt_type IN ('sentiment', 'competitive', 'visibility')),
  ADD COLUMN IF NOT EXISTS talentx_attribute_id TEXT,
  ADD COLUMN IF NOT EXISTS is_pro_prompt BOOLEAN DEFAULT false;

-- Create index for TalentX prompts
CREATE INDEX IF NOT EXISTS idx_confirmed_prompts_talentx 
ON confirmed_prompts(talentx_attribute_id, talentx_prompt_type) 
WHERE talentx_attribute_id IS NOT NULL;

-- Add columns to prompt_responses for enhanced TalentX analysis
ALTER TABLE prompt_responses 
  ADD COLUMN IF NOT EXISTS talentx_perception_score FLOAT,
  ADD COLUMN IF NOT EXISTS talentx_relevance_score FLOAT,
  ADD COLUMN IF NOT EXISTS talentx_sentiment_score FLOAT,
  ADD COLUMN IF NOT EXISTS talentx_mention_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS talentx_confidence FLOAT;

-- Create TalentX Pro prompts table for tracking generated prompts
CREATE TABLE IF NOT EXISTS talentx_pro_prompts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  industry TEXT NOT NULL,
  attribute_id TEXT NOT NULL,
  prompt_type TEXT NOT NULL CHECK (prompt_type IN ('sentiment', 'competitive', 'visibility')),
  prompt_text TEXT NOT NULL,
  is_generated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, attribute_id, prompt_type)
);

-- Create indexes for TalentX Pro prompts
CREATE INDEX IF NOT EXISTS idx_talentx_pro_prompts_user_id 
ON talentx_pro_prompts(user_id);

CREATE INDEX IF NOT EXISTS idx_talentx_pro_prompts_attribute 
ON talentx_pro_prompts(attribute_id, prompt_type);

-- Add trigger for updated_at
CREATE TRIGGER update_talentx_pro_prompts_updated_at
    BEFORE UPDATE ON talentx_pro_prompts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
