-- Add company limit check for free users
-- This prevents free users from having more than 3 companies

-- Modify the trigger function to check company limits for free users
CREATE OR REPLACE FUNCTION auto_create_company_from_onboarding()
RETURNS TRIGGER AS $$
DECLARE
  v_company_id UUID;
  v_user_subscription_type TEXT;
  v_company_count INTEGER;
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
    
    -- If company doesn't exist for this user, check if they can create a new one
    IF v_company_id IS NULL THEN
      
      -- Get user's subscription type
      SELECT subscription_type INTO v_user_subscription_type
      FROM profiles
      WHERE id = NEW.user_id;
      
      -- Count existing companies for this user
      SELECT COUNT(*) INTO v_company_count
      FROM company_members
      WHERE user_id = NEW.user_id;
      
      -- Check company limits based on subscription type
      IF v_user_subscription_type = 'free' AND v_company_count >= 3 THEN
        RAISE EXCEPTION 'Free users can only add up to 3 companies. Please upgrade to Pro for up to 10 companies.';
      END IF;
      
      IF v_user_subscription_type = 'pro' AND v_company_count >= 10 THEN
        RAISE EXCEPTION 'Pro users can add up to 10 companies. Please contact support for higher limits.';
      END IF;
      
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

-- The trigger already exists, no need to recreate it
-- DROP TRIGGER IF EXISTS auto_create_company_trigger ON user_onboarding;
-- CREATE TRIGGER auto_create_company_trigger
--   AFTER INSERT ON user_onboarding
--   FOR EACH ROW
--   EXECUTE FUNCTION auto_create_company_from_onboarding();

