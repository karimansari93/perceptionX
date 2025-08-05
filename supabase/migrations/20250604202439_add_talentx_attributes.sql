-- Add TalentX attributes analysis columns to prompt_responses table
ALTER TABLE prompt_responses 
ADD COLUMN IF NOT EXISTS talentx_analysis JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS talentx_scores JSONB DEFAULT '{}'::jsonb;

-- Create TalentX attribute analysis table for detailed results
CREATE TABLE IF NOT EXISTS talentx_attribute_analysis (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  prompt_response_id UUID REFERENCES prompt_responses(id) ON DELETE CASCADE,
  attribute_id TEXT NOT NULL,
  attribute_name TEXT NOT NULL,
  relevance_score FLOAT DEFAULT 0,
  sentiment_score FLOAT DEFAULT 0,
  mention_count INTEGER DEFAULT 0,
  context JSONB DEFAULT '[]'::jsonb,
  confidence FLOAT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_talentx_analysis_response_id 
ON talentx_attribute_analysis(prompt_response_id);

CREATE INDEX IF NOT EXISTS idx_talentx_analysis_attribute_id 
ON talentx_attribute_analysis(attribute_id);

-- Add trigger for updated_at
CREATE TRIGGER update_talentx_analysis_updated_at
    BEFORE UPDATE ON talentx_attribute_analysis
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add TalentX attribute type to confirmed_prompts
ALTER TYPE prompt_type ADD VALUE IF NOT EXISTS 'talentx';

-- Add attribute_id column to confirmed_prompts for TalentX prompts
ALTER TABLE confirmed_prompts 
ADD COLUMN IF NOT EXISTS talentx_attribute_id TEXT; 