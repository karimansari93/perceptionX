-- Remove legacy TalentX tables that are no longer used
-- These tables have been replaced by the standard confirmed_prompts and prompt_responses system

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

-- Drop the trigger function if it exists and is no longer used
DROP FUNCTION IF EXISTS update_talentx_perception_scores_updated_at();
DROP FUNCTION IF EXISTS update_talentx_pro_prompts_updated_at();

-- Add comment for documentation
COMMENT ON SCHEMA public IS 'Legacy TalentX tables (talentx_perception_scores, talentx_pro_prompts) removed on 2025-01-08. Replaced by confirmed_prompts and prompt_responses system.';



