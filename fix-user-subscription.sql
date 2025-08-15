-- Manually update user subscription for the user who just paid
UPDATE profiles 
SET 
  subscription_type = 'pro',
  subscription_start_date = now()
WHERE id = 'fb978d6e-bf39-4782-a1f7-167142c5f070';

-- Check the update worked
SELECT id, email, subscription_type, subscription_start_date 
FROM profiles 
WHERE id = 'fb978d6e-bf39-4782-a1f7-167142c5f070';
