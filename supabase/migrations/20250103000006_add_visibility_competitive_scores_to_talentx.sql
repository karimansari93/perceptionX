-- Add visibility_score and competitive_score columns to talentx_perception_scores table
-- to make it consistent with prompt_responses table structure
ALTER TABLE talentx_perception_scores 
ADD COLUMN IF NOT EXISTS visibility_score DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS competitive_score DECIMAL(5,2);

-- Add comment to explain the columns
COMMENT ON COLUMN talentx_perception_scores.visibility_score IS 'Visibility score (0-100) for this attribute analysis';
COMMENT ON COLUMN talentx_perception_scores.competitive_score IS 'Competitive score (0-100) for this attribute analysis'; 