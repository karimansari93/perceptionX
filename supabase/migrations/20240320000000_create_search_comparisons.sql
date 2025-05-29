-- Create search_comparisons table
CREATE TABLE IF NOT EXISTS search_comparisons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  prompt_id TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  google_results JSONB NOT NULL,
  bing_results JSONB,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on prompt_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_search_comparisons_prompt_id ON search_comparisons(prompt_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_search_comparisons_updated_at
  BEFORE UPDATE ON search_comparisons
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column(); 