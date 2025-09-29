-- Create talentx_perception_scores table for storing TalentX Pro analysis results
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

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_talentx_perception_scores_user_id 
ON talentx_perception_scores(user_id);

CREATE INDEX IF NOT EXISTS idx_talentx_perception_scores_attribute_id 
ON talentx_perception_scores(attribute_id);

CREATE INDEX IF NOT EXISTS idx_talentx_perception_scores_created_at 
ON talentx_perception_scores(created_at);

-- Add trigger to update updated_at
CREATE OR REPLACE FUNCTION update_talentx_perception_scores_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_talentx_perception_scores_updated_at 
BEFORE UPDATE ON talentx_perception_scores 
FOR EACH ROW 
EXECUTE FUNCTION update_talentx_perception_scores_updated_at(); 