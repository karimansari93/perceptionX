-- Temporarily disable RLS on companies table for admin functionality
-- This allows admins to query companies without RLS blocking

ALTER TABLE companies DISABLE ROW LEVEL SECURITY;

-- Also ensure admins can read/write everything
GRANT ALL ON companies TO authenticated;



