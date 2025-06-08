-- Create prompt_responses table
CREATE TABLE IF NOT EXISTS prompt_responses (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  confirmed_prompt_id UUID REFERENCES confirmed_prompts(id),
  ai_model TEXT NOT NULL,
  response_text TEXT NOT NULL,
  sentiment_score FLOAT,
  sentiment_label TEXT,
  citations JSONB DEFAULT '[]'::jsonb,
  company_mentioned BOOLEAN DEFAULT false,
  mention_ranking INTEGER,
  competitor_mentions JSONB DEFAULT '[]'::jsonb,
  first_mention_position INTEGER,
  total_words INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add missing columns
ALTER TABLE prompt_responses 
  ADD COLUMN IF NOT EXISTS visibility_score FLOAT,
  ADD COLUMN IF NOT EXISTS competitive_score FLOAT,
  ADD COLUMN IF NOT EXISTS detected_competitors TEXT;

-- Create index on confirmed_prompt_id
CREATE INDEX IF NOT EXISTS idx_prompt_responses_confirmed_prompt_id 
ON prompt_responses(confirmed_prompt_id);

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_prompt_responses_updated_at
    BEFORE UPDATE ON prompt_responses
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add competitors field to user_onboarding table
ALTER TABLE user_onboarding ADD COLUMN competitors TEXT[] DEFAULT '{}'; 