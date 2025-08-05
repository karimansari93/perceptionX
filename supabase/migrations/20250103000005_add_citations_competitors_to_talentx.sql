-- Add citations and detected_competitors fields to talentx_perception_scores table
ALTER TABLE talentx_perception_scores 
ADD COLUMN IF NOT EXISTS citations JSONB,
ADD COLUMN IF NOT EXISTS detected_competitors TEXT; 