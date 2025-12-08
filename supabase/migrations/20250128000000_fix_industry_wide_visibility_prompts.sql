-- Fix auto_link_prompts_trigger to skip industry-wide visibility prompts
-- Industry-wide visibility prompts should have company_id = NULL

CREATE OR REPLACE FUNCTION auto_link_prompts_to_company()
RETURNS TRIGGER AS $$
DECLARE
  v_company_id UUID;
BEGIN
  -- Skip auto-linking for industry-wide visibility prompts
  -- These are prompts with prompt_type = 'visibility' and no onboarding_id
  -- They are meant to be industry-wide (company_id = NULL) for visibility rankings
  IF NEW.prompt_type = 'visibility' AND NEW.onboarding_id IS NULL THEN
    -- This is an industry-wide visibility prompt, keep company_id as NULL
    RETURN NEW;
  END IF;

  -- Find the user's default company
  SELECT cm.company_id INTO v_company_id
  FROM company_members cm
  WHERE cm.user_id = NEW.user_id 
    AND cm.is_default = true
  LIMIT 1;
  
  -- If no default, get latest company
  IF v_company_id IS NULL THEN
    SELECT cm.company_id INTO v_company_id
    FROM company_members cm
    WHERE cm.user_id = NEW.user_id
    ORDER BY cm.joined_at DESC
    LIMIT 1;
  END IF;
  
  -- Set the company_id
  IF v_company_id IS NOT NULL THEN
    NEW.company_id := v_company_id;
    NEW.created_by := NEW.user_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The trigger already exists, no need to recreate it
-- It will use the updated function automatically

