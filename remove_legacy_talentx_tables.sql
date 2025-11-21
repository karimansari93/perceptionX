-- Manual script to remove legacy TalentX tables
-- Run this in Supabase SQL Editor if you prefer manual deletion

-- Drop RLS policies first
DROP POLICY IF EXISTS "Users can manage perception scores" ON talentx_perception_scores;
DROP POLICY IF EXISTS "Admins can manage all talentx perception scores" ON talentx_perception_scores;
DROP POLICY IF EXISTS "Users can manage talentx prompts" ON talentx_pro_prompts;
DROP POLICY IF EXISTS "Admins can manage all talentx prompts" ON talentx_pro_prompts;

-- Drop triggers
DROP TRIGGER IF EXISTS update_talentx_perception_scores_updated_at ON talentx_perception_scores;
DROP TRIGGER IF EXISTS update_talentx_pro_prompts_updated_at ON talentx_pro_prompts;

-- Drop indexes
DROP INDEX IF EXISTS idx_talentx_perception_scores_user_id;
DROP INDEX IF EXISTS idx_talentx_perception_scores_attribute_id;
DROP INDEX IF EXISTS idx_talentx_perception_scores_created_at;
DROP INDEX IF EXISTS idx_talentx_scores_user_attribute;
DROP INDEX IF EXISTS idx_talentx_pro_prompts_user_id;
DROP INDEX IF EXISTS idx_talentx_pro_prompts_attribute;

-- Drop the tables
DROP TABLE IF EXISTS talentx_perception_scores;
DROP TABLE IF EXISTS talentx_pro_prompts;

-- Drop the trigger functions if they exist and are no longer used
DROP FUNCTION IF EXISTS update_talentx_perception_scores_updated_at();
DROP FUNCTION IF EXISTS update_talentx_pro_prompts_updated_at();

-- Verify tables are gone
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('talentx_perception_scores', 'talentx_pro_prompts');



