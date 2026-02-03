-- ============================================================================
-- Prompt type: four intents (Informational, Experience, Competitive, Discovery)
-- ============================================================================
-- Rename types: sentiment -> experience, visibility -> discovery.
-- Add new type: informational (and talentx_informational).
-- Competitive stays. All prompts are scored by Sentiment, Relevance, Visibility.

-- 1. Drop existing CHECK on prompt_type (name may vary by PG version)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'confirmed_prompts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%prompt_type%'
  ) LOOP
    EXECUTE format('ALTER TABLE confirmed_prompts DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
  EXECUTE 'ALTER TABLE confirmed_prompts DROP CONSTRAINT IF EXISTS confirmed_prompts_prompt_type_check';
END $$;

-- 2. Migrate existing rows to new type names
UPDATE confirmed_prompts SET prompt_type = 'experience' WHERE prompt_type = 'sentiment';
UPDATE confirmed_prompts SET prompt_type = 'talentx_experience' WHERE prompt_type = 'talentx_sentiment';
UPDATE confirmed_prompts SET prompt_type = 'discovery' WHERE prompt_type = 'visibility';
UPDATE confirmed_prompts SET prompt_type = 'talentx_discovery' WHERE prompt_type = 'talentx_visibility';
-- competitive, talentx_competitive unchanged

-- 2b. Fix any remaining rows (NULL, typos, or legacy values) so the new CHECK can be added
UPDATE confirmed_prompts
SET prompt_type = CASE
  WHEN prompt_type IN ('informational', 'experience', 'competitive', 'discovery', 'talentx_informational', 'talentx_experience', 'talentx_competitive', 'talentx_discovery') THEN prompt_type
  WHEN prompt_type LIKE 'talentx_%' THEN 'talentx_experience'
  ELSE 'experience'
END
WHERE prompt_type IS NULL
   OR prompt_type NOT IN ('informational', 'experience', 'competitive', 'discovery', 'talentx_informational', 'talentx_experience', 'talentx_competitive', 'talentx_discovery');

-- 3. Add CHECK with new type set (4 base + 4 talentx)
ALTER TABLE confirmed_prompts
  ADD CONSTRAINT confirmed_prompts_prompt_type_check CHECK (
    prompt_type IN (
      'informational',
      'experience',
      'competitive',
      'discovery',
      'talentx_informational',
      'talentx_experience',
      'talentx_competitive',
      'talentx_discovery'
    )
  );

-- 4. Update pg enum if it exists (used elsewhere e.g. types generation)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'prompt_type') THEN
    -- PostgreSQL enums: add new values, then we'd need to migrate - but confirmed_prompts uses CHECK not enum
    -- So we only ensure the table constraint is correct; enum may be used by generated types
    NULL;
  END IF;
END $$;
