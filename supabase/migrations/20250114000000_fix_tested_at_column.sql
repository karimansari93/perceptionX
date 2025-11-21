-- ============================================================================
-- Fix tested_at column in prompt_responses
-- ============================================================================
-- This migration ensures tested_at column exists and is properly updated
-- when data is refreshed from the admin panel

-- PROBLEM: When admin refreshes data, it UPDATES existing prompt_responses records.
-- The tested_at timestamp was not being updated, so dashboard showed old collection date.
-- SOLUTION: Add a trigger to automatically update tested_at on every UPDATE.

-- Step 1: Add tested_at column if it doesn't exist
ALTER TABLE prompt_responses 
ADD COLUMN IF NOT EXISTS tested_at TIMESTAMPTZ DEFAULT NOW();

-- Step 2: Populate tested_at with updated_at for existing records where it's null
-- This handles any existing data that might not have tested_at set
UPDATE prompt_responses 
SET tested_at = COALESCE(updated_at, created_at)
WHERE tested_at IS NULL;

-- Step 3: Create a trigger to auto-update tested_at whenever a record is updated
-- This ensures that when admin refreshes data, the tested_at reflects the refresh time
CREATE OR REPLACE FUNCTION update_tested_at_on_update()
RETURNS TRIGGER AS $$
BEGIN
    -- Only update tested_at, leave updated_at for the existing trigger
    NEW.tested_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Step 4: Add trigger to prompt_responses
-- This trigger runs AFTER the updated_at trigger (BEFORE UPDATE)
DROP TRIGGER IF EXISTS update_prompt_responses_tested_at ON prompt_responses;
CREATE TRIGGER update_prompt_responses_tested_at
    BEFORE UPDATE ON prompt_responses
    FOR EACH ROW
    EXECUTE FUNCTION update_tested_at_on_update();

-- Step 5: Create index on tested_at for better query performance
CREATE INDEX IF NOT EXISTS idx_prompt_responses_tested_at 
ON prompt_responses(tested_at DESC);

-- Note: This works because when admin panel refreshes:
-- 1. analyze-response function UPDATES the existing prompt_responses record
-- 2. This trigger fires and sets tested_at = NOW()
-- 3. Dashboard sorts by updated_at/tested_at and shows the latest timestamp
-- 4. User sees "Last collected: Just now" after refresh completes

