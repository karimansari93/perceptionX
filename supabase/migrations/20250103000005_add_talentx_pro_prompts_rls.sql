-- Enable RLS on talentx_pro_prompts table
ALTER TABLE talentx_pro_prompts ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to read their own TalentX Pro prompts
CREATE POLICY "Users can read their own TalentX Pro prompts" ON talentx_pro_prompts
  FOR SELECT USING (auth.uid() = user_id);

-- Create policy to allow users to insert their own TalentX Pro prompts
CREATE POLICY "Users can insert their own TalentX Pro prompts" ON talentx_pro_prompts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Create policy to allow users to update their own TalentX Pro prompts
CREATE POLICY "Users can update their own TalentX Pro prompts" ON talentx_pro_prompts
  FOR UPDATE USING (auth.uid() = user_id);

-- Create policy to allow users to delete their own TalentX Pro prompts
CREATE POLICY "Users can delete their own TalentX Pro prompts" ON talentx_pro_prompts
  FOR DELETE USING (auth.uid() = user_id); 