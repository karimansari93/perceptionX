-- Create profiles table if it doesn't exist
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_profiles_email 
ON profiles(email);

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