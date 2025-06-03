-- Drop existing foreign key constraint
ALTER TABLE confirmed_prompts DROP CONSTRAINT confirmed_prompts_onboarding_id_fkey;

-- Recreate foreign key constraint with ON DELETE CASCADE
ALTER TABLE confirmed_prompts 
ADD CONSTRAINT confirmed_prompts_onboarding_id_fkey 
FOREIGN KEY (onboarding_id) 
REFERENCES user_onboarding(id) 
ON DELETE CASCADE; 