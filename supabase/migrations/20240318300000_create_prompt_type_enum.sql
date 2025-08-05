-- Create prompt_type enum if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'prompt_type') THEN
        CREATE TYPE prompt_type AS ENUM ('sentiment', 'competitive', 'visibility', 'talentx_sentiment', 'talentx_competitive', 'talentx_visibility');
    END IF;
END $$; 