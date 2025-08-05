-- Run this script in your Supabase SQL Editor to create the missing TalentX tables

-- Create talentx_pro_prompts table
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

-- Create indexes for talentx_pro_prompts
CREATE INDEX IF NOT EXISTS idx_talentx_pro_prompts_user_id 
ON talentx_pro_prompts(user_id);

CREATE INDEX IF NOT EXISTS idx_talentx_pro_prompts_attribute 
ON talentx_pro_prompts(attribute_id, prompt_type);

-- Create talentx_perception_scores table
CREATE TABLE IF NOT EXISTS talentx_perception_scores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attribute_id TEXT NOT NULL,
  perception_score DECIMAL(5,2) NOT NULL,
  sentiment_score DECIMAL(5,2) NOT NULL,
  response_text TEXT NOT NULL,
  ai_model TEXT NOT NULL,
  prompt_type TEXT NOT NULL,
  citations JSONB,
  detected_competitors TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for talentx_perception_scores
CREATE INDEX IF NOT EXISTS idx_talentx_perception_scores_user_id 
ON talentx_perception_scores(user_id);

CREATE INDEX IF NOT EXISTS idx_talentx_perception_scores_attribute_id 
ON talentx_perception_scores(attribute_id);

CREATE INDEX IF NOT EXISTS idx_talentx_perception_scores_created_at 
ON talentx_perception_scores(created_at);

-- Create prompt_responses table if it doesn't exist
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
  visibility_score FLOAT,
  competitive_score FLOAT,
  detected_competitors TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on confirmed_prompt_id
CREATE INDEX IF NOT EXISTS idx_prompt_responses_confirmed_prompt_id 
ON prompt_responses(confirmed_prompt_id);

-- Add RLS policies for talentx_pro_prompts
ALTER TABLE talentx_pro_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own talentx pro prompts" ON talentx_pro_prompts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own talentx pro prompts" ON talentx_pro_prompts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own talentx pro prompts" ON talentx_pro_prompts
  FOR UPDATE USING (auth.uid() = user_id);

-- Add RLS policies for talentx_perception_scores
ALTER TABLE talentx_perception_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own talentx perception scores" ON talentx_perception_scores
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own talentx perception scores" ON talentx_perception_scores
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own talentx perception scores" ON talentx_perception_scores
  FOR UPDATE USING (auth.uid() = user_id);

-- Add RLS policies for prompt_responses
ALTER TABLE prompt_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own prompt responses" ON prompt_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM confirmed_prompts 
      WHERE confirmed_prompts.id = prompt_responses.confirmed_prompt_id 
      AND confirmed_prompts.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own prompt responses" ON prompt_responses
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM confirmed_prompts 
      WHERE confirmed_prompts.id = prompt_responses.confirmed_prompt_id 
      AND confirmed_prompts.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own prompt responses" ON prompt_responses
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM confirmed_prompts 
      WHERE confirmed_prompts.id = prompt_responses.confirmed_prompt_id 
      AND confirmed_prompts.user_id = auth.uid()
    )
  ); 