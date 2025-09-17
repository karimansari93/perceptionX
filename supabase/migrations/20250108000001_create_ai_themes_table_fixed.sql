-- Create AI themes table to store OpenAI-analyzed themes for each response
CREATE TABLE IF NOT EXISTS ai_themes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  response_id UUID REFERENCES prompt_responses(id) ON DELETE CASCADE,
  theme_name TEXT NOT NULL,
  theme_description TEXT,
  sentiment TEXT NOT NULL CHECK (sentiment IN ('positive', 'negative', 'neutral')),
  sentiment_score FLOAT NOT NULL CHECK (sentiment_score >= -1 AND sentiment_score <= 1),
  talentx_attribute_id TEXT,
  talentx_attribute_name TEXT,
  confidence_score FLOAT NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  keywords TEXT[] DEFAULT '{}',
  context_snippets TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE ai_themes ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view ai_themes for their own responses" ON ai_themes
  FOR SELECT USING (
    response_id IN (
      SELECT pr.id FROM prompt_responses pr
      JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
      WHERE cp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert ai_themes for their own responses" ON ai_themes
  FOR INSERT WITH CHECK (
    response_id IN (
      SELECT pr.id FROM prompt_responses pr
      JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
      WHERE cp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update ai_themes for their own responses" ON ai_themes
  FOR UPDATE USING (
    response_id IN (
      SELECT pr.id FROM prompt_responses pr
      JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
      WHERE cp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete ai_themes for their own responses" ON ai_themes
  FOR DELETE USING (
    response_id IN (
      SELECT pr.id FROM prompt_responses pr
      JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
      WHERE cp.user_id = auth.uid()
    )
  );

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_ai_themes_response_id ON ai_themes(response_id);
CREATE INDEX IF NOT EXISTS idx_ai_themes_sentiment ON ai_themes(sentiment);
CREATE INDEX IF NOT EXISTS idx_ai_themes_talentx_attribute ON ai_themes(talentx_attribute_id);
CREATE INDEX IF NOT EXISTS idx_ai_themes_created_at ON ai_themes(created_at);

-- Add trigger for updated_at
CREATE TRIGGER update_ai_themes_updated_at
    BEFORE UPDATE ON ai_themes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create a view for aggregated theme analysis
CREATE OR REPLACE VIEW theme_analysis_summary AS
SELECT 
  pr.id as response_id,
  pr.response_text,
  pr.ai_model,
  pr.tested_at,
  cp.prompt_text,
  cp.prompt_category,
  COUNT(at.id) as total_themes,
  COUNT(CASE WHEN at.sentiment = 'positive' THEN 1 END) as positive_themes,
  COUNT(CASE WHEN at.sentiment = 'negative' THEN 1 END) as negative_themes,
  COUNT(CASE WHEN at.sentiment = 'neutral' THEN 1 END) as neutral_themes,
  AVG(at.sentiment_score) as avg_sentiment_score,
  AVG(at.confidence_score) as avg_confidence_score,
  ARRAY_AGG(DISTINCT at.talentx_attribute_name) FILTER (WHERE at.talentx_attribute_name IS NOT NULL) as talentx_attributes_covered
FROM prompt_responses pr
LEFT JOIN ai_themes at ON pr.id = at.response_id
LEFT JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
GROUP BY pr.id, pr.response_text, pr.ai_model, pr.tested_at, cp.prompt_text, cp.prompt_category;
