-- Add workplace_themes column to prompt_responses table
ALTER TABLE prompt_responses
ADD COLUMN workplace_themes JSONB DEFAULT '[]'::jsonb;

-- Update existing rows to have empty array instead of null
UPDATE prompt_responses
SET workplace_themes = '[]'::jsonb
WHERE workplace_themes IS NULL;

-- Drop workplace_themes column from prompt_responses table
ALTER TABLE prompt_responses
DROP COLUMN workplace_themes;
