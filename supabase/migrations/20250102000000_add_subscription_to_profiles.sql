-- Add subscription fields to profiles table
ALTER TABLE profiles 
ADD COLUMN subscription_type subscription_type DEFAULT 'free',
ADD COLUMN subscription_start_date TIMESTAMPTZ,
ADD COLUMN prompts_used INTEGER DEFAULT 0;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_type 
ON profiles(subscription_type);

-- Create index for user_id lookups
CREATE INDEX IF NOT EXISTS idx_profiles_id 
ON profiles(id);

-- Add trigger for updated_at
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_profiles_updated_at') THEN
        CREATE TRIGGER update_profiles_updated_at
            BEFORE UPDATE ON profiles
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$; 