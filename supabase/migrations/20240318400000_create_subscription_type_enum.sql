-- Create subscription_type enum if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_type') THEN
        CREATE TYPE subscription_type AS ENUM ('free', 'pro');
    END IF;
END $$; 