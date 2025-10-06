-- Enable RLS on talentx_perception_scores table
ALTER TABLE talentx_perception_scores ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to read their own TalentX perception scores
CREATE POLICY "Users can read their own TalentX perception scores" ON talentx_perception_scores
  FOR SELECT USING (auth.uid() = user_id);

-- Create policy to allow users to insert their own TalentX perception scores
CREATE POLICY "Users can insert their own TalentX perception scores" ON talentx_perception_scores
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Create policy to allow users to update their own TalentX perception scores
CREATE POLICY "Users can update their own TalentX perception scores" ON talentx_perception_scores
  FOR UPDATE USING (auth.uid() = user_id);

-- Create policy to allow users to delete their own TalentX perception scores
CREATE POLICY "Users can delete their own TalentX perception scores" ON talentx_perception_scores
  FOR DELETE USING (auth.uid() = user_id); 