-- Auto-create company and membership when user_onboarding is inserted

CREATE OR REPLACE FUNCTION auto_create_company_from_onboarding()
RETURNS TRIGGER AS $$
DECLARE
  v_company_id UUID;
BEGIN
  -- Only proceed if company_name and industry are provided
  IF NEW.company_name IS NOT NULL AND NEW.industry IS NOT NULL THEN
    
    -- Check if this exact company already exists for this user
    SELECT c.id INTO v_company_id
    FROM companies c
    INNER JOIN company_members cm ON cm.company_id = c.id
    WHERE c.name = NEW.company_name 
      AND c.industry = NEW.industry
      AND cm.user_id = NEW.user_id
    LIMIT 1;
    
    -- If company doesn't exist for this user, create it
    IF v_company_id IS NULL THEN
      -- Create the company
      INSERT INTO companies (
        name,
        industry,
        company_size,
        competitors,
        created_by
      ) VALUES (
        NEW.company_name,
        NEW.industry,
        NEW.company_size,
        NEW.competitors,
        NEW.user_id
      ) RETURNING id INTO v_company_id;
      
      -- Create membership (user becomes owner)
      INSERT INTO company_members (
        user_id,
        company_id,
        role,
        is_default
      ) VALUES (
        NEW.user_id,
        v_company_id,
        'owner',
        -- Set as default only if user has no other companies
        NOT EXISTS (
          SELECT 1 FROM company_members 
          WHERE user_id = NEW.user_id 
          AND is_default = true
        )
      );
      
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS auto_create_company_trigger ON user_onboarding;
CREATE TRIGGER auto_create_company_trigger
  AFTER INSERT ON user_onboarding
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_company_from_onboarding();

-- Also auto-link confirmed_prompts to company
CREATE OR REPLACE FUNCTION auto_link_prompts_to_company()
RETURNS TRIGGER AS $$
DECLARE
  v_company_id UUID;
BEGIN
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

DROP TRIGGER IF EXISTS auto_link_prompts_trigger ON confirmed_prompts;
CREATE TRIGGER auto_link_prompts_trigger
  BEFORE INSERT ON confirmed_prompts
  FOR EACH ROW
  WHEN (NEW.company_id IS NULL)
  EXECUTE FUNCTION auto_link_prompts_to_company();


